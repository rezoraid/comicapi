import * as cheerio from 'cheerio'
import { createHttp, relaysFromEnv, clean, trackHost } from './utils.js'

const BASE = 'https://01.komiku.asia'
const UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36'

const MIN = 60 * 1000
const imageHosts = [new URL(BASE).hostname]

const http = createHttp({
  base: BASE,
  referer: `${BASE}/`,
  headers: { 'user-agent': UA },
  timeout: 12000,
  relay: relaysFromEnv('KOMIKU_RELAY', 'RELAY_URL')
})

/* ───────────── helpers ───────────── */

const absolute = value => {
  if (!value) return ''
  try {
    return new URL(value, BASE).href
  } catch {
    return ''
  }
}

const img = value => {
  const url = absolute(value)
  return url ? trackHost(imageHosts, url) : ''
}

const slugOf = value => {
  try {
    return new URL(value, BASE).pathname.match(/\/manga\/([^/]+)/)?.[1] || ''
  } catch {
    return ''
  }
}

const notFound = msg => Object.assign(new Error(msg), { status: 404 })

async function fetchPage(path, ttl = 0) {
  return cheerio.load(await http.get(path, { ttl }))
}

function jsonLd($) {
  const results = []
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const value = JSON.parse($(el).html() || '')
      results.push(...(Array.isArray(value) ? value : [value]))
    } catch {}
  })
  return results
}

const item = (o = {}) => ({
  title: '',
  slug: '',
  url: `${BASE}/manga/${o.slug}`,
  cover: '',
  type: '',
  status: '',
  rating: null,
  latestChapter: null,
  ...o
})

function parseCards($, selector = 'article') {
  const results = []
  const seen = new Set()

  $(selector).each((_, el) => {
    const card = $(el)
    const link = card.find('a[href*="/manga/"]').first()
    const slug = slugOf(link.attr('href'))
    if (!slug || seen.has(slug)) return

    const title = clean(card.find('h2, h3, h4').first().text() || link.attr('title') || link.attr('aria-label'))
    if (!title) return
    seen.add(slug)

    const image = card.find('img').first()
    const ratingText = [
      card.attr('aria-label'),
      card.find('[aria-label*="Rating"]').attr('aria-label'),
      card.find('.hero-rating, .top-stars, .trend-chips').text()
    ]
      .filter(Boolean)
      .join(' ')

    const ratingMatch = ratingText.match(/(?:Rating\s*)?(\d{1,2}(?:\.\d+)?)/i)
    const chapterMatch = card.text().match(/Chapter\s*(\d+(?:\.\d+)?)/i)

    results.push(
      item({
        title,
        slug,
        cover: img(image.attr('src') || image.attr('data-src')),
        rating: ratingMatch ? Number(ratingMatch[1]) : null,
        latestChapter: chapterMatch ? chapterMatch[1] : null
      })
    )
  })

  return results
}

/* ───────────── list endpoints ───────────── */

export async function search(query, { limit = 10 } = {}) {
  if (!clean(query)) return []
  const $ = await fetchPage(`/browse?q=${encodeURIComponent(query)}`, MIN)
  return parseCards($).slice(0, limit)
}

export async function latest({ page = 1, limit = 30 } = {}) {
  const $ = await fetchPage(page > 1 ? `/browse?page=${page}&sort=latest` : '/', MIN)
  let items = parseCards($, 'article.update-row')
  if (!items.length) items = parseCards($)
  return items.slice(0, limit)
}

export async function popular({ limit = 10 } = {}) {
  const $ = await fetchPage('/', 5 * MIN)
  let items = parseCards($, 'article.trend-card')
  if (!items.length) items = parseCards($)
  return items.slice(0, limit)
}

export async function browse({ q = '', page = 1, limit = 30 } = {}) {
  if (q) {
    const items = await search(q, { limit })
    return { items, page, total: items.length }
  }
  const $ = await fetchPage(`/browse?page=${page}`, 2 * MIN)
  const items = parseCards($).slice(0, limit)
  return { items, page, total: items.length }
}

/* ───────────── detail ───────────── */

export async function detail(slug) {
  const $ = await fetchPage(`/manga/${encodeURIComponent(slug)}`, 5 * MIN)
  const series = jsonLd($).find(x => x['@type'] === 'CreativeWorkSeries') || {}

  const title = clean(series.name || $('.detail h1').first().text() || $('h1').first().text())
  if (!title) throw notFound('Komik tidak ditemukan')

  const genres = Array.isArray(series.genre)
    ? series.genre
    : series.genre
      ? [series.genre]
      : $('.dgenres .dgenre-chip')
          .map((_, el) => clean($(el).text()))
          .get()

  const chapters = []
  const seen = new Set()

  $('a[href*="/read/id/"]').each((_, el) => {
    const a = $(el)
    const url = absolute(a.attr('href'))
    const match = url.match(/\/read\/id\/([^/]+)\/([^/?#]+)/)
    if (!match || seen.has(url)) return
    seen.add(url)

    const label = clean(a.text())
    const number = (label.match(/Chapter\s*(\d+(?:\.\d+)?)/i) || [])[1] || (match[2].match(/^ch(\d+)/i) || [])[1] || ''

    chapters.push({
      slug: match[2],
      number,
      title: label || `Chapter ${number}`,
      url,
      timeAgo: clean(a.find('time').text())
    })
  })

  // terbaru → terlama (urutan standar API); kalau ada nomor yang kosong, pakai urutan situs
  if (chapters.every(c => c.number !== '')) chapters.sort((a, b) => parseFloat(b.number) - parseFloat(a.number))

  const rating = Number(series.aggregateRating?.ratingValue)

  return {
    title,
    slug,
    url: `${BASE}/manga/${slug}`,
    cover: img(series.image || $('.detail-side img').first().attr('src') || $('meta[property="og:image"]').attr('content')),
    synopsis: clean(series.description || $('.synopsis-text').text()),
    type: clean($('.detail-type').text()),
    author: series.author?.name || '',
    status: '',
    rating: Number.isFinite(rating) && series.aggregateRating?.ratingValue != null ? rating : null,
    genres,
    totalChapters: Number(series.numberOfEpisodes) || chapters.length,
    chapters
  }
}

/* ───────────── chapter (gambar) ───────────── */

export async function chapter(slug, chapterSlug) {
  const [info, $] = await Promise.all([
    detail(slug).catch(() => null),
    fetchPage(`/read/id/${encodeURIComponent(slug)}/${encodeURIComponent(chapterSlug)}`, 5 * MIN)
  ])

  const meta = jsonLd($).find(x => x['@type'] === 'Chapter') || {}
  const images = []

  $('.rd-page-image, #kompaca-reader img').each((_, el) => {
    const src = img($(el).attr('src') || $(el).attr('data-src'))
    if (src && !/logo|loading\.gif|lazy\.jpg|promosi|iklan/i.test(src) && !images.includes(src)) images.push(src)
  })

  if (!images.length) throw notFound('Gambar chapter tidak ditemukan')

  const list = info?.chapters ?? []
  const idx = list.findIndex(c => c.slug === chapterSlug)

  return {
    title: clean($('.rd-ch-title').text() || $('h1').first().text() || meta.name),
    comic: slug,
    chapter: chapterSlug,
    number: idx !== -1 ? list[idx].number : (chapterSlug.match(/^ch(\d+)/i) || [])[1] || chapterSlug,
    url: `${BASE}/read/id/${slug}/${chapterSlug}`,
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
  imageHeaders: { 'user-agent': UA, referer: `${BASE}/` },
  imageHosts,
  search,
  latest,
  popular,
  browse,
  detail,
  chapter
}
