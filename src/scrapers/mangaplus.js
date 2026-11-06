import crypto from 'node:crypto'
import { requestScope, sleep, trackHost } from './utils.js'

const API = 'https://jumpg-webapi.tokyo-cdn.com/api'
const SITE = 'https://mangaplus.shueisha.co.jp'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const LANGS = ['eng', 'fra', 'ind', 'ptb', 'rus', 'esp', 'tha', 'vie', 'deu']
const DEFAULT_LANG = LANGS.includes(process.env.MANGAPLUS_LANG) ? process.env.MANGAPLUS_LANG : 'eng'
const currentLang = () => {
  const l = requestScope.getStore()?.lang
  return LANGS.includes(l) ? l : DEFAULT_LANG
}
const QUALITY = ['low', 'high', 'super_high'].includes(process.env.MANGAPLUS_QUALITY) ? process.env.MANGAPLUS_QUALITY : 'low'
const TYPES = ['serializing', 'completed', 'one-shot']
const RANKINGS = ['hottest', 'trending', 'completed']
const MIN = 60 * 1000
const PAGE_SIZE = 20
const imageHosts = ['tokyo-cdn.com', 'mangaplus.shueisha.co.jp']
// Enum Language di protobuf MANGA Plus (urutan resmi, BUKAN urutan LANGS di atas).
const LANG_BY_ID = ['eng', 'esp', 'fra', 'ind', 'ptb', 'rus', 'tha', 'deu', 'vie']

const readVarint = (b, c) => {
  let v = 0
  let mul = 1
  for (let n = 0; n < 10; n++) {
    const x = b[c.i++]
    if (x === undefined) throw new Error('eof')
    v += (x & 0x7f) * mul
    if (x < 0x80) return v
    mul *= 128
  }
  throw new Error('varint')
}

export function decode(b, depth = 0) {
  const out = {}
  const c = { i: 0 }
  while (c.i < b.length) {
    const tag = readVarint(b, c)
    const f = Math.floor(tag / 8)
    const wt = tag % 8
    if (!f) throw new Error('tag')
    let v
    if (wt === 0) v = readVarint(b, c)
    else if (wt === 2) {
      const len = readVarint(b, c)
      const end = c.i + len
      if (end > b.length) throw new Error('len')
      const bytes = b.subarray(c.i, end)
      c.i = end
      const s = bytes.toString('utf8')
      let sub = null
      if (depth < 9 && len) try { sub = decode(bytes, depth + 1) } catch {}
      if (sub && Object.keys(sub).length) v = Object.defineProperty(sub, '$s', { value: s })
      else v = s
    } else if (wt === 1 || wt === 5) {
      c.i += wt === 1 ? 8 : 4
      if (c.i > b.length) throw new Error('len')
      continue
    } else throw new Error('wire')
    ;(out[f] ||= []).push(v)
  }
  return out
}

const first = (n, f) => n?.[f]?.[0]
const int = (n, f) => (typeof first(n, f) === 'number' ? first(n, f) : undefined)
const BINARY = /[\x00-\x08\x0b\x0c\x0e-\x1f]/
const str = (n, f) => {
  const v = first(n, f)
  if (typeof v === 'string') return v
  return v && !BINARY.test(v.$s) ? v.$s : undefined
}
const msg = (n, f) => (typeof first(n, f) === 'object' ? first(n, f) : undefined)
const nodes = (n, f) => (n?.[f] || []).filter(x => typeof x === 'object')
const iso = ts => (ts ? new Date(ts * 1000).toISOString() : '')
const img = url => (url ? trackHost(imageHosts, url) : '')

const uniq = (list, key) => {
  const seen = new Set()
  return list.filter(x => x && x[key] != null && !seen.has(x[key]) && seen.add(x[key]))
}

const isTitle = n => int(n, 1) !== undefined && typeof str(n, 2) === 'string' && typeof str(n, 3) === 'string'
const isChapter = n => int(n, 1) !== undefined && int(n, 2) !== undefined && str(n, 3) !== undefined && str(n, 4) !== undefined

const grab = (node, test, map, out = [], depth = 0) => {
  if (!node || depth > 8) return out
  if (test(node)) out.push(map(node))
  for (const vals of Object.values(node)) for (const v of vals) if (v && typeof v === 'object') grab(v, test, map, out, depth + 1)
  return out
}

const grabPages = (node, out = [], depth = 0) => {
  if (!node || depth > 8) return out
  const url = str(node, 1)
  if (typeof url === 'string' && /^https?:\/\/\S+\/manga_page\//.test(url)) out.push({ url, key: str(node, 5) || '' })
  for (const vals of Object.values(node)) for (const v of vals) if (v && typeof v === 'object') grabPages(v, out, depth + 1)
  return out
}

const item = (o = {}) => ({
  title: '',
  slug: '',
  url: `${SITE}/titles/${o.slug}`,
  cover: '',
  type: 'manga',
  status: '',
  rating: null,
  chapterCount: null,
  chapters: [],
  ...o
})

// Tiap bahasa adalah judul sendiri dengan ID sendiri (chapter-nya pun terpisah per bahasa).
const titleLang = n => LANG_BY_ID[int(n, 7) ?? 0] ?? 'eng'

const mapTitle = n => item({ slug: String(int(n, 1)), title: str(n, 2).trim(), author: str(n, 3).trim(), cover: img(str(n, 4)), lang: titleLang(n) })

const chapterNumber = name => {
  const m = String(name ?? '').match(/^#?\s*(\d+(?:\.\d+)?)/)
  return m ? String(parseFloat(m[1])) : String(name ?? '').trim()
}

const mapChapter = n => ({
  slug: String(int(n, 2)),
  number: chapterNumber(str(n, 3)),
  title: (str(n, 4) || '').trim(),
  timeAgo: '',
  releaseDate: iso(int(n, 6)) || null
})

const memo = new Map()
const inflight = new Map()
const cached = (key, ttl, fn) => {
  const hit = memo.get(key)
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.val)
  if (inflight.has(key)) return inflight.get(key)
  const p = fn()
    .then(val => {
      memo.set(key, { val, exp: Date.now() + ttl })
      if (memo.size > 200) memo.delete(memo.keys().next().value)
      return val
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

const headers = () => ({
  'user-agent': UA,
  accept: '*/*',
  'accept-language': 'en-US,en;q=0.9',
  origin: SITE,
  referer: SITE + '/',
  'session-token': crypto.randomUUID(),
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site'
})

const fail = (message, status) => Object.assign(new Error(message), { status })

async function request(path, params) {
  const qs = new URLSearchParams({ ...params, clang: 'eng' })
  let last
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${API}/${path}?${qs}`, { headers: headers(), signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw fail(`HTTP ${res.status}`, res.status)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.includes('Account Banned')) throw fail('MANGA Plus memblokir sementara, coba lagi nanti', 503)
      const root = decode(buf)
      const ok = msg(root, 1)
      if (!ok) throw fail(`MANGA Plus: ${str(msg(root, 2), 1) || 'respons tidak dikenal'}`.slice(0, 200), 502)
      return ok
    } catch (e) {
      last = e
      if ((e.status && e.status < 500 && e.status !== 429) || e.status === 503 || i === 2) break
      await sleep(400 * (i + 1))
    }
  }
  throw last
}

const call = (path, params = {}, ttl = 5 * MIN) => {
  const lang = currentLang()
  return cached(path + lang + JSON.stringify(params), ttl, () => request(path, { lang, ...params }))
}

const paginate = (list, page) => ({
  items: list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  page,
  pages: Math.max(1, Math.ceil(list.length / PAGE_SIZE)),
  total: list.length
})

const titleList = (view, slot) => {
  const out = []
  for (const g of nodes(view, slot)) {
    const t = msg(g, 2)
    if (t && isTitle(t)) out.push(mapTitle(t))
  }
  return out
}

/**
 * Daftar semua judul. Server mengelompokkan per serial: satu grup berisi varian bahasa
 * (judul + ID berbeda per bahasa). Dulu hanya varian pertama yang dibaca, sehingga memilih
 * Indonesia tetap menghasilkan judul/chapter bahasa lain.
 */
async function listType(type) {
  const d = await call('title_list/all_v3', { type }, 30 * MIN)
  const view = msg(d, 35)
  const genres = nodes(view, 2).map(g => ({ name: str(g, 1), slug: str(g, 2) })).filter(g => g.name)
  const groups = []
  for (const g of nodes(view, 3)) {
    const gg = nodes(g, 3).map(x => str(x, 2)).filter(Boolean)
    const variants = nodes(g, 2).filter(isTitle).map(t => ({ ...mapTitle(t), genres: gg }))
    if (variants.length) groups.push(variants)
  }
  if (!groups.length) {
    // struktur tak dikenal: kelompokkan sendiri berdasarkan judul + penulis agar bahasa tidak jadi duplikat
    const byName = new Map()
    for (const t of grab(d, isTitle, mapTitle)) {
      const k = `${t.title}|${t.author}`.toLowerCase()
      if (!byName.has(k)) byName.set(k, [])
      byName.get(k).push({ ...t, genres: [] })
    }
    groups.push(...byName.values())
  }
  return { genres, groups }
}

const everything = async types => {
  const all = await Promise.all(types.map(listType))
  const seen = new Set()
  const groups = []
  for (const g of all.flatMap(x => x.groups)) {
    if (g.some(t => seen.has(t.slug))) continue
    g.forEach(t => seen.add(t.slug))
    groups.push(g)
  }
  return { genres: uniq(all.flatMap(x => x.genres), 'name'), groups }
}

/** Satu serial -> satu judul: bahasa yang dipilih, kalau tidak ada English, kalau tidak ada varian pertama. */
const pick = (group, lang = currentLang()) => group.find(t => t.lang === lang) || group.find(t => t.lang === 'eng') || group[0]

const groupMatches = (group, tokens) => {
  const hay = `${group.map(t => t.title).join(' ')} ${group.map(t => t.author || '').join(' ')}`.toLowerCase()
  return tokens.every(t => hay.includes(t))
}

const tokensOf = q => q.toLowerCase().split(/\s+/).filter(Boolean)

/** Bahasa lain yang tersedia untuk serial ini: [{ code, slug }], masing-masing ID judul bahasa itu. */
async function variantsOf(slug, language) {
  const self = [{ code: language, slug }]
  try {
    const { groups } = await everything(TYPES)
    const g = groups.find(x => x.some(t => t.slug === slug))
    if (!g || g.length < 2) return self
    const found = g.map(t => ({ code: t.lang, slug: t.slug }))
    return LANGS.map(c => found.find(x => x.code === c)).filter(Boolean)
  } catch {
    return self
  }
}

/** Daftar ranking/terbaru: hanya judul bahasa terpilih (kalau server mengirim campuran). */
const inLang = items => {
  const lang = currentLang()
  const same = items.filter(t => t.lang === lang)
  return uniq(same.length ? same : items, 'slug')
}

export async function search(query, { limit = 10 } = {}) {
  const tokens = tokensOf(query)
  const { groups } = await everything(TYPES)
  return groups.filter(g => groupMatches(g, tokens)).map(g => pick(g)).slice(0, limit)
}

export async function latest({ page = 1 } = {}) {
  const d = await call('title_list/updated', {}, 2 * MIN)
  const out = []
  for (const g of nodes(msg(d, 20), 1)) {
    const t = msg(g, 1)
    if (t && isTitle(t)) out.push({ ...mapTitle(t), updatedAt: iso(int(g, 2)) })
  }
  const items = out.length ? out : grab(d, isTitle, mapTitle)
  return paginate(inLang(items), page).items
}

export async function popular({ period = '', limit = 10 } = {}) {
  const type = RANKINGS.includes(period) ? period : 'hottest'
  const d = await call('title_list/rankingV2', { type }, 10 * MIN)
  const out = []
  for (const t of nodes(msg(d, 37), 3)) {
    const n = msg(t, 2)
    if (n && isTitle(n)) out.push(mapTitle(n))
  }
  const items = out.length ? out : grab(d, isTitle, mapTitle)
  return inLang(items).slice(0, limit)
}

export async function browse({ q = '', type = '', genre = [], page = 1 } = {}) {
  const { genres, groups } = await everything(type ? [type] : q ? TYPES : ['serializing'])
  const wanted = [].concat(genre).filter(Boolean).map(g => genres.find(x => x.name.toLowerCase() === g || x.slug === g)?.slug ?? g)
  const tokens = tokensOf(q)
  const list = groups.filter(g => groupMatches(g, tokens) && wanted.every(w => g[0].genres.includes(w))).map(g => pick(g))
  return paginate(list, page)
}

export async function genres() {
  return (await everything(['serializing'])).genres.map(g => g.name)
}

async function detailCore(slug) {
  if (!/^\d+$/.test(slug)) throw fail(`Series "${slug}" tidak ditemukan`, 404)
  const d = await call('title_detailV4', { title_id: slug, avif_enable: 'yes' }, 5 * MIN).catch(e => {
    throw e.status === 404 || /MANGA Plus:/.test(e.message) ? fail(`Series "${slug}" tidak ditemukan`, 404) : e
  })
  const v = msg(d, 8)
  const t = msg(v, 1)
  if (!t || !str(t, 2)) throw fail(`Series "${slug}" tidak ditemukan`, 404)
  // Hanya chapter milik judul (bahasa) ini: chapter judul lain tidak boleh ikut tercampur.
  const chapters = uniq(grab(v, isChapter, n => ({ id: int(n, 2), tid: int(n, 1), ...mapChapter(n) })), 'id')
    .filter(c => c.tid === undefined || c.tid === Number(slug))
    .sort((a, b) => b.id - a.id)
    .map(({ id, tid, ...c }) => c)
  const next = iso(int(v, 5))
  return {
    title: str(t, 2).trim(),
    slug,
    url: `${SITE}/titles/${slug}`,
    cover: img(str(t, 4)),
    banner: img(str(v, 2)),
    alt: [],
    synopsis: (str(v, 3) || '').trim(),
    status: '',
    type: 'manga',
    language: titleLang(t),
    author: (str(t, 3) || '').trim(),
    artist: '',
    year: '',
    views: int(v, 18) ?? null,
    rating: null,
    ratingCount: null,
    genres: [],
    nextUpdate: next || null,
    totalChapters: chapters.length,
    chapters,
    related: []
  }
}

export async function detail(slug) {
  const d = await detailCore(slug)
  return { ...d, languages: await variantsOf(slug, d.language) }
}

export async function chapter(slug, chapterSlug) {
  const info = await detailCore(slug).catch(() => null)
  const list = info?.chapters ?? []
  let id = chapterSlug
  if (Number(id) < 1000) id = list.find(c => c.number === id)?.slug ?? id
  if (!/^\d+$/.test(id)) throw fail(`Chapter "${chapterSlug}" tidak ditemukan`, 404)

  const d = await call('manga_viewer_v3', { chapter_id: id, split: 'yes', img_quality: QUALITY }, 0).catch(e => {
    throw /MANGA Plus:/.test(e.message) ? fail('Chapter tidak tersedia (premium / kedaluwarsa)', 404) : e
  })
  const view = msg(d, 10)
  const token = str(view, 19) || ''
  const pages = grabPages(view)
  if (!pages.length) throw fail('Chapter tidak tersedia (premium / kedaluwarsa)', 404)

  const images = pages.map(p => {
    const frag = new URLSearchParams()
    if (p.key) frag.set('k', p.key)
    if (token) frag.set('t', token)
    return img(p.url) + (frag.size ? '#' + frag : '')
  })
  const idx = list.findIndex(c => c.slug === id)
  return {
    title: idx !== -1 ? list[idx].title || `Chapter ${list[idx].number}` : `Chapter ${id}`,
    comic: slug,
    chapter: id,
    number: idx !== -1 ? list[idx].number : id,
    url: `${SITE}/viewer/${id}`,
    totalImages: images.length,
    images,
    prev: idx !== -1 && idx < list.length - 1 ? list[idx + 1].slug : null,
    next: idx > 0 ? list[idx - 1].slug : null
  }
}

const xor = (buf, key) => {
  const out = Buffer.allocUnsafe(buf.length)
  for (let i = 0, j = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ key[j]
    if (++j === key.length) j = 0
  }
  return out
}

export function imagePrep(url) {
  const p = new URLSearchParams(url.hash.slice(1))
  const k = p.get('k')
  const t = p.get('t')
  const key = k && /^(?:[0-9a-f]{2}){1,256}$/i.test(k) ? Buffer.from(k, 'hex') : null
  const token = t && /^[\w.~-]{1,300}$/.test(t) ? t : null
  if (!key && !token) return null
  return { headers: token ? { 'plus-vw-token': token } : {}, decode: key ? buf => xor(buf, key) : null }
}

export const resetCache = () => memo.clear()

export default {
  id: 'mangaplus',
  name: 'MANGA Plus',
  base: SITE,
  imageHeaders: { 'user-agent': UA, referer: SITE + '/', origin: SITE },
  imageHosts,
  filters: { types: TYPES, languages: LANGS },
  imagePrep,
  search,
  latest,
  popular,
  browse,
  genres,
  detail,
  chapter
}
