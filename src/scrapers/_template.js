import { createHttp, trackHost } from './utils.js'

const BASE = 'https://contoh-komik.com'
const MIN = 60 * 1000
const imageHosts = ['contoh-komik.com']

const http = createHttp({ base: BASE, headers: { accept: 'application/json' } })

const img = url => (url ? trackHost(imageHosts, url) : '')
const notFound = msg => Object.assign(new Error(msg), { status: 404 })

const toItem = m =>
  m?.slug && m.title
    ? { title: m.title, slug: m.slug, url: `${BASE}/series/${m.slug}/`, cover: img(m.cover), type: '', status: m.status || '', rating: null, chapterCount: null, chapters: [] }
    : null

const toItems = res => (Array.isArray(res?.data) ? res.data : []).map(toItem).filter(Boolean)

const search = async (query, { limit = 10 } = {}) => toItems(await http.get(`/api/search?${new URLSearchParams({ q: query })}`, { json: true, ttl: MIN })).slice(0, limit)

const latest = async ({ page = 1 } = {}) => toItems(await http.get(`/api/latest?page=${page}`, { json: true, ttl: MIN }))

const popular = async ({ limit = 10 } = {}) => toItems(await http.get('/api/popular', { json: true, ttl: 5 * MIN })).slice(0, limit)

const browse = async ({ q = '', page = 1 } = {}) => ({ items: toItems(await http.get(`/api/list?${new URLSearchParams({ q, page })}`, { json: true, ttl: 2 * MIN })), page, pages: page + 1, total: 0 })

const genres = async () => (await http.get('/api/genres', { json: true, ttl: 60 * MIN })).data || []

async function detail(slug) {
  const d = (await http.get(`/api/comic/${encodeURIComponent(slug)}`, { json: true, ttl: 5 * MIN }))?.data
  if (!d?.title) throw notFound('Komik tidak ditemukan')
  const chapters = (d.chapters || []).map(c => ({ slug: c.slug, number: String(c.number ?? ''), title: `Chapter ${c.number}`, timeAgo: '', releaseDate: c.date || null }))
  return {
    title: d.title,
    slug,
    url: `${BASE}/series/${slug}/`,
    cover: img(d.cover),
    alt: [],
    synopsis: d.synopsis || '',
    status: d.status || '',
    type: '',
    author: d.author || '',
    artist: '',
    year: '',
    views: null,
    rating: null,
    ratingCount: null,
    genres: d.genres || [],
    totalChapters: chapters.length,
    chapters,
    related: []
  }
}

async function chapter(slug, chapterSlug) {
  const d = (await http.get(`/api/chapter/${encodeURIComponent(slug)}/${encodeURIComponent(chapterSlug)}`, { json: true, ttl: 5 * MIN }))?.data
  if (!d?.images?.length) throw notFound('Chapter tidak ditemukan')
  const images = d.images.map(img)
  return { title: `Chapter ${d.number}`, comic: slug, chapter: chapterSlug, number: String(d.number ?? ''), url: `${BASE}/chapter/${chapterSlug}`, totalImages: images.length, images, prev: d.prev || null, next: d.next || null }
}

export default {
  id: 'contoh',
  name: 'Contoh Komik',
  base: BASE,
  imageHeaders: { referer: `${BASE}/` },
  imageHosts,
  search,
  latest,
  popular,
  browse,
  genres,
  detail,
  chapter
}
