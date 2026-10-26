import * as cheerio from 'cheerio'
import { createHttp, UA } from './utils.js'

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

// halaman Next.js: semua data ada di <script id="__NEXT_DATA__">
async function nextData(path, ttl = MIN) {
  const html = await http.get(path, { ttl })
  const raw = cheerio.load(html)('#__NEXT_DATA__').html()
  if (!raw) throw new Error(`SSR data tidak ditemukan: ${path}`)
  return JSON.parse(raw).props?.pageProps ?? {}
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
    rating: null,
    chapterCount: null,
    genres: genresOf(i),
    chapters: last ? [{ slug: last, number: last, isNew: false, timeAgo: '' }] : []
  }
}

const pageOf = (data, page) => {
  const max = parseInt(data?.maxPage ?? 1, 10) || 1
  const items = (data?.data ?? []).map(toItem).filter(x => x.slug)
  return { items, page, pages: Math.max(max, page), total: items.length }
}

const safePage = p => Math.max(1, parseInt(p, 10) || 1)

/* ───────────── list endpoints ───────────── */

export async function search(query, { limit = 10 } = {}) {
  const p = await nextData(`/komik/list?name=${encodeURIComponent(query)}&page=1`)
  return pageOf(p.initialData, 1).items.slice(0, limit)
}

export async function latest({ page = 1 } = {}) {
  page = safePage(page)
  const p = await nextData(`/komik/update?page=${page}`)
  return pageOf(p.initialData, page).items
}

export async function popular({ limit = 10 } = {}) {
  const d = (await nextData('/', 5 * MIN)).data ?? {}
  let list = d.updateProject ?? d.project ?? []
  if (!list.length) list = d.updateNonProject ?? []
  return list.slice(0, limit).map(toItem).filter(x => x.slug)
}

/** browse({ q, genre, type, page }) — type: manhwa | manga | manhua */
export async function browse({ q = '', genre = '', type = '', page = 1 } = {}) {
  page = safePage(page)
  const t = String(type || '').toLowerCase().trim()
  if (t) {
    const p = await nextData(`/komik/type/${encodeURIComponent(t)}?page=${page}`)
    return pageOf(p.data, page)
  }

  const g = [].concat(genre).filter(Boolean)[0] || ''
  const build = gen => {
    const qs = new URLSearchParams()
    if (q) qs.set('name', q)
    if (gen) qs.set('genre', gen)
    qs.set('page', String(page))
    return `/komik/list?${qs}`
  }

  let res = pageOf((await nextData(build(g))).initialData, page)
  if (g && !res.items.length) {
    // situsnya kadang case-sensitive: coba "Action" kalau "action" kosong
    const cap = g.charAt(0).toUpperCase() + g.slice(1)
    if (cap !== g) res = pageOf((await nextData(build(cap))).initialData, page)
  }
  return res
}

export async function genres() {
  return GENRES
}

/* ───────────── detail ───────────── */

async function chapterList(slug, latestChapter = '') {
  try {
    const json = await http.get(`/api/komik/${slug}/chapter?limit=1000`, { json: true, ttl: MIN })
    if (Array.isArray(json?.chapter) && json.chapter.length) {
      return json.chapter
        .map(c => ({
          slug: String(c.chapter),
          number: String(c.chapter),
          title: `Chapter ${c.chapter}`,
          timeAgo: '',
          date: c.updated_at ?? c.created_at ?? null
        }))
        .sort((a, b) => parseFloat(b.number) - parseFloat(a.number))
    }
  } catch {}

  // fallback: bikin daftar 1..latest_chapter
  const max = parseInt(String(latestChapter).match(/\d+/)?.[0] ?? 0, 10)
  const out = []
  for (let i = max; i >= 1; i--) out.push({ slug: String(i), number: String(i), title: `Chapter ${i}`, timeAgo: '', date: null })
  return out
}

export async function detail(slugOrUrl) {
  const slug = toSlug(slugOrUrl)
  if (!slug) throw new Error('Slug wajib diisi')

  const d = (await nextData(`/${slug}`)).data
  if (!d) {
    const err = new Error(`Komik "${slug}" tidak ditemukan`)
    err.status = 404
    throw err
  }

  const realSlug = d.title_slug || slug
  const chapters = await chapterList(slug, d.latest_chapter)
  return {
    title: d.title || realSlug,
    slug: realSlug,
    url: `${BASE}/${realSlug}`,
    cover: cover(d.gambar),
    alt: d.title_alt ? [d.title_alt] : [],
    synopsis: d.sinopsis || '',
    status: d.status || '',
    type: d.type || '',
    author: d.author || '',
    artist: d.artist || '',
    year: '',
    views: null,
    rating: d.rating?.value ? Number(Number(d.rating.value).toFixed(2)) : null,
    ratingCount: d.rating?.member ?? null,
    genres: genresOf(d),
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

  // beberapa chapter pakai nol di depan (5 → 05 / 005)
  const candidates = [ch]
  if (/^\d+$/.test(ch)) candidates.push(ch.padStart(3, '0'), ch.padStart(2, '0'))

  let props = null
  let resolved = ch
  for (let i = 0; i < candidates.length; i++) {
    try {
      props = await nextData(`/${slug}/chapter/${candidates[i]}`, 5 * MIN)
      resolved = candidates[i]
      break
    } catch (e) {
      if (i === candidates.length - 1) throw e
    }
  }

  let raw = Array.isArray(props?.imgList) ? props.imgList : []
  const alt = Boolean(props?.data?.data?.storageInter2)

  if (!raw.length) {
    try {
      const j = await http.get(`/api/imgs/${slug}/${resolved}`, { json: true, ttl: 5 * MIN })
      if (Array.isArray(j?.imageSrc)) raw = j.imageSrc
    } catch {}
  }

  // prev / next dari daftar chapter (sudah ke-cache kalau detail baru dibuka)
  const list = await chapterList(slug).catch(() => [])
  const idx = list.findIndex(c => c.number === ch || c.number === String(parseInt(ch, 10)))
  const next = idx > 0 ? list[idx - 1].slug : null
  const prev = idx !== -1 && idx < list.length - 1 ? list[idx + 1].slug : null

  return {
    title: `Chapter ${ch}`,
    comic: slug,
    chapter: ch,
    url: `${BASE}/${slug}/chapter/${resolved}`,
    images: raw.map(src => imageUrl(src, alt)).filter(Boolean),
    prev,
    next
  }
}

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
