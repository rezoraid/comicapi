import * as cheerio from 'cheerio'
import { createHttp, clean, trackHost } from './utils.js'

const BASE = 'https://manta.net'
const API = `${BASE}/manta/v1`
const FRONT = `${BASE}/front/v1`
const HOME_VERSION = process.env.MANTA_HOME_VERSION || '202606'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const MIN = 60 * 1000
const PAGE_SIZE = 20
const TYPES = ['comic', 'manga', 'novel']
const SECTIONS = { comic: 'comics', manga: 'manga', novel: 'novels' }
const imageHosts = []

const http = createHttp({
  base: BASE,
  referer: `${BASE}/en`,
  headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' }
})

/* ───────────── helpers ───────────── */

const loc = v => (v && typeof v === 'object' ? (v.en ?? Object.values(v)[0] ?? '') : (v ?? ''))
const img = url => (url ? trackHost(imageHosts, url) : '')

function typeOf(num, tags = []) {
  num = Number(num ?? 0)
  if (num === 40) return 'novel'
  if (num === 50 || num === 60) return 'manga'
  const novel = tags.some(t => t?.id === 292 || String(loc(t?.name ?? t)).toLowerCase() === 'novel')
  return novel ? 'novel' : 'comic'
}

const tagNames = tags => tags.map(t => (typeof t === 'string' ? t : loc(t.name))).filter(Boolean)

function coverOf(image = {}) {
  const k = ['1280x1840_720', '1280x1840_480', '1440x1440_720', '1440x1440_480', 'thumbnail1']
  for (const key of k) if (image[key]?.downloadUrl) return img(image[key].downloadUrl)
  return ''
}

const item = (o = {}) => ({
  title: '',
  slug: '',
  url: `${BASE}/en/series/${o.slug}`,
  cover: '',
  type: '',
  status: '',
  rating: null,
  chapterCount: null,
  chapters: [],
  ...o
})

function fromApi(raw) {
  const d = raw.data ?? {}
  const slug = String(raw.id ?? raw.seriesId ?? '')
  const count = raw.episodeCount ?? raw.latestEpisode?.ord ?? null
  return item({
    title: clean(loc(d.title) || raw.title),
    slug,
    cover: coverOf(raw.image) || img(raw.coverImage?.downloadUrl),
    type: typeOf(raw.type ?? raw.seriesType, d.tags),
    genres: tagNames(d.tags ?? []),
    chapterCount: count != null ? Number(count) : null
  })
}

async function homeSection(type) {
  const key = SECTIONS[type] || 'comics'
  const res = await http.get(`${FRONT}/home/${HOME_VERSION}?lang=en&homeType=${key}`, { json: true, ttl: 5 * MIN })
  const d = res?.data ?? {}
  const map = d.seriesMap ?? {}
  return (d.items ?? []).map(it => fromApi({ ...(map[it.seriesId] ?? {}), ...it })).filter(x => x.slug)
}

function paginate(list, page) {
  const start = (page - 1) * PAGE_SIZE
  return { items: list.slice(start, start + PAGE_SIZE), page, pages: Math.max(1, Math.ceil(list.length / PAGE_SIZE)), total: list.length }
}

async function pageProps(path, ttl) {
  const html = await http.get(path, { ttl })
  const raw = cheerio.load(html)('#__NEXT_DATA__').html()
  if (!raw) throw new Error(`SSR data tidak ditemukan: ${path}`)
  return JSON.parse(raw).props?.pageProps ?? {}
}

/* ───────────── list endpoints ───────────── */

export async function search(query, { limit = 10 } = {}) {
  const res = await http.get(`${API}/search/series?lang=en&q=${encodeURIComponent(query)}`, { json: true, ttl: MIN })
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2)
  const items = (Array.isArray(res?.data) ? res.data : []).map(fromApi).filter(x => x.slug)
  const hit = tokens.length ? items.filter(x => tokens.some(t => x.title.toLowerCase().includes(t))) : items
  return hit.slice(0, limit)
}

export async function latest({ page = 1 } = {}) {
  return paginate(await homeSection('comic'), page).items
}

export async function browse({ q = '', type = '', page = 1 } = {}) {
  if (q) {
    const items = await search(q, { limit: 1000 })
    return paginate(items, page)
  }
  return paginate(await homeSection(type), page)
}

/* ───────────── detail ───────────── */

export async function detail(slug) {
  const p = await pageProps(`/en/series/${encodeURIComponent(slug)}`, MIN)
  const s = p.initialSeries
  if (!s) {
    const err = new Error(`Series "${slug}" tidak ditemukan`)
    err.status = 404
    throw err
  }
  const d = s.data ?? {}
  const head = p.headData ?? {}

  const chapters = (s.episodes ?? [])
    .map(ep => ({
      slug: String(ep.id),
      number: String(ep.ord ?? ep.id),
      title: ep.data?.title ?? `Episode ${ep.ord}`,
      timeAgo: '',
      releaseDate: ep.openAt ?? null
    }))
    .sort((a, b) => parseFloat(b.number) - parseFloat(a.number))

  return {
    title: clean(loc(d.title) || head.title) || slug,
    slug,
    url: `${BASE}/en/series/${slug}`,
    cover: coverOf(s.image) || img(head.image),
    alt: [],
    synopsis: d.description?.long ?? d.description?.short ?? head.description ?? '',
    status: '',
    type: typeOf(s.type, d.tags),
    author: (d.creators ?? []).map(c => c.name).filter(Boolean).join(', '),
    artist: '',
    year: '',
    views: null,
    rating: null,
    ratingCount: null,
    genres: tagNames(d.tags ?? []),
    totalChapters: chapters.length,
    chapters,
    related: []
  }
}

/* ───────────── chapter (gambar) ───────────── */

export async function chapter(slug, chapterSlug) {
  const info = await detail(slug).catch(() => null)
  const list = info?.chapters ?? []

  let id = chapterSlug
  if (Number(id) < 1000) id = list.find(c => c.number === id)?.slug ?? id

  const p = await pageProps(`/en/episodes/${encodeURIComponent(id)}`, 5 * MIN)
  const images = (p.previewCutImages ?? []).map(i => img(i.downloadUrl)).filter(Boolean)

  const idx = list.findIndex(c => c.slug === id)
  return {
    title: p.previewEpisodeTitle ?? `Episode ${id}`,
    comic: slug,
    chapter: id,
    number: idx !== -1 ? list[idx].number : id,
    url: `${BASE}/en/episodes/${id}`,
    totalImages: images.length,
    images,
    prev: idx !== -1 && idx < list.length - 1 ? list[idx + 1].slug : null,
    next: idx > 0 ? list[idx - 1].slug : null
  }
}

/** Kosongkan cache HTTP (dipakai test). */
export const resetCache = () => http.clear()

export default {
  id: 'manta',
  name: 'Manta',
  base: BASE,
  imageHeaders: { 'user-agent': UA, referer: `${BASE}/en` },
  imageHosts,
  filters: { types: TYPES },
  search,
  latest,
  browse,
  detail,
  chapter
}
