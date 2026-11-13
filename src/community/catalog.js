import { createHash, randomBytes } from 'node:crypto'
import { badRequest, forbidden, notFound, HttpError } from '../lib/errors.js'
import { normGenres, canonType, canonStatus } from '../normalize.js'
import { rank, isDup } from './util.js'

const TYPES = ['manhwa', 'manhua', 'manga']
const STATUSES = ['ongoing', 'completed', 'hiatus', 'cancelled']
const MAX_UPLOAD = 10 * 1024 * 1024
const MAX_PAGES = 400
const MEDIA_ID = /^[0-9a-f]{24}$/
const MIME = [
  ['image/jpeg', b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', b => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))],
  ['image/webp', b => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP'],
  ['image/gif', b => b.subarray(0, 4).toString('ascii') === 'GIF8']
]

export const catalogVersion = { n: 0, bump() { this.n++ } }

export const needOwner = u => {
  if (rank(u) < 3) throw forbidden('Fitur ini khusus OWNER')
}

const comicKey = (source, slug) => `${source}|${slug}`
const chapterKey = (source, slug, chapter) => `${source}|${slug}|${chapter}`
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '')

const byId = async (col, ids) => (ids.length ? new Map((await col.find({ _id: { $in: ids } }).toArray()).map(d => [d._id, d])) : new Map())

export const overrideFields = o => ({
  ...(o.title ? { title: o.title } : {}),
  ...(o.cover ? { cover: o.cover } : {}),
  ...(o.synopsis ? { synopsis: o.synopsis } : {}),
  ...(o.genres?.length ? { genres: o.genres } : {}),
  ...(o.type ? { type: o.type } : {}),
  ...(o.status ? { status: o.status } : {}),
  ...(o.author ? { author: o.author } : {}),
  ...(o.artist ? { artist: o.artist } : {})
})

export async function decorateItems(ctx, items, { type = '' } = {}) {
  if (!ctx || !Array.isArray(items) || !items.length) return items
  const keys = items.map(i => comicKey(i.source, i.slug))
  const [overrides, stats] = await Promise.all([byId(ctx.c.comicOverrides, keys), byId(ctx.c.comicStats, keys)])
  const out = items.map((it, i) => {
    const o = overrides.get(keys[i])
    const views = stats.get(keys[i])?.views
    return { ...it, ...(o ? overrideFields(o) : {}), ...(views ? { viewCount: views } : {}), _edited: !!o }
  })
  return out.filter(it => !(type && it._edited && it.type && it.type !== type)).map(({ _edited, ...rest }) => rest)
}

export async function decorateDetail(ctx, detail) {
  if (!ctx || !detail?.slug) return detail
  const key = comicKey(detail.source, detail.slug)
  const chapterKeys = (detail.chapters || []).map(c => chapterKey(detail.source, detail.slug, c.slug))
  const [overrides, stats, chapterStats] = await Promise.all([byId(ctx.c.comicOverrides, [key]), byId(ctx.c.comicStats, [key]), byId(ctx.c.chapterStats, chapterKeys)])
  const o = overrides.get(key)
  const views = stats.get(key)?.views
  return {
    ...detail,
    ...(o ? overrideFields(o) : {}),
    ...(views ? { viewCount: views } : {}),
    chapters: (detail.chapters || []).map((c, i) => (chapterStats.get(chapterKeys[i])?.views ? { ...c, viewCount: chapterStats.get(chapterKeys[i]).views } : c))
  }
}

export async function pagesOverride(ctx, source, slug, chapter) {
  if (!ctx) return null
  const row = await ctx.c.chapterOverrides.findOne({ _id: chapterKey(source, slug, chapter) })
  return row?.pages?.length ? row.pages : null
}

const proxyOf = u => (u.startsWith('/media/') ? u : `/api/image?url=${encodeURIComponent(u)}`)

export const withPages = (data, pages) => ({ ...data, images: pages, proxy: pages.map(proxyOf) })

const cleanPages = pages => {
  if (!Array.isArray(pages) || !pages.length) throw badRequest('"pages" tidak boleh kosong')
  if (pages.length > MAX_PAGES) throw badRequest(`Maksimal ${MAX_PAGES} gambar per chapter`)
  return pages.map(p => {
    const u = typeof p === 'string' ? p.trim() : ''
    if (!(MEDIA_ID.test(u.replace(/^\/media\//, '')) && u.startsWith('/media/')) && !/^https?:\/\/\S{1,1900}$/.test(u)) throw badRequest('Alamat gambar tidak valid')
    return u
  })
}

export async function adminComic(ctx, actor, source, slug, loadDetail) {
  needOwner(actor)
  const detail = await loadDetail()
  const key = comicKey(source, slug)
  const chapterKeys = (detail.chapters || []).map(c => chapterKey(source, slug, c.slug))
  const [overrides, stats, chapterStats, chapterEdits] = await Promise.all([
    byId(ctx.c.comicOverrides, [key]), byId(ctx.c.comicStats, [key]), byId(ctx.c.chapterStats, chapterKeys), byId(ctx.c.chapterOverrides, chapterKeys)
  ])
  const o = overrides.get(key)
  const merged = { ...detail, ...(o ? overrideFields(o) : {}) }
  return {
    source,
    slug,
    title: merged.title || '',
    cover: merged.cover || '',
    synopsis: merged.synopsis || '',
    genres: merged.genres || [],
    type: merged.type || '',
    status: merged.status || '',
    author: merged.author || '',
    artist: merged.artist || '',
    viewCount: stats.get(key)?.views || 0,
    edited: !!o,
    chapters: (detail.chapters || []).map((c, i) => ({
      slug: c.slug, number: c.number || '', title: c.title || '', viewCount: chapterStats.get(chapterKeys[i])?.views || 0, edited: chapterEdits.has(chapterKeys[i])
    }))
  }
}

export async function saveComic(ctx, actor, source, slug, body, loadDetail) {
  needOwner(actor)
  const type = text(body?.type, 20).toLowerCase()
  const status = text(body?.status, 20).toLowerCase()
  if (type && !TYPES.includes(type)) throw badRequest('"type" harus manhwa, manhua, atau manga')
  if (status && !STATUSES.includes(status)) throw badRequest('"status" tidak valid')
  const cover = text(body?.cover, 2000)
  if (cover && !/^https?:\/\/\S+$/.test(cover) && !/^\/media\/[0-9a-f]{24}$/.test(cover)) throw badRequest('"cover" harus URL atau hasil unggahan')
  const title = text(body?.title, 200)
  if (!title) throw badRequest('"title" tidak boleh kosong')
  const genres = normGenres((Array.isArray(body?.genres) ? body.genres : []).map(g => text(g, 40)).filter(Boolean)).slice(0, 30)
  const doc = { title, cover, synopsis: text(body?.synopsis, 5000), genres, type: canonType(type), status: canonStatus(status), author: text(body?.author, 120), artist: text(body?.artist, 120), updatedAt: ctx.now() }
  await ctx.c.comicOverrides.updateOne({ _id: comicKey(source, slug) }, { $set: doc }, { upsert: true })
  catalogVersion.bump()
  return adminComic(ctx, actor, source, slug, loadDetail)
}

export async function resetComic(ctx, actor, source, slug, loadDetail) {
  needOwner(actor)
  await ctx.c.comicOverrides.deleteOne({ _id: comicKey(source, slug) })
  catalogVersion.bump()
  return adminComic(ctx, actor, source, slug, loadDetail)
}

export async function getPages(ctx, actor, source, slug, chapter, loadChapter) {
  needOwner(actor)
  const edited = await pagesOverride(ctx, source, slug, chapter)
  if (edited) return { pages: edited, edited: true }
  return { pages: (await loadChapter()).images || [], edited: false }
}

export async function savePages(ctx, actor, source, slug, chapter, body) {
  needOwner(actor)
  const pages = cleanPages(body?.pages)
  await ctx.c.chapterOverrides.updateOne({ _id: chapterKey(source, slug, chapter) }, { $set: { pages, updatedAt: ctx.now() } }, { upsert: true })
  catalogVersion.bump()
  return { pages, edited: true }
}

export async function resetPages(ctx, actor, source, slug, chapter, loadChapter) {
  needOwner(actor)
  await ctx.c.chapterOverrides.deleteOne({ _id: chapterKey(source, slug, chapter) })
  catalogVersion.bump()
  return { pages: (await loadChapter()).images || [], edited: false }
}

const parseMultipart = (buf, contentType) => {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '')
  if (!boundary) throw badRequest('Body harus multipart/form-data')
  const delim = Buffer.from(`--${boundary[1] || boundary[2]}`)
  let pos = buf.indexOf(delim)
  while (pos >= 0) {
    const start = pos + delim.length
    if (buf.subarray(start, start + 2).toString() === '--') break
    const headEnd = buf.indexOf('\r\n\r\n', start)
    const next = buf.indexOf(delim, headEnd)
    if (headEnd < 0 || next < 0) break
    const head = buf.subarray(start, headEnd).toString('latin1')
    if (/name="file"/i.test(head)) return buf.subarray(headEnd + 4, next - 2)
    pos = next
  }
  throw badRequest('Field "file" tidak ada')
}

const readBody = async (req, limit) => {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Gambar terlalu besar (maks 10 MB)')
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

export async function uploadMedia(ctx, actor, req) {
  needOwner(actor)
  const data = parseMultipart(await readBody(req, MAX_UPLOAD + 4096), req.headers['content-type'])
  if (!data.length || data.length > MAX_UPLOAD) throw badRequest('Ukuran gambar tidak valid (maks 10 MB)')
  const mime = MIME.find(([, ok]) => ok(data))?.[0]
  if (!mime) throw badRequest('File harus gambar JPG, PNG, WebP, atau GIF')
  const id = Date.now().toString(16).padStart(12, '0') + randomBytes(6).toString('hex')
  await ctx.c.media.insertOne({ _id: id, mime, data, size: data.length, createdAt: ctx.now(), createdBy: actor._id })
  return { url: `/media/${id}` }
}

export async function serveMedia(ctx, req, res, id) {
  if (!MEDIA_ID.test(id)) throw notFound('Gambar tidak ditemukan')
  const row = await ctx.c.media.findOne({ _id: id })
  if (!row) throw notFound('Gambar tidak ditemukan')
  const d = row.data
  const bytes = d instanceof Uint8Array ? Buffer.from(d.buffer, d.byteOffset, d.byteLength) : Buffer.from(d.buffer.subarray(0, d.position ?? d.buffer.length))
  const etag = `"${createHash('sha1').update(bytes).digest('base64url').slice(0, 20)}"`
  const headers = { 'content-type': row.mime, etag, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' }
  if ((req.headers['if-none-match'] || '').includes(etag)) {
    res.writeHead(304, headers)
    return res.end()
  }
  res.writeHead(200, { ...headers, 'content-length': bytes.length })
  res.end(req.method === 'HEAD' ? undefined : bytes)
}

const dedupeId = (user, deviceId, ip, target) => `${target}|${user?._id || deviceId || ip}`

export async function trackView(ctx, user, { deviceId, ip }, kind, body) {
  const source = text(body?.source, 40)
  const slug = text(kind === 'comic' ? body?.slug : body?.comic, 200)
  const chapter = kind === 'chapter' ? text(body?.chapter, 50) : ''
  if (!source || !slug || (kind === 'chapter' && !chapter)) throw badRequest('Data tidak lengkap')
  const key = kind === 'comic' ? comicKey(source, slug) : chapterKey(source, slug, chapter)
  const col = kind === 'comic' ? ctx.c.comicStats : ctx.c.chapterStats
  try {
    await ctx.c.viewDedupe.insertOne({ _id: dedupeId(user, deviceId, ip, `${kind[0]}|${key}`), at: new Date(ctx.now()) })
  } catch (e) {
    if (!isDup(e)) throw e
    return { viewCount: (await col.findOne({ _id: key }))?.views || 0 }
  }
  const row = await col.findOneAndUpdate({ _id: key }, { $inc: { views: 1 } }, { upsert: true, returnDocument: 'after' })
  return { viewCount: row?.views || 0 }
}
