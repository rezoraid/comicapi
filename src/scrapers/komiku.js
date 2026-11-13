import * as cheerio from 'cheerio'
import { createMirrorHttp, relaysFromEnv, clean, trackHost } from './utils.js'

const BASES = ['https://komiku.id', 'https://komiku.org']
const API = 'https://api.komiku.org'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36'
const RELAYS = relaysFromEnv('KOMIKU_RELAY', 'RELAY_URL')

const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'

const MIN = 60 * 1000
const TYPES = ['manga', 'manhwa', 'manhua']
const SORTS = ['latest', 'popular']
const imageHosts = ['komiku.org', 'komiku.id']
const BAD_IMG = /lazy\.jpg|promosi|iklan|logo/i

const GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Gore', 'Harem', 'Historical', 'Horror', 'Isekai', 'Josei',
  'Martial Arts', 'Mecha', 'Mystery', 'Psychological', 'Romance', 'School Life', 'Sci-Fi', 'Seinen', 'Shoujo', 'Shounen',
  'Slice of Life', 'Sports', 'Supernatural', 'Tragedy'
]

const browserHeaders = (ua, mobile) => ({
  'user-agent': ua,
  accept: ACCEPT,
  'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
  'sec-ch-ua-mobile': mobile ? '?1' : '?0',
  'sec-ch-ua-platform': mobile ? '"Android"' : '"Windows"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'upgrade-insecure-requests': '1'
})

const PROFILES = [{ 'user-agent': UA, accept: ACCEPT }, browserHeaders(UA, false), browserHeaders(MOBILE_UA, true)]
const clients = PROFILES.map(headers => createMirrorHttp({ bases: BASES, headers, retries: 1, fatal: [404, 403] }))
const relayed = createMirrorHttp({ bases: BASES, headers: PROFILES[0], retries: 1, fatal: [404, 403], relay: RELAYS })
let profile = 0
let relayUntil = 0

async function direct(path, opts) {
  let lastErr = null
  for (let n = 0; n < clients.length; n++) {
    const i = (profile + n) % clients.length
    try {
      const out = await clients[i].get(path, opts)
      profile = i
      return out
    } catch (e) {
      if (e.status !== 403) throw e
      lastErr = e
    }
  }
  throw lastErr
}

const http = {
  async get(path, opts) {
    if (Date.now() < relayUntil) {
      try {
        return await relayed.get(path, opts)
      } catch (e) {
        if (e.status === 404) throw e
        relayUntil = 0
      }
    }
    try {
      return await direct(path, opts)
    } catch (e) {
      if (e.status !== 403 || !RELAYS.length) throw e
      try {
        const out = await relayed.get(path, opts)
        relayUntil = Date.now() + 10 * 60 * 1000
        return out
      } catch (r) {
        throw r.status === 404 ? r : e
      }
    }
  },
  base: () => clients[profile].base(),
  clear: () => {
    clients.forEach(c => c.clear())
    relayed.clear()
  }
}

const site = () => http.base()
const notFound = msg => Object.assign(new Error(msg), { status: 404 })
const genreSlug = g => String(g).trim().toLowerCase().replace(/\s+/g, '-')
const pageSeg = page => (page > 1 ? `page/${page}/` : '')

function absolute(src) {
  const s = String(src || '').trim()
  if (!s) return ''
  if (s.startsWith('//')) return `https:${s}`
  if (s.startsWith('/')) return site() + s
  return s.replace(/^http:\/\//i, 'https://')
}

const img = src => (src ? trackHost(imageHosts, absolute(src)) : '')

function pickImage($el) {
  for (const name of ['data-src', 'data-lazy-src', 'data-original', 'src']) {
    const v = ($el.attr(name) || '').trim()
    if (v && !BAD_IMG.test(v) && !v.startsWith('data:')) return v
  }
  return ''
}

function pathOf(input) {
  let s = String(input || '').trim()
  if (/^https?:\/\//i.test(s)) {
    try {
      s = new URL(s).pathname
    } catch {}
  }
  return s.replace(/^\/+|\/+$/g, '')
}

const comicSlug = href => pathOf(href).replace(/^manga\//i, '').replace(/\/.*$/, '').replace(/-chapter-\d.*$/i, '')

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

function statusOf(raw) {
  const s = clean(raw).toLowerCase()
  if (/tamat|completed|selesai/.test(s)) return 'completed'
  if (/berjalan|ongoing/.test(s)) return 'ongoing'
  return s
}

const item = (o = {}) => ({
  title: '',
  slug: '',
  url: `${site()}/manga/${o.slug}/`,
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
    const a = $el.find('a[href*="/manga/"]').first().length ? $el.find('a[href*="/manga/"]').first() : $el.find('a').first()
    const slug = comicSlug(a.attr('href'))
    if (!slug || seen.has(slug)) return
    seen.add(slug)

    const latestNum = chapterNum($el.find('.new1 a').last().text() || $el.find('.chapter').last().text())
    const chapters = latestNum ? [{ slug: `chapter-${latestNum}`, number: latestNum, isNew: false, timeAgo: '' }] : []

    out.push(
      item({
        title: clean($el.find('h3, h4').first().text()) || clean(a.attr('title')) || slug,
        slug,
        cover: img(pickImage($el.find('img').first())),
        type: clean($el.find('.tpe1_inf b').first().text()).toLowerCase(),
        chapters
      })
    )
  })
  return out
}

const hasNext = (items, $) => items.length >= 10 || $('a.next, .pagination .next, .hpage .r').length > 0

async function list(paths, page, ttl = MIN) {
  let lastErr = null
  let empty = null
  for (const path of paths) {
    try {
      const $ = cheerio.load(await http.get(path, { ttl }))
      const items = parseCards($)
      const result = { items, page, pages: hasNext(items, $) ? page + 1 : page, total: items.length }
      if (items.length) return result
      empty = result
    } catch (e) {
      lastErr = e
    }
  }
  if (empty) return empty
  throw lastErr
}

function typeListPaths(type, page, sort) {
  const order = sort === 'popular' ? 'meta_value_num' : 'modified'
  const t = encodeURIComponent(type)
  return [`${API}/manga/${pageSeg(page)}?tipe=${t}&orderby=${order}`, `/daftar-komik/${pageSeg(page)}?tipe=${t}`]
}

export async function search(query, { limit = 10 } = {}) {
  const q = encodeURIComponent(query)
  const { items } = await list([`${API}/?post_type=manga&s=${q}`, `/?post_type=manga&s=${q}`], 1)
  return items.slice(0, limit)
}

export async function latest({ page = 1 } = {}) {
  if (page > 1) return (await list(typeListPaths('manhwa', page, 'latest'), page)).items
  const [manga, manhwa] = await Promise.allSettled([
    list(typeListPaths('manga', 1, 'latest'), 1),
    list(typeListPaths('manhwa', 1, 'latest'), 1)
  ])
  const a = manga.status === 'fulfilled' ? manga.value.items : []
  const b = manhwa.status === 'fulfilled' ? manhwa.value.items : []
  if (!a.length && !b.length) {
    if (manga.status === 'rejected') throw manga.reason
    if (manhwa.status === 'rejected') throw manhwa.reason
  }
  const out = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i])
    if (b[i]) out.push(b[i])
  }
  return out
}

export async function popular({ limit = 10 } = {}) {
  let items = []
  try {
    items = (await list(typeListPaths('manhwa', 1, 'popular'), 1, 5 * MIN)).items
  } catch {}
  if (!items.length) items = await latest({ page: 1 })
  return items.slice(0, limit)
}

export async function browse({ q = '', type = '', sort = '', genre = [], page = 1 } = {}) {
  const g = [].concat(genre).filter(Boolean)[0]
  if (g) {
    if (TYPES.includes(g)) return list(typeListPaths(g, page, sort), page)
    const slug = encodeURIComponent(genreSlug(g))
    return list([`${API}/genre/${slug}/${pageSeg(page)}`, `/genre/${slug}/${pageSeg(page)}`], page)
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

function infoRow($, label) {
  let out = ''
  const wanted = label.toLowerCase()
  $('.inftable tr').each((_, tr) => {
    const cells = $(tr).find('td')
    if (cells.length >= 2 && clean($(cells[0]).text()).toLowerCase().includes(wanted)) {
      out = clean($(cells[cells.length - 1]).text())
      return false
    }
  })
  return out
}

function readChapters($, slug) {
  const chapters = []
  const seen = new Set()

  const push = (href, text, timeAgo, strict) => {
    if (!href || !/chapter-/i.test(href)) return
    const full = pathOf(href).replace(/^manga\//i, '')
    if (seen.has(full) || (strict && !full.startsWith(slug + '-'))) return
    const number = (href.match(/chapter-(\d+(?:[.-]\d+)?)/i) || [])[1]?.replace('-', '.') || chapterNum(text)
    if (!number) return
    seen.add(full)
    chapters.push({ slug: shortChapter(slug, full), number, title: `Chapter ${number}`, timeAgo })
  }

  $('#Daftar_Chapter tr, .chapter tr, tbody tr').each((_, el) => {
    const $el = $(el)
    const a = $el.find('td.judulseries a, a').first()
    push(a.attr('href'), a.text(), clean($el.find('.tanggalseries, .tgl, .date').first().text()), false)
  })

  if (!chapters.length) {
    $('a[href*="chapter-"]').each((_, el) => push($(el).attr('href'), $(el).text(), '', true))
  }
  return sortChapters(chapters)
}

export async function detail(slug) {
  const html = await http.get(`/manga/${encodeURIComponent(slug)}/`, { ttl: MIN })
  const $ = cheerio.load(html)

  const title =
    [$('#Judul h1').text(), $('h1').first().text(), $('meta[property="og:title"]').attr('content')]
      .map(t => clean(String(t || '').replace(/^\s*Komik\s+/i, '')))
      .find(Boolean) || ''
  if (!title) throw notFound('Komik tidak ditemukan')

  const genreList = []
  $('.genre li, .genre a').each((_, el) => {
    const g = clean($(el).text())
    if (g && !genreList.includes(g)) genreList.push(g)
  })

  const chapters = readChapters($, slug)
  const alt = infoRow($, 'Judul Indonesia')

  return {
    title,
    slug,
    url: `${site()}/manga/${slug}/`,
    cover: img(pickImage($('.ims img').first()) || $('meta[property="og:image"]').attr('content') || ''),
    alt: alt && alt !== title ? [alt] : [],
    synopsis: clean($('.desc, .sin, #Sinopsis').first().text()) || clean($('meta[name="description"]').attr('content')),
    status: statusOf(infoRow($, 'Status')),
    type: infoRow($, 'Jenis').toLowerCase().replace(/^komik\s*/, ''),
    author: infoRow($, 'Pengarang'),
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

async function fetchChapter(slug, chapterSlug) {
  const n = String(chapterSlug).replace(/^chapter-/i, '')
  const isNum = /^\d+(?:[.-]\d+)?$/.test(n)
  const candidates = [`${slug}-${chapterSlug}`, chapterSlug, `manga/${slug}/${chapterSlug}`]
  if (isNum) {
    const d = n.replace('.', '-')
    candidates.push(`${slug}-chapter-${d}`, `${slug}-chapter-${d.padStart(2, '0')}`, `${slug}-chapter-${d.padStart(3, '0')}`)
  }

  let lastErr = null
  for (const full of new Set(candidates)) {
    try {
      const html = await http.get(`/${full.split('/').map(encodeURIComponent).join('/')}/`, { ttl: 5 * MIN })
      if (/Baca_Komik|chapter-body|article_content/.test(html)) return { full, html }
    } catch (e) {
      lastErr = e
      if (e.status !== 404) throw e
    }
  }

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
    const src = pickImage($(el))
    const url = src ? img(src) : ''
    if (url && !images.includes(url)) images.push(url)
  })

  const short = shortChapter(slug, full)
  const info = await detail(slug).catch(() => null)
  const chapters = info?.chapters ?? []
  const idx = chapters.findIndex(c => c.slug === short)
  const number = idx !== -1 ? chapters[idx].number : chapterNum(short)

  return {
    title: clean($('h1').first().text()) || `Chapter ${number}`,
    comic: slug,
    chapter: short,
    number,
    url: `${site()}/${full}/`,
    totalImages: images.length,
    images,
    prev: idx !== -1 && idx < chapters.length - 1 ? chapters[idx + 1].slug : null,
    next: idx > 0 ? chapters[idx - 1].slug : null
  }
}

export const resetCache = () => http.clear()

export default {
  id: 'komiku',
  name: 'Komiku',
  base: BASES[0],
  imageHeaders: { 'user-agent': UA, referer: BASES[0] + '/' },
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
