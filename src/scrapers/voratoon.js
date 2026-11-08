import { createLimiter } from '../lib/limiter.js'
import { sleep, clean, trackHost } from './utils.js'

const BASE = 'https://voratoon.co'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
const MIN = 60 * 1000
const SESSION_TTL = 20 * 60 * MIN
const TYPES = ['manga', 'manhwa', 'manhua']
const SORTS = ['latest', 'popular']
const imageHosts = [new URL(BASE).hostname]

const limiter = createLimiter({ max: 8, maxQueue: 200, waitMs: 30000 })
const cache = new Map()
let session = null
let sessionPromise = null
let genreCache = null

const img = url => (url ? trackHost(imageHosts, url) : '')
const names = list => (Array.isArray(list) ? list.map(g => g?.data?.name).filter(Boolean) : [])
const badRequest = msg => Object.assign(new Error(msg), { status: 400 })
const notFound = msg => Object.assign(new Error(msg), { status: 404 })
const headers = cookie => ({ 'user-agent': UA, accept: 'application/json, text/plain, */*', referer: BASE + '/', cookie })

async function bootstrap(force = false) {
  if (!force && session && session.exp > Date.now()) return session.cookie
  if (sessionPromise) return sessionPromise
  sessionPromise = (async () => {
    const res = await fetch(BASE + '/', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) })
    const cookie = (res.headers.getSetCookie?.() || []).map(c => c.match(/(vt_proxy=[^;]+)/)?.[1]).find(Boolean)
    if (!cookie) throw new Error('Sesi Voratoon gagal dibuat (cookie vt_proxy tidak ada)')
    session = { cookie, exp: Date.now() + SESSION_TTL }
    return cookie
  })().finally(() => (sessionPromise = null))
  return sessionPromise
}

async function request(url, cookie) {
  const res = await fetch(url, { headers: headers(cookie), signal: AbortSignal.timeout(20000) })
  if (res.ok) return { data: await res.json().catch(() => ({})) }
  const body = (await res.text().catch(() => '')).slice(0, 200)
  const err = new Error(`HTTP ${res.status}`)
  err.status = res.status
  err.expired = res.status === 403 && body.includes('proxy_session_required')
  return { err }
}

async function fetchJson(url) {
  let last
  for (let i = 1; i <= 3; i++) {
    try {
      let r = await request(url, await bootstrap())
      if (r.err?.expired) r = await request(url, await bootstrap(true))
      if (!r.err) return r.data
      last = r.err
      if (r.err.status < 500 && r.err.status !== 429) break
    } catch (e) {
      last = e
    }
    await sleep(500 * i)
  }
  throw last
}

function api(path, ttl = MIN) {
  const hit = cache.get(path)
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.val)
  return limiter.run(() => fetchJson(BASE + path)).then(val => {
    if (ttl) {
      cache.set(path, { val, exp: Date.now() + ttl })
      if (cache.size > 500) cache.delete(cache.keys().next().value)
    }
    return val
  })
}

const item = (o = {}) => ({
  title: '',
  slug: '',
  url: `${BASE}/series/${o.slug}`,
  cover: '',
  type: '',
  status: '',
  rating: null,
  chapterCount: null,
  chapters: [],
  ...o
})

const fromApi = s => {
  const d = s?.data
  if (!d?.slug || !d.title) return null
  return item({
    title: d.title,
    slug: d.slug,
    cover: img(d.coverImage),
    type: d.format || '',
    status: d.status || '',
    rating: d.rating ?? null,
    chapterCount: d.totalChapters ?? null,
    views: s.dataMetadata?.totalViews ?? null
  })
}

async function list({ q = '', sort = '', type = '', page = 1, size = 24 } = {}) {
  const qs = new URLSearchParams({ page: String(page), take: String(size) })
  if (q) qs.set('title', q)
  if (sort) qs.set('sort', sort)
  if (type) qs.set('format', type)
  const res = await api(`/api/proxy/series?${qs}`)
  const items = (Array.isArray(res.data) ? res.data : []).map(fromApi).filter(Boolean)
  const total = Number(res.meta?.total) || items.length
  const pages = Number(res.meta?.lastPage) || 1
  return { items, page, pages: Math.max(pages, page), total }
}

export const search = async (query, { limit = 10 } = {}) => (await list({ q: query, size: limit })).items
export const latest = async ({ page = 1 } = {}) => (await list({ sort: 'latest', page })).items
export const popular = async ({ limit = 10 } = {}) => (await list({ sort: 'popular', size: limit })).items
export const browse = ({ q = '', sort = '', type = '', page = 1 } = {}) => list({ q, sort, type, page })

export async function genres() {
  if (!genreCache) genreCache = names((await api('/api/proxy/genres', 60 * MIN)).data)
  return genreCache
}

async function allChapters(slug) {
  const take = 100
  const out = []
  const seen = new Set()
  for (let p = 1; p <= 60; p++) {
    const res = await api(`/api/proxy/series/${encodeURIComponent(slug)}/chapters?take=${take}&page=${p}`)
    const rows = Array.isArray(res.data) ? res.data : []
    for (const c of rows) {
      const index = c.data?.index ?? c.chapterIndex
      if (index == null || seen.has(index)) continue
      seen.add(index)
      const extra = clean(c.data?.title).replace(/^(chapter|ch)\.?\s*\d+(?:\.\d+)?(?:\s*[:.-]\s*)?/i, '')
      out.push({
        slug: String(index),
        number: String(index),
        title: extra && extra !== String(index) ? `Chapter ${index}: ${extra}` : `Chapter ${index}`,
        timeAgo: '',
        views: c.views?.total ?? null,
        releaseDate: c.createdAt || null
      })
    }
    if (rows.length < take) break
  }
  return out.sort((a, b) => parseFloat(b.number) - parseFloat(a.number))
}

export async function detail(slug) {
  if (!slug) throw badRequest('Slug Voratoon wajib diisi')
  const [res, chapters] = await Promise.all([api(`/api/proxy/series/${encodeURIComponent(slug)}`, 5 * MIN), allChapters(slug)])
  const s = res?.data
  const d = s?.data
  if (!d) throw notFound('Komik tidak ditemukan')
  return {
    title: d.title,
    slug: d.slug || slug,
    url: `${BASE}/series/${d.slug || slug}`,
    cover: img(d.coverImage),
    alt: [d.nativeTitle].filter(Boolean),
    synopsis: clean(d.synopsis),
    status: d.status || '',
    type: d.format || '',
    author: d.author || '',
    artist: '',
    year: d.releaseDate ? String(d.releaseDate).slice(0, 4) : '',
    views: s.dataMetadata?.totalViews ?? null,
    rating: d.rating ?? null,
    ratingCount: null,
    genres: names(d.genres),
    totalChapters: chapters.length || d.totalChapters || 0,
    chapters,
    related: []
  }
}

export async function chapter(slug, chapterSlug) {
  if (!slug || chapterSlug == null) throw badRequest('Slug dan chapter wajib diisi')
  const res = await api(`/api/proxy/series/${encodeURIComponent(slug)}/chapters/${encodeURIComponent(chapterSlug)}`, 5 * MIN)
  const c = res?.data
  if (!c) throw notFound('Chapter tidak ditemukan')
  const images = (c.data?.images || []).map(u => img(typeof u === 'string' ? u : u?.url)).filter(Boolean)
  const number = String(c.chapterIndex ?? chapterSlug)
  const extra = clean(c.data?.title).replace(/^(chapter|ch)\.?\s*\d+(?:\.\d+)?(?:\s*[:.-]\s*)?/i, '')
  return {
    title: extra && extra !== number ? `Chapter ${number}: ${extra}` : `Chapter ${number}`,
    comic: slug,
    chapter: number,
    number,
    url: `${BASE}/series/${slug}/chapter/${number}`,
    totalImages: images.length,
    images,
    prev: null,
    next: null
  }
}

export const resetCache = () => {
  cache.clear()
  session = null
  genreCache = null
}

export default {
  id: 'voratoon',
  name: 'VoraToon',
  base: BASE,
  imageHeaders: { 'user-agent': UA, referer: BASE + '/' },
  imageHosts,
  filters: { types: TYPES, sorts: SORTS },
  search,
  latest,
  popular,
  browse,
  genres,
  detail,
  chapter
}
