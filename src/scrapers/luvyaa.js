import * as cheerio from 'cheerio'
import { createHttp, clean, num, trackHost } from './utils.js'

const BASE = 'https://v5.luvyaa.co'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const MIN = 60 * 1000
const SORTS = ['latest', 'popular']
const imageHosts = []

const http = createHttp({ base: BASE, referer: BASE, timeout: 30000, headers: { 'user-agent': UA } })

const GENRES = [
  'Action', 'Adult', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Harem', 'Historical', 'Horror', 'Isekai',
  'Josei', 'Martial Arts', 'Mature', 'Mecha', 'Medical', 'Mystery', 'Psychological', 'Reverse Harem', 'Romance',
  'School Life', 'Sci-Fi', 'Seinen', 'Shoujo', 'Shounen', 'Slice of Life', 'Smut', 'Sports', 'Supernatural',
  'Thriller', 'Tragedy'
]

/* ───────────── helpers ───────────── */

const pathOf = input => {
  let s = String(input || '').trim()
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname
    } catch {}
  }
  return s.replace(/^\/+|\/+$/g, '')
}
const comicSlug = href => pathOf(href).replace(/^manga\//i, '')
const genreSlug = g => String(g).trim().toLowerCase().replace(/\s+/g, '-')
const img = $el => trackHost(imageHosts, $el.attr('src') || $el.attr('data-src') || $el.attr('lazy-src') || '')
const NOISE = /banner|logo|readerarea\.svg/

// slug chapter di situs penuh ("judul-chapter-12"); ke klien dikirim tanpa prefix judul ("chapter-12")
const shortChapter = (comic, full) => (full.startsWith(comic + '-') ? full.slice(comic.length + 1) : full)

const notFound = msg => Object.assign(new Error(msg), { status: 404 })

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
  url: `${BASE}/${o.slug}/`,
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
  $('.bs .bsx, .listupd .bs, .page-item-detail').each((_, el) => {
    const $el = $(el)
    const a = $el.find('a').first()
    const href = a.attr('href')
    const slug = href ? comicSlug(href) : ''
    if (!slug || seen.has(slug)) return
    seen.add(slug)

    const latestHref = $el.find('.epxs a, .adds a').first().attr('href')
    const latestText = clean($el.find('.epxs, .adds .epxs, .ep').first().text())
    const chapters = []
    if (latestHref) {
      chapters.push({ slug: shortChapter(slug, pathOf(latestHref)), number: String(num(latestText) ?? latestText), isNew: false, timeAgo: '' })
    }

    out.push(
      item({
        title: clean($el.find('.tt, .series h4, h4, h3').first().text()) || clean(a.attr('title')),
        slug,
        cover: img($el.find('img').first()),
        type: clean($el.find('.type, .typeflag').first().text()),
        status: $el.find('.status.completed, .completed').length || /completed/i.test($el.text()) ? 'completed' : 'ongoing',
        rating: num($el.find('.numscore, .rating, .score').first().text()),
        chapters
      })
    )
  })
  return out
}

const hasNext = $ => $('.hpage .r, .pagination .next, a.next, .nav-previous a').length > 0

async function list(path, page, ttl = MIN) {
  const $ = cheerio.load(await http.get(path, { ttl }))
  const items = parseCards($)
  return { items, page, pages: hasNext($) ? page + 1 : page, total: items.length }
}

const pagePath = (base, page, query = '') => `${base}${page > 1 ? `page/${page}/` : ''}${query}`

/* ───────────── list endpoints ───────────── */

export async function search(query, { limit = 10 } = {}) {
  const { items } = await list(`/?s=${encodeURIComponent(query)}`, 1)
  return items.slice(0, limit)
}

export async function latest({ page = 1 } = {}) {
  return (await list(pagePath('/manga/', page, '?order=update'), page)).items
}

export async function popular({ limit = 10 } = {}) {
  return (await list('/manga/?order=popular', 1, 5 * MIN)).items.slice(0, limit)
}

export async function browse({ q = '', sort = '', genre = [], page = 1 } = {}) {
  const g = [].concat(genre).filter(Boolean)[0]
  if (g) return list(pagePath(`/genres/${genreSlug(g)}/`, page), page)
  if (q) return list(`${page > 1 ? `/page/${page}` : ''}/?s=${encodeURIComponent(q)}`, page)
  const order = sort === 'popular' ? 'popular' : 'update'
  return list(pagePath('/manga/', page, `?order=${order}`), page)
}

export async function genres() {
  const names = new Map(GENRES.map(n => [genreSlug(n), n]))
  try {
    const $ = cheerio.load(await http.get('/manga/', { ttl: 60 * MIN }))
    $("a[href*='/genres/'], a[href*='/genre/']").each((_, el) => {
      const name = clean($(el).text())
      const slug = pathOf($(el).attr('href')).replace(/^genres?\//, '')
      if (name && slug && !slug.includes('/') && !names.has(slug)) names.set(slug, name)
    })
  } catch {}
  return [...names.values()]
}

/* ───────────── detail ───────────── */

export async function detail(slug) {
  const html = await http.get(`/${encodeURIComponent(slug)}/`, { ttl: MIN })
  const $ = cheerio.load(html)

  const title = clean($('.entry-title').first().text()) || clean($('h1').first().text())
  if (!title) throw notFound('Komik tidak ditemukan')

  const alt = clean($('.alternative').first().text()) || clean($('.alter').first().text())
  const genreList = []
  $(".mgen a, .gnr a, a[href*='/genres/']").each((_, el) => {
    const g = clean($(el).text())
    if (g && !genreList.includes(g)) genreList.push(g)
  })

  const chapters = []
  const seen = new Set()
  $(
    '#chapterlist li, .eplister li, ul.main.version-chap li, li.wp-manga-chapter, .cl li, div.chapter-list li, .bxcl ul li, ul.cl li, .chapter-list-wrap li, div.eph-num, .lchx li'
  ).each((_, el) => {
    const $el = $(el)
    const href = $el.find('a').first().attr('href')
    const full = href ? pathOf(href) : ''
    if (!full || seen.has(full)) return
    seen.add(full)

    const label = clean($el.find('.chapternum, .chap, .chapter-title, .ep-title, span.ch').first().text()) || clean($el.find('a').first().text())
    chapters.push({
      slug: shortChapter(slug, full),
      number: (label.match(/Chapter\s+(\d+(?:\.\d+)?)/i) || [])[1] || String(num(full.replace(slug, '')) ?? ''),
      title: label,
      timeAgo: clean($el.find('.chapterdate, .date, .dt').first().text())
    })
  })
  sortChapters(chapters)

  const cover = img($('.thumb img, .bigcontent img').first()) || trackHost(imageHosts, $("meta[property='og:image']").attr('content') || '')

  return {
    title,
    slug,
    url: `${BASE}/${slug}/`,
    cover,
    alt: alt ? [alt] : [],
    synopsis: clean($('.entry-content, .entry-content-single, .desc, .synopsis').first().text()),
    status: clean($('.kh-status, .status-text').first().text()).toLowerCase(),
    type: '',
    author: '',
    artist: '',
    year: '',
    views: null,
    rating: num($('.rating-score, .num, .rating strong').first().text()),
    ratingCount: null,
    genres: genreList,
    totalChapters: chapters.length,
    chapters,
    related: []
  }
}

/* ───────────── chapter (gambar) ───────────── */

async function fetchChapter(slug, chapterSlug) {
  const n = String(chapterSlug).replace(/^chapter-/i, '')
  const candidates = [`${slug}-${chapterSlug}`, chapterSlug]
  if (/^\d+(?:[.-]\d+)?$/.test(n)) candidates.push(`${slug}-chapter-${n}`, `${slug}-chapter-${n.replace('.', '-')}`)
  let lastErr
  for (const full of new Set(candidates)) {
    try {
      return { full, html: await http.get(`/${encodeURIComponent(full)}/`, { ttl: 5 * MIN }) }
    } catch (e) {
      lastErr = e
      if (e.status !== 404) throw e
    }
  }
  throw lastErr
}

export async function chapter(slug, chapterSlug) {
  const { full, html } = await fetchChapter(slug, chapterSlug)
  const $ = cheerio.load(html)

  let images = []
  let prevUrl = null
  let nextUrl = null
  $('script').each((_, s) => {
    const code = $(s).html() || ''
    if (!code.includes('ts_reader')) return
    try {
      const m = code.match(/"images"\s*:\s*(\[[\s\S]*?\])/)
      if (m) images = JSON.parse(m[1]).filter(x => typeof x === 'string')
    } catch {}
    prevUrl = (code.match(/"prevUrl"\s*:\s*"([^"]*)"/) || [])[1] || prevUrl
    nextUrl = (code.match(/"nextUrl"\s*:\s*"([^"]*)"/) || [])[1] || nextUrl
  })

  if (!images.length) {
    $('#readerarea img').each((_, el) => images.push($(el).attr('src') || $(el).attr('data-src') || $(el).attr('lazy-src') || ''))
  }
  if (!images.length) {
    const $no = cheerio.load($('#readerarea noscript').html() || '')
    $no('img').each((_, el) => images.push($no(el).attr('src') || $no(el).attr('data-src') || ''))
  }
  images = images.filter(u => u && !NOISE.test(u)).map(u => trackHost(imageHosts, u))

  const link = sel => $(`.nextprev a[rel='${sel}'], .chapnav a[rel='${sel}']`).attr('href') || null
  const nb = raw => {
    const href = raw && !raw.includes('#') ? raw.trim() : ''
    return href ? shortChapter(slug, pathOf(href)) : null
  }

  return {
    title: clean($('h1.entry-title, h1').first().text()) || full,
    comic: slug,
    chapter: shortChapter(slug, full),
    url: `${BASE}/${full}/`,
    totalImages: images.length,
    images,
    prev: nb(prevUrl || link('prev')),
    next: nb(nextUrl || link('next'))
  }
}

/** Kosongkan cache HTTP (dipakai test). */
export const resetCache = () => http.clear()

export default {
  id: 'luvyaa',
  name: 'Luvyaa',
  base: BASE,
  imageHeaders: { 'user-agent': UA, referer: BASE + '/' },
  imageHosts,
  filters: { sorts: SORTS },
  search,
  latest,
  popular,
  browse,
  genres,
  detail,
  chapter
}
