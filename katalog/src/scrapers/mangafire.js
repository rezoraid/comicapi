import * as cheerio from 'cheerio'
import { createHttp, relaysFromEnv, trackHost, clean, num, UA } from './utils.js'

const BASE = 'https://mangafire.to'
const LANG = 'en'
const MIN = 60 * 1000
const imageHosts = ['mangafire.to']

const TYPES = ['manga', 'manhwa', 'manhua', 'one_shot', 'doujinshi', 'novel']
const STATUSES = ['releasing', 'completed', 'on_hiatus', 'discontinued', 'info']
const SORTS = ['recently_updated', 'recently_added', 'release_date', 'trending', 'name_az', 'scores', 'most_viewed', 'most_favourited']

const http = createHttp({
  base: BASE,
  headers: { 'user-agent': UA, 'x-requested-with': 'XMLHttpRequest' },
  relay: relaysFromEnv('MANGAFIRE_RELAY', 'RELAY_URL')
})

const img = url => (url ? trackHost(imageHosts, new URL(url, BASE).href) : '')
const notFound = msg => Object.assign(new Error(msg), { status: 404 })
const slugOf = href => (String(href || '').match(/\/(?:manga|title)\/([^/?#]+)/) || [])[1] || ''
const idOf = slug => String(slug).split('.').pop()
const imgSrc = $el => $el.attr('data-src') || $el.attr('data-lazy-src') || $el.attr('src') || ''
const html = res => (typeof res?.result === 'string' ? res.result : res?.result?.html || '')
const chapterNo = s => String(s).replace(/^chapter-/i, '').replace(/-/g, '.')
const statusOf = s => ({ releasing: 'ongoing', completed: 'completed', on_hiatus: 'hiatus', discontinued: 'cancelled' })[String(s).toLowerCase().replace(/\s+/g, '_')] || clean(s).toLowerCase()

const item = (o = {}) => ({
  title: '',
  slug: '',
  url: `${BASE}/manga/${o.slug}`,
  cover: '',
  type: '',
  status: '',
  rating: null,
  chapterCount: null,
  chapters: [],
  ...o
})

function parseCards($) {
  const items = []
  $('.unit').each((_, el) => {
    const $el = $(el)
    const a = $el.find('a.poster').first().length ? $el.find('a.poster').first() : $el.find('a[href*="/manga/"], a[href*="/title/"]').first()
    const slug = slugOf(a.attr('href'))
    if (!slug || items.some(i => i.slug === slug)) return
    const $info = $el.find('.info').first()
    const title = clean($info.find('a[href*="/manga/"], a[href*="/title/"]').last().text()) || clean($el.find('img').first().attr('alt')) || slug
    const chapters = []
    $el.find('ul.content li a, .content a[href*="/read/"]').each((__, c) => {
      const m = String($(c).attr('href')).match(/\/read\/[^/]+\/[^/]+\/(chapter-[^/?#]+)/)
      if (m && chapters.length < 3) chapters.push({ slug: m[1], number: chapterNo(m[1]), isNew: false, timeAgo: clean($(c).find('span').last().text()) })
    })
    items.push(item({ title, slug, cover: img(imgSrc($el.find('img').first())), type: clean($el.find('.type').first().text()).toLowerCase(), chapters }))
  })
  return items
}

const pagesOf = $ => {
  let pages = 1
  $('.page-item a[href*="page="], a.page-link[href*="page="]').each((_, a) => {
    const m = String($(a).attr('href')).match(/[?&]page=(\d+)/)
    if (m) pages = Math.max(pages, parseInt(m[1], 10))
  })
  return pages
}

async function browse({ q = '', sort = '', status = '', type = '', genre = [], page = 1 } = {}) {
  const qs = new URLSearchParams()
  if (q) qs.set('keyword', q)
  if (type) qs.append('type[]', type)
  if (status) qs.append('status[]', status)
  for (const g of [].concat(genre).filter(Boolean)) qs.append('genre[]', g)
  qs.set('sort', sort || 'recently_updated')
  if (page > 1) qs.set('page', String(page))
  const $ = cheerio.load(await http.get(`/filter?${qs}`, { ttl: MIN }))
  const items = parseCards($)
  const total = parseInt(clean($('.head .total, .total').first().text()).replace(/[^\d]/g, ''), 10) || items.length
  return { items, page, pages: Math.max(pagesOf($), page), total }
}

const search = async (query, { limit = 10 } = {}) => (await browse({ q: query })).items.slice(0, limit)

const latest = async ({ page = 1 } = {}) => (await browse({ sort: 'recently_updated', page })).items

const popular = async ({ period = '', limit = 10 } = {}) => (await browse({ sort: period === 'all' ? 'most_viewed' : 'trending' })).items.slice(0, limit)

async function genres() {
  const $ = cheerio.load(await http.get('/filter', { ttl: 60 * MIN }))
  const out = []
  $('input[name="genre[]"]').each((_, el) => {
    const g = clean($(el).attr('id') ? $(`label[for="${$(el).attr('id')}"]`).text() : $(el).parent().text())
    if (g && !out.includes(g)) out.push(g)
  })
  if (out.length) return out
  $('a[href^="/genre/"]').each((_, a) => {
    const g = clean($(a).text())
    if (g && !out.includes(g)) out.push(g)
  })
  return out
}

function parseChapters($, slug) {
  const out = []
  $('li.item a[href*="/read/"], a[href*="/read/"][data-number]').each((_, a) => {
    const $a = $(a)
    const m = String($a.attr('href')).match(/\/read\/([^/]+)\/([^/]+)\/(chapter-[^/?#]+)/)
    if (!m || (slug && m[1] !== slug) || out.some(c => c.slug === m[3])) return
    const spans = $a.find('span')
    out.push({
      slug: m[3],
      number: String($a.attr('data-number') ?? $a.closest('li').attr('data-number') ?? chapterNo(m[3])),
      title: clean(spans.first().text()) || clean($a.attr('title')),
      timeAgo: spans.length > 1 ? clean(spans.last().text()) : ''
    })
  })
  return out.sort((x, y) => (parseFloat(y.number) || 0) - (parseFloat(x.number) || 0))
}

const chapterList = async slug => parseChapters(cheerio.load(html(await http.get(`/ajax/manga/${idOf(slug)}/chapter/${LANG}`, { json: true, ttl: MIN }))), slug)

async function detail(slug) {
  const page = await http.get(`/manga/${encodeURIComponent(slug)}`, { ttl: MIN })
  const $ = cheerio.load(page)
  const title = clean($('h1[itemprop="name"]').first().text()) || clean($('.info h1, h1').first().text())
  if (!title) throw notFound('Komik tidak ditemukan')
  const meta = {}
  $('.meta > div, .sidebar .meta div').each((_, el) => {
    const spans = $(el).children('span')
    if (spans.length < 2) return
    const key = clean($(spans[0]).text()).replace(/:$/, '').toLowerCase()
    if (key) meta[key] = clean($(spans[1]).text())
  })
  const genreList = []
  $('a[href^="/genre/"]').each((_, a) => {
    const g = clean($(a).text())
    if (g && !genreList.includes(g)) genreList.push(g)
  })
  let chapters = parseChapters($, slug)
  if (!chapters.length) chapters = await chapterList(slug).catch(() => [])
  const alt = clean($('.info h6').first().text())
  const dash = v => (v === '-' ? '' : v || '')
  const status = clean($('.info > p').first().text())
  return {
    title,
    slug,
    url: `${BASE}/manga/${slug}`,
    cover: img(imgSrc($('.poster img').first()) || $('meta[property="og:image"]').attr('content')),
    alt: alt ? alt.split(/\s*;\s*/).filter(Boolean) : [],
    synopsis: clean($('#synopsis .modal-content, .description').first().text()) || clean($('meta[property="og:description"]').attr('content')),
    status: statusOf(status || meta.status),
    type: clean($('.min-info a[href*="type="]').first().text() || meta.type).toLowerCase(),
    author: dash(meta.author || meta.authors),
    artist: dash(meta.artist),
    year: (clean(meta.published).match(/\d{4}/) || [])[0] || '',
    views: num((meta.views || '').replace(/,/g, '')),
    rating: num($('.rating-box .live-score, .score .live-score').first().text()),
    ratingCount: num($('.rating-box .live-score').first().parent().find('small, .count').first().text().replace(/,/g, '')),
    genres: genreList,
    totalChapters: chapters.length,
    chapters,
    related: []
  }
}

async function chapter(slug, chapterSlug) {
  const $list = cheerio.load(html(await http.get(`/ajax/read/${idOf(slug)}/chapter/${LANG}`, { json: true, ttl: MIN })))
  const list = parseChapters($list)
  const idx = list.findIndex(c => c.slug === chapterSlug)
  const target = $list('a[data-id]').filter((_, a) => String($list(a).attr('href') || '').endsWith(`/${chapterSlug}`)).first()
  const cid = target.attr('data-id')
  if (!cid) throw notFound('Chapter tidak ditemukan')
  const res = await http.get(`/ajax/read/chapter/${encodeURIComponent(cid)}`, { json: true, ttl: 5 * MIN })
  const images = (res?.result?.images || []).map(i => img(Array.isArray(i) ? i[0] : i)).filter(Boolean)
  if (!images.length) throw notFound('Chapter tidak ditemukan')
  return {
    title: `Chapter ${chapterNo(chapterSlug)}`,
    comic: slug,
    chapter: chapterSlug,
    number: chapterNo(chapterSlug),
    url: `${BASE}/read/${slug}/${LANG}/${chapterSlug}`,
    totalImages: images.length,
    images,
    prev: idx >= 0 ? list[idx + 1]?.slug || null : null,
    next: idx > 0 ? list[idx - 1].slug : null
  }
}

export const resetCache = () => http.clear()

export default {
  id: 'mangafire',
  name: 'MangaFire',
  base: BASE,
  imageHeaders: { 'user-agent': UA, referer: `${BASE}/` },
  imageHosts,
  filters: { types: TYPES, statuses: STATUSES, sorts: SORTS },
  search,
  latest,
  popular,
  browse,
  genres,
  detail,
  chapter
}
