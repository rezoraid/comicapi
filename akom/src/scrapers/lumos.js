import * as cheerio from 'cheerio'
import { createMirrorHttp, relaysFromEnv, clean, num, UA } from './utils.js'

const BASES = ['https://03.lumosgg.com', 'https://02.lumosgg.com', 'https://lumoskomik.com']
const IMG_DEFAULT = { proxyEnabled: false, base: 'https://lms.imgsvr.my.id/file' }

const MIN = 60 * 1000
const http = createMirrorHttp({ bases: BASES, timeout: 10000, retries: 2, relay: relaysFromEnv('LUMOS_RELAY', 'RELAY_URL') })
const site = () => http.base()

let imgCfg = null
let genreCache = null

const TYPES = ['manga', 'manhwa', 'manhua']
const STATUSES = ['ongoing', 'completed', 'hiatus']
const SORTS = ['latest', 'popular', 'rating', 'az']
const imageHosts = [...BASES.map(b => new URL(b).hostname), 'lms.imgsvr.my.id']

const slugOf = href => (String(href || '').match(/\/comic\/([^/?#]+)/) || [])[1] || ''
const slugNumber = slug => String(slug).replace(/^chapter-/i, '').replace(/-/g, '.')
const imgSrc = $el => $el.attr('data-src') || $el.attr('data-lazy-src') || $el.attr('data-original') || $el.attr('src') || ''

function readImgCfg(html) {
  const m = html.match(/__IMG_CFG__\s*=\s*(\{[^}]*\})/)
  if (!m) return
  try {
    imgCfg = JSON.parse(m[1])
  } catch {
    const base = m[1].match(/base\s*:\s*["']([^"']+)["']/)
    const proxy = m[1].match(/proxyEnabled\s*:\s*(!0|!1|true|false)/)
    imgCfg = {
      base: base ? base[1] : null,
      proxyEnabled: proxy ? ['!0', 'true'].includes(proxy[1]) : true
    }
  }
  try {
    const h = new URL(imgCfg.base).hostname
    if (h && !imageHosts.includes(h)) imageHosts.push(h)
  } catch {}
}

function resolveImage(src) {
  if (!src) return ''
  src = String(src).trim()
  if (/^https?:\/\//.test(src)) return src
  const abs = site() + (src.startsWith('/') ? src : '/' + src)
  if (/^\/api\/image\/(thumbnail|p\/)/.test(src)) return abs
  const c = imgCfg || IMG_DEFAULT
  if (c.proxyEnabled === false && c.base && !src.includes('?stitch=')) {
    let n = src
    if (n.startsWith('/api/image/')) n = n.slice(11)
    else if (n.startsWith('/uploads/')) n = n.slice(9)
    else return abs
    if (n.includes('?')) n = n.slice(0, n.indexOf('?'))
    if (n) return `${c.base.replace(/\/+$/, '')}/${n}`
  }
  return abs
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

function pickList(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  for (const k of ['results', 'data', 'comics', 'items']) {
    const v = data[k]
    if (Array.isArray(v)) return v
    if (v && typeof v === 'object') {
      const inner = pickList(v)
      if (inner.length) return inner
    }
  }
  return []
}

const item = (o = {}) => ({
  title: '',
  slug: '',
  url: `${site()}/comic/${o.slug}`,
  cover: '',
  type: '',
  status: '',
  rating: null,
  chapterCount: null,
  chapters: [],
  ...o
})

function fromApi(i) {
  const slug = i.slug || i.id || ''
  return item({
    title: i.title || i.name || slug,
    slug,
    cover: resolveImage(i.coverImage || i.cover || i.image || ''),
    type: i.type || '',
    status: i.status || '',
    rating: i.rating ?? i.avgRating ?? null
  })
}

export async function search(query, { limit = 10 } = {}) {
  let items = []
  try {
    const data = await http.get(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`, { json: true, ttl: MIN })
    items = pickList(data).map(fromApi).filter(x => x.slug)
  } catch {}
  if (items.length) return items
  return (await browse({ q: query })).items.slice(0, limit)
}

export async function latest({ page = 1 } = {}) {
  let data = null
  try {
    data = await http.get(`/api/home-latest?page=${page}`, { json: true, ttl: MIN })
  } catch {}
  if (!(data?.data?.items || []).length) {
    return (await allSeries({ sort: 'latest', page })).items
  }
  return data.data.items.map(i =>
    item({
      title: i.title,
      slug: i.slug,
      cover: resolveImage(i.coverImage),
      chapters: (i.recentChapters || []).map(c => ({
        slug: c.slug,
        number: String(c.number),
        isNew: !!c.isNew,
        timeAgo: c.timeAgo || ''
      }))
    })
  )
}

export async function allSeries({ sort = 'popular', page = 1, type = '', status = '', genre = [] } = {}) {
  const qs = new URLSearchParams()
  if (sort) qs.set('sort', sort)
  if (type) qs.set('type', type)
  if (status) qs.set('status', status)
  const g = [].concat(genre).filter(Boolean)
  if (g.length) qs.set('genre', g.join(','))
  qs.set('page', String(page))

  const html = await http.get(`/all-series?${qs}`, { ttl: MIN })
  readImgCfg(html)
  const $ = cheerio.load(html)
  const root = $('#main-content').length ? $('#main-content') : $('body')

  const CARD = '.htg-card, article, li, [class*="card"], [class*="item"]'
  const map = new Map()
  root.find('a[href*="/comic/"]').each((_, a) => {
    const $a = $(a)
    const slug = slugOf($a.attr('href'))
    if (!slug) return
    if ($a.closest('header, nav, footer').length) return
    const $card = $a.closest(CARD).length ? $a.closest(CARD).first() : $a
    const cur = map.get(slug) || { slug, title: '', cover: '', rating: null, type: '', status: '', chapterCount: null }

    if (!cur.title) {
      cur.title =
        clean($card.find('h1,h2,h3,h4').first().text()) ||
        clean($card.find('[class*="title"]').first().text()) ||
        clean($a.attr('title')) ||
        clean($card.find('img').first().attr('alt'))
    }
    if (!cur.cover) cur.cover = resolveImage(imgSrc($card.find('img').first()))
    if (cur.rating == null) cur.rating = num($card.find('[class*="score"], [class*="rating"], [class*="star"]').first().text())
    if (!cur.type) cur.type = (clean($card.text()).match(/\b(manga|manhwa|manhua|novel)\b/i) || [])[1]?.toLowerCase() || ''
    if (!cur.status) cur.status = (clean($card.text()).match(/\b(ongoing|completed|hiatus)\b/i) || [])[1]?.toLowerCase() || ''
    if (cur.chapterCount == null) cur.chapterCount = num(clean($card.find('span.font-medium').first().text())) || null
    map.set(slug, cur)
  })

  const items = [...map.values()].filter(x => x.title || x.cover).map(x => item({ ...x, title: x.title || x.slug }))

  let pages = 1
  $('a[href*="page="]').each((_, a) => {
    const m = String($(a).attr('href')).match(/[?&]page=(\d+)/)
    if (m) pages = Math.max(pages, parseInt(m[1]))
  })
  return { items, page, pages: Math.max(pages, page), total: items.length }
}

export async function popular({ period = '', limit = 10 } = {}) {
  if (['weekly', 'monthly', 'alltime'].includes(period)) {
    const html = await http.get('/', { ttl: 5 * MIN })
    readImgCfg(html)
    const $ = cheerio.load(html)
    const out = []
    $(`#ht-pop-${period} .ht-wpop-item`).each((_, el) => {
      const $el = $(el)
      const slug = slugOf($el.find('a').first().attr('href'))
      if (!slug) return
      out.push(
        item({
          title: clean($el.find('.ht-wpop-title').text()),
          slug,
          cover: resolveImage(imgSrc($el.find('img').first())),
          rating: num($el.find('.ht-wpop-score').text())
        })
      )
    })
    return out.slice(0, limit)
  }
  try {
    const { items } = await allSeries({ sort: 'popular', page: 1 })
    if (items.length) return items.slice(0, limit)
  } catch {}
  const data = await http.get(`/api/popular?tab=komik&period=all&perPage=${limit}`, { json: true, ttl: 5 * MIN })
  return pickList(data).map(fromApi).filter(x => x.slug).slice(0, limit)
}

export async function browse({ q = '', sort = '', status = '', type = '', genre = [], minChapters = '', page = 1 } = {}) {
  const qs = new URLSearchParams()
  if (q) qs.set('q', q)
  if (sort) qs.set('sort', sort)
  if (status) qs.set('status', status)
  if (type) qs.set('type', type)
  const g = [].concat(genre).filter(Boolean)
  if (g.length) qs.set('genre', g.join(','))
  if (minChapters) qs.set('minChapters', String(minChapters))
  if (page > 1) qs.set('page', String(page))

  const html = await http.get(`/browse${qs.toString() ? '?' + qs : ''}`, { ttl: MIN })
  readImgCfg(html)
  const $ = cheerio.load(html)

  const items = []
  $('#main-content .htg-card').each((_, el) => {
    const $el = $(el)
    const slug = slugOf($el.find('a[href^="/comic/"]').first().attr('href'))
    if (!slug || items.some(i => i.slug === slug)) return
    items.push(
      item({
        title: clean($el.find('h3').first().text()) || clean($el.find('img').first().attr('alt')),
        slug,
        cover: resolveImage(imgSrc($el.find('img').first())),
        chapterCount: num($el.find('span.font-medium').first().text()),
        status: clean($el.find('span.capitalize').first().text())
      })
    )
  })

  let pages = 1
  $('a[href*="page="]').each((_, a) => {
    const m = String($(a).attr('href')).match(/[?&]page=(\d+)/)
    if (m) pages = Math.max(pages, parseInt(m[1]))
  })
  const total = parseInt(clean($('#main-content h1').first().next('span').text())) || items.length

  const genres = []
  $('[data-bf-genre-name]').each((_, el) => {
    const n = $(el).attr('data-bf-genre-name')
    if (n && !genres.includes(n)) genres.push(n)
  })
  if (genres.length) genreCache = genres

  return { items, page, pages: Math.max(pages, page), total }
}

export async function genres() {
  if (!genreCache) await browse({})
  return genreCache || []
}

async function chapterListApi(slug) {
  const data = await http.get(`/api/chapters/list?comic=${encodeURIComponent(slug)}`, { json: true, ttl: MIN })
  const list = Array.isArray(data?.chapters) ? data.chapters : []
  return sortChapters(
    list
      .map(c => {
        const cs = c.slug || (c.number != null ? `chapter-${String(c.number).replace(/\./g, '-')}` : '')
        return { slug: cs, number: c.number != null ? String(c.number) : slugNumber(cs), title: c.title || '', timeAgo: c.timeAgo || '' }
      })
      .filter(c => c.slug)
  )
}

function readLd($) {
  let ld = null
  $('script[type="application/ld+json"]').each((_, s) => {
    try {
      const j = JSON.parse($(s).contents().text())
      for (const x of [].concat(j)) if (x && x['@type'] === 'ComicSeries') ld = x
    } catch {}
  })
  return ld
}

function decodeSynopsis(raw) {
  if (!raw) return ''
  try {
    return Buffer.from(raw, 'base64').toString('utf8').trim()
  } catch {
    return ''
  }
}

export async function detail(slug) {
  const html = await http.get(`/comic/${encodeURIComponent(slug)}`, { ttl: MIN })
  readImgCfg(html)
  const $ = cheerio.load(html)
  const ld = readLd($)
  const main = $('#main-content').length ? $('#main-content') : $('body')

  const stat = label => {
    let out = ''
    main.find('*').each((_, el) => {
      if (out) return false
      const kids = $(el).children()
      if (kids.length === 2 && clean($(kids[0]).text()).toLowerCase() === label.toLowerCase() && !$(kids[0]).children().length) {
        out = clean($(kids[1]).text())
      }
    })
    return out
  }
  const bodyText = clean(main.text())
  const pick = re => (bodyText.match(re) || [])[1] || ''
  const dash = v => (v === '-' ? '' : v)

  const genreList = []
  main.find('a[href*="genre="]').each((_, a) => {
    const g = clean($(a).text())
    if (g && !genreList.includes(g)) genreList.push(g)
  })
  if (!genreList.length && Array.isArray(ld?.genre)) genreList.push(...ld.genre)

  const chapters = []
  $('#tab-chapters a[href*="/read/"]').each((_, a) => {
    const m = String($(a).attr('href')).match(/\/read\/([^/?#]+)\/([^/?#]+)/)
    if (!m || m[1] !== slug || chapters.some(c => c.slug === m[2])) return
    const spans = $(a).find('span')
    chapters.push({
      slug: m[2],
      number: (clean($(a).text()).match(/Chapter\s+(\d+(?:\.\d+)?)/i) || [])[1] || slugNumber(m[2]),
      title: clean(spans.first().text()),
      timeAgo: clean($(spans[spans.length - 1]).text())
    })
  })
  sortChapters(chapters)
  if (!chapters.length) chapters.push(...(await chapterListApi(slug).catch(() => [])))

  const related = []
  main.find('a[href^="/comic/"]').each((_, a) => {
    const s = slugOf($(a).attr('href'))
    const t = clean($(a).find('h3').first().text())
    if (!s || !t || s === slug || related.some(r => r.slug === s)) return
    related.push(item({ title: t, slug: s, cover: resolveImage(imgSrc($(a).find('img').first())) }))
  })

  const artist = clean(ld?.illustrator?.name) || stat('Artist')
  return {
    title: clean($('h1').first().text()) || clean(ld?.name) || slug,
    slug,
    url: `${site()}/comic/${slug}`,
    cover: resolveImage(ld?.image || $('meta[property="og:image"]').attr('content') || ''),
    alt: Array.isArray(ld?.alternateName) ? ld.alternateName : [],
    synopsis:
      decodeSynopsis($('[data-sr]').first().attr('data-sr')) ||
      clean(ld?.description) ||
      clean($('meta[property="og:description"]').attr('content')),
    status: stat('Status') || pick(/Status\s+(ongoing|completed|hiatus)/i),
    type: stat('Type') || pick(/Type\s+(manhwa|manga|manhua)/i),
    author: dash(clean(ld?.author?.name) || stat('Author') || pick(/Author\s+(.+?)\s+(?:Artist|Year)/)),
    artist: dash(artist),
    year: clean(ld?.datePublished) || stat('Year'),
    views: num(stat('Views')),
    rating: num($('#stats-rating-value').text()),
    ratingCount: ld?.aggregateRating?.ratingCount ?? null,
    genres: genreList,
    totalChapters: chapters.length || ld?.numberOfEpisodes || 0,
    chapters,
    related
  }
}

export async function chapter(slug, chapterSlug) {
  const html = await http.get(`/read/${encodeURIComponent(slug)}/${encodeURIComponent(chapterSlug)}`, { ttl: 5 * MIN })
  readImgCfg(html)
  const $ = cheerio.load(html)

  const images = []
  const add = u => {
    if (u && !images.includes(u)) images.push(u)
  }
  $('img').each((_, el) => {
    const raw = imgSrc($(el))
    if (!raw || /^\/api\/image\/(thumbnail|p\/|reactions)/.test(raw)) return
    const u = resolveImage(raw)
    if (/\/file\/comic\//.test(u) || $(el).closest('#reader-pages').length) add(u)
  })
  if (!images.length) {
    const re = /https?:\/\/[^"'\s\\)]+\/file\/comic\/[^"'\s\\)]+\.(?:webp|jpe?g|png|avif)/gi
    for (const mm of html.matchAll(re)) add(mm[0])
  }

  let prev = null
  let next = null
  $('a[href*="/read/"]').each((_, a) => {
    const m = String($(a).attr('href')).match(/\/read\/([^/?#]+)\/([^/?#]+)/)
    if (!m || m[1] !== slug) return
    const t = clean($(a).text())
    if (/^(Previous\s+)?Prev/i.test(t)) prev = m[2]
    else if (/^Next/i.test(t)) next = m[2]
  })

  return {
    title: clean($('title').text().replace(/\s*[—|-]\s*LumosKomik\s*$/i, '')) || chapterSlug,
    comic: slug,
    chapter: chapterSlug,
    url: `${site()}/read/${slug}/${chapterSlug}`,
    images,
    prev,
    next
  }
}

export const resetCache = () => http.clear()

export default {
  id: 'lumos',
  name: 'LumosKomik',
  base: BASES[0],
  get imageHeaders() {
    return { 'user-agent': UA, referer: site() + '/' }
  },
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
