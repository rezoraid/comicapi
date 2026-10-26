import * as cheerio from 'cheerio'
import { createHttp, clean, num, trackHost } from './utils.js'

// komiku.id redirects to komiku.org; use the canonical host to avoid an
// unnecessary redirect (and keep page, image, and referer URLs consistent).
const BASE = 'https://komiku.org'
const API = 'https://api.komiku.org'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const MIN = 60 * 1000
const TYPES = ['manga', 'manhwa', 'manhua']
const SORTS = ['latest', 'popular']
const imageHosts = []

const http = createHttp({ base: BASE, referer: BASE + '/', headers: { 'user-agent': UA } })

const GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Gore', 'Harem', 'Historical', 'Horror', 'Isekai', 'Josei',
  'Martial Arts', 'Mecha', 'Mystery', 'Psychological', 'Romance', 'School Life', 'Sci-Fi', 'Seinen', 'Shoujo', 'Shounen',
  'Slice of Life', 'Sports', 'Supernatural', 'Tragedy'
]

/* ───────────── helpers ───────────── */

const notFound = msg => Object.assign(new Error(msg), { status: 404 })
const genreSlug = g => String(g).trim().toLowerCase().replace(/\s+/g, '-')
const img = src => (src ? trackHost(imageHosts, src.startsWith('//') ? `https:${src}` : src) : '')

const pathOf = input => {
  let s = String(input || '').trim()
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname
    } catch {}
  }
  return s.replace(/^\/+|\/+$/g, '')
}

// "/manga/solo-leveling/" | "https://komiku.id/manga/solo-leveling/" | "solo-leveling-chapter-12" → "solo-leveling"
const comicSlug = href => pathOf(href).replace(/^manga\//i, '').replace(/-?chapter-.*$/i, '').replace(/\/.*$/, '')

// slug chapter di situs penuh ("judul-chapter-12"); ke klien dikirim tanpa prefix judul ("chapter-12")
const shortChapter = (comic, full) => (full.startsWith(comic + '-') ? full.slice(comic.length + 1) : full)

function chapterNum(text) {
  const cleaned = String(text ?? '')
    .replace(/Terbaru\s*:?/gi, '')
    .replace(/Awal\s*:?/gi, '')
    .replace(/Chapter\s*/gi, '')
    .replace(/Ch\.?\s*/gi, '')
  const m = cleaned.match(/(\d+(?:[.-]\d+)?)/)
  return m ? m[1].replace('-', '.') : ''
}

function sortChapters(list) {
  return list.sort((x, y) => {
    const a = parseFloat(x.number)
    const b = parseFloat(y.number)
    if (Number.isNaN(a) && Number.isNaN(b)) return 0
    if (Number.isNaN(a)) return 1
    if (Number.isNaN(b)) return -1
    return b - a
  })
}

const item = (o = {}) => ({
  title: '',
  slug: '',
  url: `${BASE}/manga/${o.slug}/`,
  cover: '',
  type: '',
  status: '',
  rating: null,
  chapterCount: null,
  chapters: [],
  ...o
})

function parseCards($) {
  const out = []
  const seen = new Set()
  $('.bge, .manga-card').each((_, el) => {
    const $el = $(el)
    const a = $el.find('a').first()
    const slug = comicSlug(a.attr('href'))
    if (!slug || seen.has(slug)) return
    seen.add(slug)

    const $img = $el.find('img').first()
    const tpe = $el.find('.tpe1_inf b').first().text()
    const num_ = chapterNum($el.find('.new1 a, .chapter, span').last().text())
    const chapters = num_ ? [{ slug: `chapter-${num_}`, number: num_, isNew: false, timeAgo: '' }] : []

    out.push(
      item({
        title: clean($el.find('h3, h4').first().text()) || clean(a.attr('title')) || slug,
        slug,
        cover: img($img.attr('data-src') || $img.attr('src') || ''),
        type: clean(tpe).toLowerCase(),
        chapters
      })
    )
  })
  return out
}

const hasNext = (items, $) => items.length >= 10 || $('a.next, .pagination .next, .hpage .r').length > 0

/** Coba endpoint publik satu per satu sampai ada hasil yang bisa diparse. */
async function list(paths, page, ttl = MIN) {
  let lastErr
  let emptyResult
  for (const path of paths) {
    try {
      const $ = cheerio.load(await http.get(path, { ttl }))
      const items = parseCards($)
      const result = { items, page, pages: hasNext(items, $) ? page + 1 : page, total: items.length }
      // A successful HTTP response can still be an empty page or a changed
      // template. Give the next public endpoint a chance before returning it.
      if (items.length) return result
      emptyResult ??= result
    } catch (e) {
      lastErr = e
    }
  }
  if (emptyResult) return emptyResult
  throw lastErr
}

const pageSeg = page => (page > 1 ? `page/${page}/` : '')

function typeListPaths(type, page, sort) {
  const order = sort === 'popular' ? 'meta_value_num' : 'modified'
  const q = `tipe=${encodeURIComponent(type)}&orderby=${order}`
  return [
    `${BASE}/daftar-komik/${pageSeg(page)}?${q}`,
    `${API}/manga/${pageSeg(page)}?${q}`
  ]
}

/* ───────────── list endpoints ───────────── */

export async function search(query, { limit = 10 } = {}) {
  const q = encodeURIComponent(query)
  const { items } = await list([
    `${BASE}/?s=${q}&post_type=manga`,
    `${BASE}/?s=${q}`,
    `${API}/?post_type=manga&s=${q}`
  ], 1)
  return items.slice(0, limit)
}

export async function latest({ page = 1 } = {}) {
  // beranda: manga & manhwa digabung selang-seling, halaman berikutnya manhwa saja (sama seperti perilaku asli)
  if (page > 1) return (await list(typeListPaths('manhwa', page, 'latest'), page)).items
  const [manga, manhwa] = await Promise.allSettled([
    list(typeListPaths('manga', 1, 'latest'), 1),
    list(typeListPaths('manhwa', 1, 'latest'), 1)
  ])
  const a = manga.status === 'fulfilled' ? manga.value.items : []
  const b = manhwa.status === 'fulfilled' ? manhwa.value.items : []
  if (!a.length && !b.length) {
    const failed = [manga, manhwa].find(r => r.status === 'rejected')
    if (failed) throw failed.reason
  }
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i])
    if (b[i]) out.push(b[i])
  }
  return out
}

export async function popular({ limit = 10 } = {}) {
  let items
  try {
    items = (await list(typeListPaths('manhwa', 1, 'popular'), 1, 5 * MIN)).items
  } catch {
    // Popular and latest use the same source; if the popular listing is
    // unavailable, latest is still a useful public fallback.
    return (await latest({ page: 1 })).slice(0, limit)
  }
  if (!items.length) items = (await latest({ page: 1 })).slice(0, limit)
  return items.slice(0, limit)
}

export async function browse({ q = '', type = '', sort = '', genre = [], page = 1 } = {}) {
  const g = [].concat(genre).filter(Boolean)[0]
  if (g) {
    if (TYPES.includes(g)) return list(typeListPaths(g, page, sort), page)
    const slug = encodeURIComponent(genreSlug(g))
    return list([`${BASE}/genre/${slug}/${pageSeg(page)}`, `${API}/genre/${slug}/${pageSeg(page)}`], page)
  }
  if (q) {
    const items = await search(q, { limit: 30 })
    return { items, page, pages: 1, total: items.length }
  }
  return list(typeListPaths(type || 'manhwa', page, sort), page)
}

export async function genres() {
  const names = new Map(GENRES.map(n => [genreSlug(n), n]))
  try {
    const $ = cheerio.load(await http.get('/daftar-komik/', { ttl: 60 * MIN }))
    $("a[href*='/genre/']").each((_, el) => {
      const name = clean($(el).text())
      const slug = pathOf($(el).attr('href')).replace(/^genre\//, '')
      if (name && slug && !slug.includes('/') && !names.has(slug)) names.set(slug, name)
    })
  } catch {}
  return [...names.values()]
}

/* ───────────── detail ───────────── */

const row = ($, label) => clean($(`.inftable tr:contains('${label}') td`).last().text())

export async function detail(slug) {
  const html = await http.get(`/manga/${encodeURIComponent(slug)}/`, { ttl: MIN })
  const $ = cheerio.load(html)

  const title = clean($('#Judul h1').text().replace(/^Komik\s+/i, ''))
  if (!title) throw notFound('Komik tidak ditemukan')

  const genreList = []
  $('.genre li, .genre a').each((_, el) => {
    const g = clean($(el).text())
    if (g && !genreList.includes(g)) genreList.push(g)
  })

  const chapters = []
  const seen = new Set()
  $('#Daftar_Chapter tr, .chapter tr, tbody tr').each((_, el) => {
    const $el = $(el)
    const href = $el.find('a').first().attr('href')
    if (!href || !/chapter-/i.test(href)) return
    const full = pathOf(href).replace(/^manga\//i, '')
    if (seen.has(full)) return
    seen.add(full)

    const number = (href.match(/chapter-(\d+(?:[.-]\d+)?)/i) || [])[1]?.replace('-', '.') || String(num($el.find('a').first().text()) ?? '')
    if (!number) return
    chapters.push({
      slug: shortChapter(slug, full),
      number,
      title: `Chapter ${number}`,
      timeAgo: clean($el.find('.tgl, .date').first().text())
    })
  })
  sortChapters(chapters)

  const $cover = $('.ims img').first()
  const alt = row($, 'Judul Indonesia')

  return {
    title,
    slug,
    url: `${BASE}/manga/${slug}/`,
    cover: img($cover.attr('data-src') || $cover.attr('src') || ''),
    alt: alt && alt !== title ? [alt] : [],
    synopsis: clean($('.desc, .sin').first().text()),
    status: row($, 'Status').toLowerCase(),
    type: (row($, 'Jenis') || '').toLowerCase().replace(/^komik\s*/, ''),
    author: row($, 'Pengarang'),
    artist: '',
    year: '',
    views: null,
    rating: null,
    ratingCount: null,
    genres: genreList,
    totalChapters: chapters.length,
    chapters,
    related: []
  }
}

/* ───────────── chapter (gambar) ───────────── */

const BAD_IMG = /lazy\.jpg|promosi|iklan|logo/i

async function fetchChapter(slug, chapterSlug) {
  const n = String(chapterSlug).replace(/^chapter-/i, '')
  const isNum = /^\d+(?:[.-]\d+)?$/.test(n)
  const candidates = [`${slug}-${chapterSlug}`, chapterSlug]
  if (isNum) {
    const d = n.replace('.', '-')
    candidates.push(`${slug}-chapter-${d}`, `${slug}-chapter-${d.padStart(2, '0')}`, `${slug}-chapter-${d.padStart(3, '0')}`)
  }

  let lastErr
  for (const full of new Set(candidates)) {
    try {
      const html = await http.get(`/${encodeURIComponent(full)}/`, { ttl: 5 * MIN })
      if (/Baca_Komik|chapter-body|article_content/.test(html)) return { full, html }
    } catch (e) {
      lastErr = e
      if (e.status !== 404) throw e
    }
  }

  // fallback: cari URL chapter dari daftar chapter di halaman detail
  const info = await detail(slug).catch(() => null)
  const target = info?.chapters.find(c => c.slug === chapterSlug || c.number === n || parseFloat(c.number) === parseFloat(n))
  if (target) {
    const full = `${slug}-${target.slug}`
    return { full, html: await http.get(`/${encodeURIComponent(full)}/`, { ttl: 5 * MIN }) }
  }
  throw lastErr || notFound(`Chapter ${chapterSlug} tidak ditemukan`)
}

export async function chapter(slug, chapterSlug) {
  const { full, html } = await fetchChapter(slug, chapterSlug)
  const $ = cheerio.load(html)

  const images = []
  $('#Baca_Komik img, .chapter-body img, #article_content img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-lazy-src') || ''
    if (src && !BAD_IMG.test(src)) images.push(img(src))
  })

  const short = shortChapter(slug, full)
  const info = await detail(slug).catch(() => null)
  const list = info?.chapters ?? []
  const idx = list.findIndex(c => c.slug === short)
  const number = idx !== -1 ? list[idx].number : chapterNum(short)

  return {
    title: clean($('h1').first().text()) || `Chapter ${number}`,
    comic: slug,
    chapter: short,
    number,
    url: `${BASE}/${full}/`,
    totalImages: images.length,
    images,
    prev: idx !== -1 && idx < list.length - 1 ? list[idx + 1].slug : null,
    next: idx > 0 ? list[idx - 1].slug : null
  }
}

/** Kosongkan cache HTTP (dipakai test). */
export const resetCache = () => http.clear()

export default {
  id: 'komiku',
  name: 'Komiku',
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
