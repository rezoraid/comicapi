import { randomBytes } from 'node:crypto'
import { badRequest, forbidden, notFound, HttpError } from '../lib/errors.js'
import { etagMatches } from '../http/respond.js'
import { rank, isDup, SLUG, CHAPTER } from './util.js'

const VIEW_WINDOW_MS = 6 * 3_600_000
const MAX_MEDIA_BYTES = 10 * 1024 * 1024
const MAX_PAGES = 500
const TYPES = ['manhwa', 'manhua', 'manga']
const STATUSES = ['ongoing', 'completed', 'hiatus', 'cancelled']
const MEDIA_ID = /^[0-9a-f]{24}$/
const MEDIA_PATH = /^\/media\/[0-9a-f]{24}$/
const DEVICE = /^[\w-]{8,64}$/

const key = (...parts) => parts.join('|')
const escapeRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const needOwner = u => {
  if (rank(u) < 3) throw forbidden('Fitur ini khusus OWNER')
}
const count = v => (Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0)
const filled = v => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim() !== '' : false)
const lower = v => String(v ?? '').trim().toLowerCase()

export const viewerKey = (viewer, req, ip) => {
  if (viewer?._id) return `u:${viewer._id}`
  const dev = String(req.headers['x-device-id'] || '')
  return DEVICE.test(dev) ? `d:${dev}` : `ip:${ip || 'unknown'}`
}

async function countsOnce(ctx, id) {
  const now = ctx.now()
  try {
    await ctx.c.viewDedupe.insertOne({ _id: id, at: new Date(now) })
    return true
  } catch (err) {
    if (!isDup(err)) throw err
  }
  const r = await ctx.c.viewDedupe.updateOne({ _id: id, at: { $lt: new Date(now - VIEW_WINDOW_MS) } }, { $set: { at: new Date(now) } })
  return (r.modifiedCount ?? r.matchedCount ?? 0) > 0
}

const checkSource = (hasSource, source) => {
  if (typeof source !== 'string' || !hasSource(source)) throw notFound(`Sumber "${source}" tidak ada`)
  return source
}
const checkSlug = (v, name = 'slug', re = SLUG) => {
  if (typeof v !== 'string' || !re.test(v)) throw badRequest(`"${name}" tidak valid`)
  return v
}

export async function trackComicView(ctx, who, body, hasSource) {
  const source = checkSource(hasSource, body.source)
  const slug = checkSlug(body.slug)
  const _id = key(source, slug)
  const fresh = await countsOnce(ctx, key('c', source, slug, who))
  const row = fresh
    ? await ctx.c.comicStats.findOneAndUpdate({ _id }, { $inc: { views: 1 } }, { upsert: true, returnDocument: 'after' })
    : await ctx.c.comicStats.findOne({ _id })
  return { viewCount: count(row?.views) }
}

export async function trackChapterView(ctx, who, body, hasSource) {
  const source = checkSource(hasSource, body.source)
  const comic = checkSlug(body.comic, 'comic')
  const chapter = checkSlug(body.chapter, 'chapter', CHAPTER)
  const _id = key(source, comic, chapter)
  const fresh = await countsOnce(ctx, key('h', source, comic, chapter, who))
  const row = fresh
    ? await ctx.c.chapterStats.findOneAndUpdate({ _id }, { $inc: { views: 1 } }, { upsert: true, returnDocument: 'after' })
    : await ctx.c.chapterStats.findOne({ _id })
  return { viewCount: count(row?.views) }
}

const byId = rows => new Map(rows.map(r => [r._id, r]))
const statsFor = async (ctx, ids) => (ids.length ? byId(await ctx.c.comicStats.find({ _id: { $in: ids } }, { projection: { views: 1 } }).toArray()) : new Map())
const overridesFor = async (ctx, ids) => (ids.length ? byId(await ctx.c.comicOverrides.find({ _id: { $in: ids } }).toArray()) : new Map())

async function chapterRows(ctx, source, slug) {
  const prefix = { $regex: `^${escapeRe(key(source, slug))}\\|` }
  const [stats, edits] = await Promise.all([
    ctx.c.chapterStats.find({ _id: prefix }, { projection: { views: 1 } }).toArray(),
    ctx.c.chapterOverrides.find({ _id: prefix }, { projection: { _id: 1 } }).toArray()
  ])
  const cut = key(source, slug).length + 1
  return { views: new Map(stats.map(s => [s._id.slice(cut), count(s.views)])), edited: new Set(edits.map(e => e._id.slice(cut))) }
}

const LIST_FIELDS = ['title', 'cover', 'genres', 'type', 'status', 'author']
const DETAIL_FIELDS = ['title', 'cover', 'synopsis', 'genres', 'type', 'status', 'author', 'artist']

function applyOverride(base, ov, fields) {
  if (!ov) return base
  let out = base
  for (const f of fields) {
    if (!filled(ov[f])) continue
    if (out === base) out = { ...base }
    out[f] = ov[f]
  }
  return out
}

const itemsOf = data => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null)
const withItems = (data, items) => (Array.isArray(data) ? items : { ...data, items })

export async function overlayList(ctx, data, defaultSource = '', browse = null) {
  const items = itemsOf(data)
  if (!items) return data
  const ids = items.filter(i => i?.slug).map(i => key(i.source || defaultSource, i.slug))
  const [stats, overrides] = await Promise.all([statsFor(ctx, ids), overridesFor(ctx, ids)])
  const want = browse && (browse.type || browse.status || browse.genres.length) ? browse : null
  let out = []
  const seen = new Set()
  for (const it of items) {
    if (!it?.slug) {
      out.push(it)
      continue
    }
    const id = key(it.source || defaultSource, it.slug)
    seen.add(id)
    const ov = overrides.get(id)
    if (want && ov && !fitsFilter(ov, want)) continue
    const merged = applyOverride(it, ov, LIST_FIELDS)
    out.push({ ...merged, viewCount: count(stats.get(id)?.views) })
  }
  if (want && browse.page === 1 && !browse.q && defaultSource) out = out.concat(await injected(ctx, defaultSource, want, seen))
  return withItems(data, out)
}

function fitsFilter(ov, want) {
  if (want.type && filled(ov.type) && lower(ov.type) !== want.type) return false
  if (want.status && filled(ov.status) && lower(ov.status) !== want.status) return false
  if (want.genres.length && filled(ov.genres)) {
    const has = new Set(ov.genres.map(lower))
    if (!want.genres.every(g => has.has(g))) return false
  }
  return true
}

async function injected(ctx, source, want, seen) {
  const filter = { _id: { $regex: `^${escapeRe(source)}\\|` } }
  if (want.type) filter.type = want.type
  if (want.status) filter.status = want.status
  const rows = await ctx.c.comicOverrides.find(filter, { limit: 60 }).toArray()
  const picked = rows.filter(r => !seen.has(r._id) && filled(r.title) && fitsFilter(r, want) && (!want.genres.length || filled(r.genres))).slice(0, 20)
  if (!picked.length) return []
  const stats = await statsFor(ctx, picked.map(r => r._id))
  return picked.map(r => ({
    title: r.title,
    slug: r._id.slice(source.length + 1),
    url: '',
    cover: r.cover || '',
    type: r.type || '',
    status: r.status || '',
    rating: null,
    chapterCount: null,
    genres: r.genres || [],
    author: r.author || '',
    chapters: [],
    source,
    viewCount: count(stats.get(r._id)?.views)
  }))
}

export const browseWant = query => ({
  type: lower(query.get('type')),
  status: lower(query.get('status')),
  genres: lower(query.get('genre')).split(',').map(s => s.trim()).filter(Boolean),
  q: (query.get('q') || '').trim(),
  page: parseInt(query.get('page') || '1', 10) || 1
})

export async function overlayDetail(ctx, data, source, slug) {
  if (!data || typeof data !== 'object') return data
  const id = key(source, slug)
  const [stats, overrides, rows] = await Promise.all([statsFor(ctx, [id]), overridesFor(ctx, [id]), chapterRows(ctx, source, slug)])
  const merged = applyOverride(data, overrides.get(id), DETAIL_FIELDS)
  const chapters = Array.isArray(data.chapters) ? data.chapters.map(c => ({ ...c, viewCount: rows.views.get(c.slug) || 0 })) : data.chapters
  return { ...merged, chapters, viewCount: count(stats.get(id)?.views) }
}

const proxyOf = u => (MEDIA_PATH.test(u) ? u : `/api/image?url=${encodeURIComponent(u)}`)

export async function overlayChapter(ctx, data, source, comic, chapter) {
  if (!data || typeof data !== 'object') return data
  const ov = await ctx.c.chapterOverrides.findOne({ _id: key(source, comic, chapter) })
  if (!ov || !Array.isArray(ov.pages) || !ov.pages.length) return data
  return { ...data, images: ov.pages, proxy: ov.pages.map(proxyOf) }
}

const text = (v, name, max) => {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw badRequest(`"${name}" harus berupa teks`)
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (t.length > max) throw badRequest(`"${name}" maksimal ${max} karakter`)
  return t
}

const pick = (v, allowed, name) => {
  const t = lower(text(v, name, 20))
  if (t && !allowed.includes(t)) throw badRequest(`"${name}" harus salah satu dari: ${allowed.join(', ')}`)
  return t
}

const imageRef = (v, name) => {
  const t = text(v, name, 2000)
  if (!t) return ''
  if (MEDIA_PATH.test(t)) return t
  let u
  try {
    u = new URL(t)
  } catch {
    throw badRequest(`"${name}" harus URL gambar atau path /media/…`)
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw badRequest(`"${name}" harus URL http(s)`)
  return t
}

const genresOf = v => {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw badRequest('"genres" harus berupa daftar')
  if (v.length > 30) throw badRequest('"genres" maksimal 30')
  return [...new Set(v.map(g => text(g, 'genre', 40)).filter(Boolean))]
}

const view = (source, slug, base, ov, rows, views) => {
  const merged = applyOverride(base, ov, DETAIL_FIELDS)
  return {
    source,
    slug,
    title: merged.title || '',
    cover: merged.cover || '',
    synopsis: merged.synopsis || '',
    genres: Array.isArray(merged.genres) ? merged.genres : [],
    type: merged.type || '',
    status: merged.status || '',
    author: merged.author || '',
    artist: merged.artist || '',
    viewCount: views,
    edited: !!ov,
    chapters: (Array.isArray(base.chapters) ? base.chapters : []).map(c => ({
      slug: c.slug,
      number: c.number || '',
      title: c.title || '',
      viewCount: rows.views.get(c.slug) || 0,
      edited: rows.edited.has(c.slug)
    }))
  }
}

async function comicView(ctx, source, slug, fetchDetail) {
  const id = key(source, slug)
  const [base, ov, stats, rows] = await Promise.all([fetchDetail(source, slug), ctx.c.comicOverrides.findOne({ _id: id }), ctx.c.comicStats.findOne({ _id: id }), chapterRows(ctx, source, slug)])
  return view(source, slug, base || {}, ov, rows, count(stats?.views))
}

const known = (hasSource, params) => ({ source: checkSource(hasSource, params.source), slug: checkSlug(params.slug) })

export async function getComicAdmin(ctx, actor, params, { hasSource, fetchDetail }) {
  needOwner(actor)
  const { source, slug } = known(hasSource, params)
  return comicView(ctx, source, slug, fetchDetail)
}

export async function saveComic(ctx, actor, params, body, { hasSource, fetchDetail }) {
  needOwner(actor)
  const { source, slug } = known(hasSource, params)
  const doc = {
    title: text(body.title, 'title', 200),
    cover: imageRef(body.cover, 'cover'),
    synopsis: text(body.synopsis, 'synopsis', 5000),
    genres: genresOf(body.genres),
    type: pick(body.type, TYPES, 'type'),
    status: pick(body.status, STATUSES, 'status'),
    author: text(body.author, 'author', 200),
    artist: text(body.artist, 'artist', 200)
  }
  const id = key(source, slug)
  await fetchDetail(source, slug)
  if (DETAIL_FIELDS.every(f => !filled(doc[f]))) await ctx.c.comicOverrides.deleteOne({ _id: id })
  else await ctx.c.comicOverrides.updateOne({ _id: id }, { $set: { ...doc, updatedAt: ctx.now(), updatedBy: actor._id } }, { upsert: true })
  return comicView(ctx, source, slug, fetchDetail)
}

export async function resetComic(ctx, actor, params, { hasSource, fetchDetail }) {
  needOwner(actor)
  const { source, slug } = known(hasSource, params)
  await ctx.c.comicOverrides.deleteOne({ _id: key(source, slug) })
  return comicView(ctx, source, slug, fetchDetail)
}

const chapterKey = (hasSource, params) => {
  const { source, slug } = known(hasSource, params)
  return { source, slug, chapter: checkSlug(params.chapter, 'chapter', CHAPTER) }
}

const scraperPages = async (fetchChapter, source, slug, chapter) => {
  const c = await fetchChapter(source, slug, chapter)
  return Array.isArray(c?.images) ? c.images.filter(u => typeof u === 'string') : []
}

export async function getPages(ctx, actor, params, { hasSource, fetchChapter }) {
  needOwner(actor)
  const { source, slug, chapter } = chapterKey(hasSource, params)
  const ov = await ctx.c.chapterOverrides.findOne({ _id: key(source, slug, chapter) })
  if (ov?.pages?.length) return { pages: ov.pages, edited: true }
  return { pages: await scraperPages(fetchChapter, source, slug, chapter), edited: false }
}

export async function savePages(ctx, actor, params, body, { hasSource }) {
  needOwner(actor)
  const { source, slug, chapter } = chapterKey(hasSource, params)
  if (!Array.isArray(body.pages) || !body.pages.length) throw badRequest('"pages" tidak boleh kosong')
  if (body.pages.length > MAX_PAGES) throw badRequest(`"pages" maksimal ${MAX_PAGES} gambar`)
  const pages = body.pages.map((u, i) => {
    const ref = imageRef(u, `pages[${i}]`)
    if (!ref) throw badRequest(`pages[${i}] kosong`)
    return ref
  })
  await ctx.c.chapterOverrides.updateOne({ _id: key(source, slug, chapter) }, { $set: { pages, updatedAt: ctx.now(), updatedBy: actor._id } }, { upsert: true })
  return { pages, edited: true }
}

export async function resetPages(ctx, actor, params, { hasSource, fetchChapter }) {
  needOwner(actor)
  const { source, slug, chapter } = chapterKey(hasSource, params)
  await ctx.c.chapterOverrides.deleteOne({ _id: key(source, slug, chapter) })
  const pages = await scraperPages(fetchChapter, source, slug, chapter).catch(() => [])
  return { pages, edited: false }
}

export function sniffImage(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif'
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

async function readBody(req, limit) {
  const declared = parseInt(req.headers['content-length'] || '0', 10)
  if (declared > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'File terlalu besar (maks 10 MB)')
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'File terlalu besar (maks 10 MB)')
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

export function filePart(buf, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || '')
  if (!boundary) return null
  const delim = Buffer.from(`--${boundary[1] || boundary[2]}`)
  let pos = buf.indexOf(delim)
  while (pos !== -1) {
    const start = pos + delim.length
    if (buf.subarray(start, start + 2).toString('latin1') === '--') return null
    const headEnd = buf.indexOf('\r\n\r\n', start)
    if (headEnd === -1) return null
    const next = buf.indexOf(delim, headEnd + 4)
    if (next === -1) return null
    const head = buf.subarray(start, headEnd).toString('latin1')
    if (/name="file"/i.test(head)) return buf.subarray(headEnd + 4, next - 2)
    pos = next
  }
  return null
}

export async function uploadMedia(ctx, actor, req) {
  needOwner(actor)
  const raw = await readBody(req, MAX_MEDIA_BYTES + 64 * 1024)
  const bytes = filePart(raw, req.headers['content-type'])
  if (!bytes || !bytes.length) throw badRequest('Kirim gambar di field "file" (multipart/form-data)')
  if (bytes.length > MAX_MEDIA_BYTES) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'File terlalu besar (maks 10 MB)')
  const mime = sniffImage(bytes)
  if (!mime) throw badRequest('Hanya gambar JPEG, PNG, WebP, atau GIF')
  const _id = randomBytes(12).toString('hex')
  await ctx.c.media.insertOne({ _id, mime, size: bytes.length, data: Buffer.from(bytes), createdAt: ctx.now(), by: actor._id })
  return { url: `/media/${_id}` }
}

const toBuffer = d => (d && d._bsontype === 'Binary' ? Buffer.from(d.buffer.subarray(0, d.length())) : Buffer.from(d))

export async function serveMedia(ctx, req, res, id) {
  if (!MEDIA_ID.test(id)) throw notFound('File tidak ditemukan')
  const etag = `"${id}"`
  const headers = { etag, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' }
  if (etagMatches(req.headers['if-none-match'], etag)) {
    res.writeHead(304, headers)
    return res.end()
  }
  const doc = await ctx.c.media.findOne({ _id: id })
  if (!doc) throw notFound('File tidak ditemukan')
  const out = toBuffer(doc.data)
  res.writeHead(200, { ...headers, 'content-type': doc.mime, 'content-length': out.length })
  res.end(req.method === 'HEAD' ? undefined : out)
}
