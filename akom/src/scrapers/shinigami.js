import { createHttp, trackHost } from './utils.js'

const BASE = 'https://app.shinigami.asia'
const API = 'https://api.shngm.io'
const UA = 'Mozilla/5.0 (Android 14; Mobile; rv:153.0) Gecko/153.0 Firefox/153.0'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const MIN = 60 * 1000
const imageHosts = [
  'shinigami.id',
  'app.shinigami.asia',
  'api.shngm.io',
  'assets.shngm.id',
  'storage.shngm.id',
  '11.shinigami.asia'
]

const http = createHttp({
  base: API,
  referer: `${BASE}/`,
  headers: { 'user-agent': UA, origin: BASE, accept: 'application/json' }
})

/* ───────────── helpers ───────────── */

const idOf = v => (String(v ?? '').match(UUID) || [])[0] || null
const names = list => (Array.isArray(list) ? list.map(x => x?.name).filter(Boolean) : [])
const statusOf = s => ({ 1: 'ongoing', 2: 'hiatus' })[s] || 'completed'
const img = url => (url ? trackHost(imageHosts, url) : '')
const badRequest = msg => Object.assign(new Error(msg), { status: 400 })

async function api(path, ttl = MIN) {
  const res = await http.get(path, { json: true, ttl })
  if (res?.retcode !== undefined && res.retcode !== 0) throw new Error(res.message || 'API request gagal')
  return res
}

const item = (o = {}) => ({
  title: '',
  slug: '',
  url: `${BASE}/series/${o.slug}/`,
  cover: '',
  type: '',
  status: '',
  rating: null,
  chapterCount: null,
  chapters: [],
  ...o
})

function fromApi(m) {
  if (!m?.manga_id || !m.title) return null
  const tax = m.taxonomy ?? {}
  const ch = m.latest_chapter_number
  return item({
    title: m.title,
    slug: m.manga_id,
    cover: img(m.cover_portrait_url || m.cover_image_url),
    type: names(tax.Type)[0] || '',
    status: statusOf(m.status),
    rating: m.user_rate ?? null,
    genres: names(tax.Genre),
    views: m.views ?? m.view_count ?? m.total_views ?? null,
    chapters: ch != null ? [{ slug: m.latest_chapter_id || '', number: String(ch), isNew: false, timeAgo: m.latest_chapter_time ? String(m.latest_chapter_time) : '' }] : []
  })
}

async function list({ q = '', page = 1, size = 24 } = {}) {
  const qs = new URLSearchParams({ page: String(page), page_size: String(size) })
  if (q) qs.set('q', q)
  const res = await api(`/v1/manga/list?${qs}`)
  const items = (Array.isArray(res.data) ? res.data : []).map(fromApi).filter(Boolean)
  const total = Number(res.meta?.total_record) || items.length
  const pages = Number(res.meta?.total_page) || (total ? Math.ceil(total / size) : 1)
  return { items, page, pages: Math.max(pages, page), total }
}

/* ───────────── list endpoints ───────────── */

export async function search(query, { limit = 10 } = {}) {
  return (await list({ q: query, size: limit })).items
}

export async function latest({ page = 1 } = {}) {
  return (await list({ page })).items
}

export function browse({ q = '', page = 1 } = {}) {
  return list({ q, page })
}

/* ───────────── detail ───────────── */

async function allChapters(mangaId) {
  const size = 100
  const page = n =>
    api(
      `/v1/chapter/${encodeURIComponent(mangaId)}/list?${new URLSearchParams({
        page: String(n),
        page_size: String(size),
        sort_by: 'chapter_number',
        sort_order: 'desc'
      })}`
    )

  const first = await page(1)
  const records = Number(first.meta?.total_record) || 0
  const pages = Math.max(Number(first.meta?.total_page) || 1, records ? Math.ceil(records / size) : 1)
  // Ambil semua halaman (full chapter list, tanpa batasan artifisial)
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => page(i + 2).catch(() => null)))

  const seen = new Set()
  const out = []
  for (const batch of [first, ...rest]) {
    for (const c of Array.isArray(batch?.data) ? batch.data : []) {
      if (!c?.chapter_id || seen.has(c.chapter_id)) continue
      seen.add(c.chapter_id)
      const number = String(c.chapter_number ?? '')
      const extra = String(c.chapter_title || c.title || '')
        .replace(/^(chapter|ch)\.?\s*\d+(?:\s*[:.-]\s*)?/i, '')
        .trim()
      out.push({
        slug: c.chapter_id,
        number,
        title: extra && extra.toLowerCase() !== number.toLowerCase() ? `Chapter ${number}: ${extra}` : `Chapter ${number}`,
        timeAgo: '',
        releaseDate: c.release_date || c.created_at || c.updated_at || null
      })
    }
  }
  return out.sort((a, b) => parseFloat(b.number) - parseFloat(a.number))
}

export async function detail(slug) {
  const id = idOf(slug)
  if (!id) throw badRequest('Slug Shinigami harus berupa UUID manga')

  const [res, chapters] = await Promise.all([
    api(`/v1/manga/detail/${encodeURIComponent(id)}`, 5 * MIN),
    allChapters(id)
  ])
  const d = res?.data
  if (!d) throw Object.assign(new Error('Manga tidak ditemukan'), { status: 404 })
  const tax = d.taxonomy ?? {}

  return {
    title: d.title,
    slug: id,
    url: `${BASE}/series/${id}/`,
    cover: img(d.cover_portrait_url || d.cover_image_url),
    alt: [].concat(d.alternative_title || d.alternative_titles || d.title_alt || []).filter(Boolean),
    synopsis: d.description || '',
    status: statusOf(d.status),
    type: names(tax.Type)[0] || '',
    author: names(tax.Author).join(', '),
    artist: names(tax.Artist).join(', '),
    year: d.release_year ? String(d.release_year) : '',
    views: d.views ?? d.view_count ?? d.total_views ?? d.read_count ?? d.total_reader ?? null,
    rating: d.user_rate ?? null,
    ratingCount: null,
    genres: names(tax.Genre),
    totalChapters: chapters.length,
    chapters,
    related: []
  }
}

/* ───────────── chapter (gambar) ───────────── */

export async function chapter(slug, chapterSlug) {
  const id = idOf(chapterSlug)
  if (!id) throw badRequest('Chapter ID Shinigami harus berupa UUID')

  const res = await api(`/v1/chapter/detail/${id}`, 5 * MIN)
  const d = res?.data
  if (!d) throw Object.assign(new Error('Detail chapter tidak ditemukan'), { status: 404 })

  const ch = d.chapter || {}
  const root = ch.base_url || d.base_url || d.base_url_low || ''
  const images = (Array.isArray(ch.data) ? ch.data : [])
    .map(f => {
      if (/^https?:\/\//i.test(f)) return f
      return [root, ch.path, f].map(s => String(s || '').replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')
    })
    .map(img)

  const number = String(d.chapter_number ?? '')
  const extra = String(d.chapter_title || '').trim()
  const titled = extra && extra.toLowerCase() !== number.toLowerCase() && !/^ch(apter)?\s*\.?\s*\d+/i.test(extra)

  return {
    title: titled ? `Chapter ${number}: ${extra}` : `Chapter ${number}`,
    comic: d.manga_id || slug,
    chapter: d.chapter_id || id,
    number,
    url: `${BASE}/chapter/${id}`,
    totalImages: images.length,
    images,
    prev: d.prev_chapter_id || null,
    next: d.next_chapter_id || null
  }
}

/** Kosongkan cache HTTP (dipakai test). */
export const resetCache = () => http.clear()

export default {
  id: 'shinigami',
  name: 'Shinigami',
  base: BASE,
  imageHeaders: { 'user-agent': UA, referer: `${BASE}/`, origin: BASE },
  imageHosts,
  search,
  latest,
  browse,
  detail,
  chapter
}
