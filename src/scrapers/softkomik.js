import { createHttp, UA } from './utils.js'
import { decrypt, looksEncrypted } from './softkomik-crypto.js'

const BASE = 'https://softkomik.co'
const COVER_BASE = 'https://cover.softdevices.my.id/softkomik-cover'
const IMAGE_HOST_1 = 'https://psy1.komik.im'
const IMAGE_HOST_2 = 'https://image.komik.im/softkomik'

const MIN = 60 * 1000
const TYPES = ['manhwa', 'manga', 'manhua']
const GENRES = [
  'Action', 'Fantasy', 'Romance', 'Comedy', 'Adventure', 'Drama', 'Isekai', 'School Life', 'Slice of Life',
  'Supernatural', 'Mystery', 'Sci-Fi', 'Shounen', 'Seinen', 'Shoujo', 'Josei', 'Webtoons', 'One Shot',
  'Reincarnation', 'Regression', 'System', 'Villainess', 'Magic', 'Demons', 'Monsters', 'Vampire',
  'Dark Fantasy', 'Time Travel', 'Academy', 'Martial Arts', 'Murim', 'Super Power', 'Revenge', 'Military',
  'Mecha', 'Apocalypse', 'Survival', 'Xianxia', 'Xuanhuan', 'Harem', 'Ecchi', 'Historical', 'Sports',
  'Cooking', 'Game', 'Music', 'Medical', 'Gender Bender', 'Horror', 'Psychological', 'Thriller', 'Tragedy',
  'Crime', 'Gore', 'Ghosts', 'Mature'
]

const http = createHttp({ base: BASE, headers: { origin: BASE } })

/* ───────────── helpers ───────────── */

const cover = p => (!p ? '' : /^https?:\/\//.test(p) ? p : `${COVER_BASE}/${String(p).replace(/^\/+/, '')}`)

function imageUrl(p, alt = false) {
  if (!p) return ''
  if (/^https?:\/\//.test(p)) return p
  return `${alt ? IMAGE_HOST_2 : IMAGE_HOST_1}/${String(p).replace(/^\/+/, '')}`
}

function toSlug(input) {
  return String(input || '')
    .trim()
    .replace(/^https?:\/\/softkomik\.(co|org)\//i, '')
    .split('/chapter')[0]
    .replace(/^\/+|\/+$/g, '')
}

function genresOf(i) {
  const g = i?.Genre ?? i?.genre ?? i?.genres
  if (Array.isArray(g)) return g
  return typeof g === 'string' && g ? [g] : []
}

// halaman Next.js: data ada di <script id="__NEXT_DATA__">. Detail & chapter kini
// dikirim terenkripsi di pageProps._stk → didekripsi lalu digabung ke pageProps.
function revive(props = {}) {
  let out = { ...props }
  if (typeof out._stk === 'string') {
    let plain
    try {
      plain = decrypt(out._stk)
    } catch (e) {
      const err = new Error(`Gagal mendekripsi data SoftKomik (kunci berubah? set env SOFTKOMIK_KEY): ${e.message}`)
      err.status = 502
      throw err
    }
    out = { ...out, ...plain }
  }
  delete out._stk
  for (const k of ['data', 'initialData']) if (looksEncrypted(out[k])) out[k] = decrypt(out[k])
  return out
}

async function nextData(path, ttl = MIN) {
  const html = await http.get(path, { ttl })
  const raw = String(html).match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1]
  if (!raw) throw new Error(`SSR data tidak ditemukan: ${path}`)
  return revive(JSON.parse(raw).props?.pageProps)
}

const isComicLike = x => x && typeof x === 'object' && (x.title_slug || (x.title && x.gambar))

// cari array komik di mana pun posisinya (struktur halaman bisa berubah)
function findItems(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return null
  if (Array.isArray(node)) {
    if (node.length && node.some(isComicLike)) return node
    for (const v of node) {
      const r = findItems(v, depth + 1)
      if (r) return r
    }
    return null
  }
  for (const v of Object.values(node)) {
    const r = findItems(v, depth + 1)
    if (r) return r
  }
  return null
}

function findKey(node, key, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return undefined
  if (key in node) return node[key]
  for (const v of Object.values(node)) {
    const r = findKey(v, key, depth + 1)
    if (r !== undefined) return r
  }
  return undefined
}

const normNum = x => {
  const s = String(x ?? '').trim()
  return /^\d+(\.\d+)?$/.test(s) ? String(parseFloat(s)) : s
}

// bentuk item list yang sama dengan scraper lain
function toItem(i) {
  const slug = i.title_slug || toSlug(i.url) || String(i._id ?? i.id ?? '')
  const last = i.latest_chapter ? String(i.latest_chapter) : ''
  return {
    title: i.title || slug,
    slug,
    url: `${BASE}/${slug}`,
    cover: cover(i.gambar),
    type: i.type || '',
    status: i.status || '',
    rating: i.rating?.value ? Number(Number(i.rating.value).toFixed(2)) : null,
    chapterCount: null,
    genres: genresOf(i),
    updatedAt: i.updated_at ?? null,
    chapters: last ? [{ slug: last, number: normNum(last), isNew: false, timeAgo: '' }] : []
  }
}

const pageOf = (root, page) => {
  const list = Array.isArray(root?.data) ? root.data : findItems(root) || []
  const max = parseInt(findKey(root, 'maxPage') ?? 1, 10) || 1
  const items = list.map(toItem).filter(x => x.slug)
  return { items, page, pages: Math.max(max, page), total: items.length }
}

// halaman list: data ada di initialData (atau data) tergantung rute
const listRoot = p => p.initialData ?? p.data ?? p

const safePage = p => Math.max(1, parseInt(p, 10) || 1)

/* ───────────── list endpoints ───────────── */

export async function search(query, { limit = 10 } = {}) {
  let items = []
  try {
    const p = await nextData(`/komik/list?name=${encodeURIComponent(query)}&page=1`)
    items = pageOf(listRoot(p), 1).items
  } catch {}
  if (!items.length) {
    // cadangan: endpoint pencarian yang dipakai kotak search situs
    try {
      const j = await http.get(`/api/content/search?name=${encodeURIComponent(query)}`, { json: true, ttl: MIN })
      items = (Array.isArray(j?.data) ? j.data : []).map(toItem).filter(x => x.slug)
    } catch {}
  }
  return items.slice(0, limit)
}

export async function latest({ page = 1 } = {}) {
  page = safePage(page)
  const p = await nextData(`/komik/update?page=${page}`)
  return pageOf(listRoot(p), page).items
}

export async function popular({ limit = 10 } = {}) {
  let list = []
  try {
    const home = await nextData('/', 5 * MIN)
    const d = home.data ?? home
    list = [d.updateProject, d.project, d.updateNonProject, d.popular, d.top].find(a => Array.isArray(a) && a.length) || findItems(home) || []
  } catch {}
  if (!list.length) {
    // beranda kosong / berubah: jangan balikin kosong, pakai daftar update terbaru
    try {
      list = (await latest({ page: 1 })).map(x => ({ ...x, title_slug: x.slug }))
      return list.slice(0, limit)
    } catch {}
  }
  return list.slice(0, limit).map(toItem).filter(x => x.slug)
}

/** browse({ q, genre, type, page }) — type: manhwa | manga | manhua */
export async function browse({ q = '', genre = '', type = '', page = 1 } = {}) {
  page = safePage(page)
  const t = String(type || '').toLowerCase().trim()
  if (t) {
    const p = await nextData(`/komik/type/${encodeURIComponent(t)}?page=${page}`)
    return pageOf(p.data ?? listRoot(p), page)
  }

  const g = [].concat(genre).filter(Boolean)[0] || ''
  const build = gen => {
    const qs = new URLSearchParams()
    if (q) qs.set('name', q)
    if (gen) qs.set('genre', gen)
    qs.set('page', String(page))
    return `/komik/list?${qs}`
  }

  let res = pageOf(listRoot(await nextData(build(g))), page)
  if (g && !res.items.length) {
    // situsnya kadang case-sensitive: coba "Action" kalau "action" kosong
    const cap = g.charAt(0).toUpperCase() + g.slice(1)
    if (cap !== g) res = pageOf(listRoot(await nextData(build(cap))), page)
  }
  return res
}

export async function genres() {
  return GENRES
}

/* ───────────── detail ───────────── */

const chapterEntry = (c, newest) => {
  const raw = String(c.chapter ?? c)
  const number = normNum(raw)
  return {
    slug: raw, // persis seperti di URL situs (mis. "005", "065.5")
    number,
    title: `Chapter ${number}`,
    timeAgo: '',
    date: c.updated_at ?? c.created_at ?? null,
    isNew: raw === newest
  }
}

const sortChapters = list => list.sort((a, b) => parseFloat(b.number) - parseFloat(a.number))

async function chapterList(slug, chapterData, latestChapter = '') {
  const newest = String(chapterData?.newChapter?.[0]?.chapter ?? latestChapter ?? '')

  if (Array.isArray(chapterData?.chapter) && chapterData.chapter.length) {
    return sortChapters(chapterData.chapter.map(c => chapterEntry(c, newest)))
  }

  try {
    const json = await http.get(`/api/komik/${slug}/chapter?limit=1000`, { json: true, ttl: MIN })
    if (Array.isArray(json?.chapter) && json.chapter.length) {
      return sortChapters(json.chapter.map(c => chapterEntry(c, newest)))
    }
  } catch {}

  // fallback terakhir: bikin daftar 1..latest_chapter
  const max = parseInt(String(latestChapter).match(/\d+/)?.[0] ?? 0, 10)
  const out = []
  for (let i = max; i >= 1; i--) out.push(chapterEntry({ chapter: String(i) }, String(max)))
  return out
}

const splitAlt = s =>
  String(s || '')
    .split(/\s*,\s*/)
    .map(x => x.trim())
    .filter(Boolean)

export async function detail(slugOrUrl) {
  const slug = toSlug(slugOrUrl)
  if (!slug) throw new Error('Slug wajib diisi')

  const props = await nextData(`/${slug}`)
  const d = props.data
  if (!d || typeof d !== 'object' || (!d.title && !d.title_slug)) {
    const err = new Error(`Komik "${slug}" tidak ditemukan`)
    err.status = 404
    throw err
  }

  const realSlug = d.title_slug || slug
  const chapters = await chapterList(slug, props.chapterData, d.latest_chapter)
  const rating = d.rating?.value ? d.rating : props.ratingData?.rating
  const first = props.chapterData?.startChapter?.[0]?.chapter ?? chapters[chapters.length - 1]?.slug ?? null
  const newest = props.chapterData?.newChapter?.[0]?.chapter ?? chapters[0]?.slug ?? null

  return {
    title: d.title || realSlug,
    slug: realSlug,
    url: `${BASE}/${realSlug}`,
    cover: cover(d.gambar),
    alt: splitAlt(d.title_alt),
    synopsis: String(d.sinopsis || '').replace(/\r\n?/g, '\n').trim(),
    status: d.status || '',
    type: d.type || '',
    author: d.author || '',
    artist: d.artist || '',
    year: d.tahun ? String(d.tahun) : '',
    views: d.views ?? null,
    rating: rating?.value ? Number(Number(rating.value).toFixed(2)) : null,
    ratingCount: rating?.member ?? null,
    genres: genresOf(d),
    adult: Boolean(d.GenrePeringatan) || d.contentRating === 'adult_plus',
    contentRating: d.contentRating || '',
    updatedAt: d.updated_at ?? null,
    firstChapter: first != null ? String(first) : null,
    latestChapter: newest != null ? String(newest) : null,
    totalChapters: chapters.length,
    chapters, // terbaru → terlama
    related: []
  }
}

/* ───────────── chapter (gambar) ───────────── */

export async function chapter(slugOrUrl, chapterNum) {
  let slug = toSlug(slugOrUrl)
  let ch = chapterNum != null ? String(chapterNum).trim() : ''
  if (String(slugOrUrl).includes('/chapter/')) {
    const [a, b] = String(slugOrUrl).split('/chapter/')
    slug = toSlug(a)
    ch = b.replace(/^\/+|\/+$/g, '')
  }
  if (!slug || !ch) throw new Error('Slug komik dan nomor chapter wajib diisi')

  // daftar chapter (dari halaman detail, ter-cache) → tahu format asli ("005" vs "5")
  let list = []
  try {
    const dp = await nextData(`/${slug}`)
    list = await chapterList(slug, dp.chapterData, dp.data?.latest_chapter)
  } catch {}
  const want = normNum(ch)
  const known = list.find(c => c.slug === ch) || list.find(c => c.number === want)

  const candidates = [...new Set([known?.slug, ch, ...(/^\d+$/.test(ch) ? [ch.padStart(3, '0'), ch.padStart(2, '0')] : [])].filter(Boolean))]

  let props = null
  let resolved = candidates[0]
  let lastErr
  for (const c of candidates) {
    try {
      const p = await nextData(`/${slug}/chapter/${c}`, 5 * MIN)
      if (p.data || p.imgList) {
        props = p
        resolved = c
        break
      }
    } catch (e) {
      lastErr = e
    }
  }
  if (!props) {
    if (lastErr) throw lastErr
    const err = new Error(`Chapter "${ch}" tidak ditemukan`)
    err.status = 404
    throw err
  }

  let raw = Array.isArray(props.imgList) ? props.imgList : []
  const alt = Boolean(props.data?.data?.storageInter2)

  if (!raw.length) {
    try {
      const j = await http.get(`/api/imgs/${slug}/${resolved}`, { json: true, ttl: 5 * MIN })
      if (Array.isArray(j?.imageSrc)) raw = j.imageSrc
    } catch {}
  }

  // prev / next: pakai data dari halaman chapter, cadangan dari daftar chapter
  const idx = list.findIndex(c => c.slug === resolved)
  const nb = props.data?.nextChapter?.[0]?.chapter
  const pb = props.data?.prevChapter?.[0]?.chapter
  const next = nb != null ? String(nb) : idx > 0 ? list[idx - 1].slug : null
  const prev = pb != null ? String(pb) : idx !== -1 && idx < list.length - 1 ? list[idx + 1].slug : null

  const komik = props.data?.komik ?? {}
  const images = raw.map(src => imageUrl(src, alt)).filter(Boolean)

  return {
    title: `Chapter ${normNum(resolved)}`,
    comic: slug,
    comicTitle: komik.title || '',
    cover: cover(komik.gambar),
    chapter: resolved,
    number: normNum(resolved),
    url: `${BASE}/${slug}/chapter/${resolved}`,
    totalImages: images.length,
    images,
    prev,
    next
  }
}

/** Kosongkan cache HTTP (dipakai test). */
export const resetCache = () => http.clear()

/* ───────────── provider export ───────────── */

export default {
  id: 'softkomik',
  name: 'SoftKomik',
  base: BASE,
  filters: { types: TYPES },
  imageHosts: ['softkomik.co', 'cover.softdevices.my.id', 'psy1.komik.im', 'image.komik.im'],
  imageHeaders: { 'user-agent': UA, referer: BASE + '/', origin: BASE },
  search,
  latest,
  popular,
  browse,
  genres,
  detail,
  chapter
}
