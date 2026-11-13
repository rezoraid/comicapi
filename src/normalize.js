/**
 * Skema katalog tunggal Komikta. Setiap sumber (Lumos, MANGA Plus, Manta, Shinigami, ...) menulis
 * type/status/genre/rating dengan cara berbeda; semuanya diseragamkan di sini sebelum dikirim ke APK,
 * jadi klien tidak perlu tahu komik itu datang dari sumber mana.
 *
 *  type    : 'manga' | 'manhwa' | 'manhua' | 'webtoon' | 'novel' | ''
 *  status  : 'ongoing' | 'completed' | 'hiatus' | 'cancelled' | ''
 *  genres  : ['Action', 'Slice of Life', ...]  (rapi, tanpa duplikat)
 *  rating  : 0-10 satu desimal, atau null
 *  views   : angka, atau null
 *  author/artist/year/synopsis : teks bersih ('' kalau tidak ada)
 */

const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim()

// Nama jenis yang eksplisit didahulukan; baru petunjuk asal negara ("Korean" -> manhwa).
const TYPES = [
  ['manhwa', /manhwa/i],
  ['manhua', /manhua/i],
  ['webtoon', /webtoon/i],
  ['manga', /manga/i],
  ['novel', /novel/i],
  ['manhwa', /korea/i],
  ['manhua', /china|chinese/i],
  ['manga', /japan/i],
  // Manta menamai seluruh komik vertikalnya "comic": itu format webtoon (TYPES.slice(0, 5) di atas sengaja tidak mencakup ini)
  ['webtoon', /^comics?$/i]
]

export function canonType(raw, genres = []) {
  const direct = clean(raw)
  if (direct) for (const [id, re] of TYPES) if (re.test(direct)) return id
  // sebagian sumber hanya menaruh jenis di tag/genre
  for (const g of genres || []) for (const [id, re] of TYPES.slice(0, 5)) if (re.test(clean(g))) return id
  return ''
}

const STATUSES = [
  ['hiatus', /hiatus|paused|on\s*break/i],
  ['cancelled', /cancel|drop|discontinu/i],
  ['completed', /complete|tamat|finish|selesai|\bend(ed)?\b|one-?shot/i],
  ['ongoing', /on-?going|berjalan|serializ|publishing|releasing|updating|running|active/i]
]

export function canonStatus(raw) {
  const s = clean(raw)
  if (!s) return ''
  for (const [id, re] of STATUSES) if (re.test(s)) return id
  return ''
}

const SMALL_WORDS = new Set(['of', 'the', 'and', 'to', 'in', 'a', 'an'])

const titleCase = s =>
  s
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w.toLowerCase()) ? w.toLowerCase() : w))
    .join(' ')

export function normGenres(list) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(list) ? list : []) {
    let g = clean(typeof raw === 'object' && raw ? raw.name : raw)
    if (!g) continue
    if (g === g.toLowerCase() || g === g.toUpperCase()) g = titleCase(g) // "action" / "ACTION" -> "Action"
    const key = g.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(g)
    }
  }
  return out
}

const PLACEHOLDER = /^(-|—|n\/a|none|unknown|updating|tba|\?|null|undefined)$/i

export const person = v => {
  const s = clean(v)
  return PLACEHOLDER.test(s) ? '' : s
}

export function normRating(v) {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v
  if (!Number.isFinite(n) || n <= 0) return null
  const r = n > 10 ? (n <= 100 ? n / 10 : null) : n
  return r == null ? null : Math.round(r * 10) / 10
}

export function normViews(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  const t = clean(v)
  if (!t) return null
  let n
  const suffix = t.match(/^([\d.,]+)\s*([kmb])$/i)
  if (suffix) n = parseFloat(suffix[1].replace(',', '.')) * { k: 1e3, m: 1e6, b: 1e9 }[suffix[2].toLowerCase()]
  else if (/^\d{1,3}([.,]\d{3})+$/.test(t)) n = Number(t.replace(/[.,]/g, ''))
  else n = parseFloat(t.replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

const count = v => {
  const n = typeof v === 'string' ? parseInt(v, 10) : v
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null
}

const year = v => (/^(19|20)\d{2}$/.test(clean(v)) ? clean(v) : '')

/** Tanggal rilis absolut -> ISO 8601 (APK membacanya jadi "3 jam lalu"); '' kalau tidak valid. */
export function isoDate(v) {
  if (v == null || v === '') return ''
  const t = typeof v === 'number' ? (v < 1e11 ? v * 1000 : v) : /^\d{9,13}$/.test(String(v)) ? (String(v).length <= 10 ? Number(v) * 1000 : Number(v)) : Date.parse(String(v))
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : ''
}

export function normChapter(c = {}) {
  const releaseDate = c.releaseDate || null
  return {
    slug: clean(c.slug),
    number: clean(c.number),
    title: clean(c.title),
    // Sumber yang hanya mengirim tanggal rilis (Manta, Shinigami) tetap mengisi waktu update chapter.
    timeAgo: clean(c.timeAgo) || isoDate(releaseDate),
    releaseDate,
    isNew: !!c.isNew
  }
}

/** Item untuk daftar (search / latest / popular / browse). Properti khusus sumber tetap ikut, yang baku selalu ada. */
export function normalizeItem(it = {}, source = '') {
  const genres = normGenres(it.genres)
  const chapters = (Array.isArray(it.chapters) ? it.chapters : []).map(normChapter).filter(c => c.slug || c.number)
  return {
    ...it,
    title: clean(it.title) || clean(it.slug),
    slug: clean(it.slug),
    url: it.url || '',
    cover: it.cover || '',
    type: canonType(it.type, genres),
    status: canonStatus(it.status),
    rating: normRating(it.rating),
    chapterCount: count(it.chapterCount) ?? (chapters.length > 1 ? chapters.length : null),
    genres,
    author: person(it.author),
    artist: person(it.artist),
    year: year(it.year),
    views: normViews(it.views),
    chapters,
    source: it.source || source
  }
}

/** Detail komik: semua kolom baku selalu ada, kosong = '' / [] / null. */
export function normalizeDetail(d = {}, source = '') {
  const genres = normGenres(d.genres)
  const chapters = (Array.isArray(d.chapters) ? d.chapters : []).map(normChapter)
  return {
    ...d,
    title: clean(d.title),
    slug: clean(d.slug),
    url: d.url || '',
    cover: d.cover || '',
    banner: d.banner || '',
    alt: [...new Set((Array.isArray(d.alt) ? d.alt : []).map(clean).filter(x => x && x !== clean(d.title)))],
    synopsis: clean(d.synopsis),
    status: canonStatus(d.status),
    type: canonType(d.type, genres),
    author: person(d.author),
    artist: person(d.artist),
    year: year(d.year),
    views: normViews(d.views),
    rating: normRating(d.rating),
    ratingCount: count(d.ratingCount),
    genres,
    totalChapters: count(d.totalChapters) ?? chapters.length,
    chapters,
    source: d.source || source
  }
}

export const normalizeList = (list, source = '') => (Array.isArray(list) ? list.map(i => normalizeItem(i, i?.source || source)) : list)

/** browse mengembalikan { items, page, pages, total }; sumber lain bisa array biasa. */
export function normalizeBrowse(result, source = '') {
  if (Array.isArray(result)) return normalizeList(result, source)
  if (result && Array.isArray(result.items)) return { ...result, items: normalizeList(result.items, source) }
  return result
}
