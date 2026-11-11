import { createHttp, clean, trackHost } from './utils.js'

const ORIGIN = process.env.COSMIC_ORIGIN || 'https://04.cosmicscans.to'
const API = 'https://cdncid.csmcscns.id/v1/manga'
const MIN = 60 * 1000
const imageHosts = ['cdncid.csmcscns.id', 'dbm.my.id']

const http = createHttp({
  base: API,
  referer: ORIGIN + '/',
  headers: { origin: ORIGIN, accept: 'application/json' }
})

const img = url => (url ? trackHost(imageHosts, url) : '')
const stripHtml = s => clean(String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'))
const rate = v => {
  const n = parseFloat(v)
  return Number.isFinite(n) && n > 0 ? n : null
}
const notFound = msg => Object.assign(new Error(msg), { status: 404 })

async function api(path, ttl = MIN) {
  const res = await http.get(path, { json: true, ttl })
  if (res?.success === false) throw new Error(res.message || 'API request gagal')
  return res
}

const chapterOf = c => ({
  slug: c.slug,
  number: String(c.chapterNum ?? ''),
  title: c.chapterNum != null ? `Chapter ${c.chapterNum}` : '',
  isNew: false,
  timeAgo: '',
  releaseDate: c.time || null
})

const byNumber = (a, b) => (parseFloat(b.number) || 0) - (parseFloat(a.number) || 0)

const item = (o = {}) => ({
  title: '',
  slug: '',
  url: `${ORIGIN}/series/${o.slug}/`,
  cover: '',
  type: '',
  status: '',
  rating: null,
  chapterCount: null,
  chapters: [],
  ...o
})

const fromApi = m =>
  m?.slug && m.title
    ? item({
        title: m.title,
        slug: m.slug,
        cover: img(m.cover),
        status: m.status || '',
        rating: rate(m.rating),
        chapters: (m.chapters || []).filter(c => c?.slug).map(chapterOf)
      })
    : null

const rows = res => (Array.isArray(res?.data) ? res.data : []).map(fromApi).filter(Boolean)

export async function search(query, { limit = 10 } = {}) {
  const res = await api(`/search?${new URLSearchParams({ q: query, genres: '' })}`)
  return rows(res).slice(0, limit)
}

export async function latest({ page = 1 } = {}) {
  const qs = new URLSearchParams({ limit: '27' })
  if (page > 1) qs.set('page', String(page))
  return rows(await api(`/latest?${qs}`))
}

export async function popular({ limit = 10 } = {}) {
  return rows(await api(`/popularToday?limit=${limit}`, 5 * MIN)).slice(0, limit)
}

export async function browse({ q = '', genre = [], page = 1 } = {}) {
  const size = 20
  if (q || [].concat(genre).filter(Boolean).length) {
    const qs = new URLSearchParams({ q, genres: [].concat(genre).filter(Boolean).join(',') })
    const items = rows(await api(`/search?${qs}`))
    return { items, page: 1, pages: 1, total: items.length }
  }
  const qs = new URLSearchParams({ limit: String(size) })
  if (page > 1) qs.set('page', String(page))
  const res = await api(`/allComics?${qs}`)
  const items = rows(res)
  const total = Number(res.total ?? res.meta?.total) || 0
  const pages = Number(res.totalPages ?? res.meta?.totalPages) || (items.length === size ? page + 1 : page)
  return { items, page, pages: Math.max(pages, page), total: total || items.length }
}

export async function detail(slug) {
  const res = await api(`/mangaDetail/${encodeURIComponent(slug)}`, 5 * MIN)
  const d = res?.data
  if (!d?.title) throw notFound('Komik tidak ditemukan')
  const chapters = (d.chapters || []).filter(c => c?.slug).map(chapterOf).sort(byNumber)
  return {
    title: d.title,
    slug: d.slug || slug,
    url: `${ORIGIN}/series/${d.slug || slug}/`,
    cover: img(d.big_cover || d.cover),
    alt: [],
    synopsis: stripHtml(d.sinopsis),
    status: d.status || '',
    type: '',
    author: d.author || '',
    artist: d.artist || '',
    year: d.published ? String(d.published) : '',
    views: d.views ?? null,
    rating: rate(d.rating),
    ratingCount: null,
    genres: Array.isArray(d.genre) ? d.genre : [],
    totalChapters: chapters.length,
    chapters,
    related: []
  }
}

export const resetCache = () => http.clear()

export default {
  id: 'cosmic',
  name: 'CosmicScans',
  base: ORIGIN,
  imageHeaders: { 'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', referer: ORIGIN + '/' },
  imageHosts,
  search,
  latest,
  popular,
  browse,
  detail
}
