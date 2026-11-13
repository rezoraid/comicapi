/**
 * Metadata luar untuk melengkapi komik yang tidak punya rating / author / artist / tahun / status / sinopsis di sumbernya
 * (mis. Manta). Memakai AniList (GraphQL publik, tanpa API key) dan HANYA menerima kecocokan yang yakin:
 * judul komik kita harus sama persis (setelah dinormalisasi) dengan judul/sinonim di AniList, dan asal negaranya
 * tidak boleh bertentangan dengan jenis yang sudah diketahui. Hasilnya hanya mengisi kolom yang kosong.
 *
 * Dimatikan dengan env META_ENRICH=false. Yang dikirim ke AniList hanya judul komik.
 */
import { normTitle } from './completeness.js'
import { normGenres, normRating, canonStatus } from './normalize.js'

const ENDPOINT = 'https://graphql.anilist.co'
const ORIGIN_TYPE = { JP: 'manga', KR: 'manhwa', CN: 'manhua', TW: 'manhua', HK: 'manhua' }
const FAMILY = { manga: 'jp', manhwa: 'kr', webtoon: 'kr', manhua: 'cn' }
const STATUS = { RELEASING: 'ongoing', FINISHED: 'completed', HIATUS: 'hiatus', CANCELLED: 'cancelled', NOT_YET_RELEASED: 'ongoing' }

const QUERY = `query($s:String){Page(perPage:8){media(search:$s,type:MANGA,sort:SEARCH_MATCH){
  id format status countryOfOrigin averageScore meanScore popularity startDate{year} genres description(asHtml:false)
  title{romaji english native} synonyms staff(perPage:8,sort:RELEVANCE){edges{role node{name{full}}}}
}}}`

const strip = html =>
  String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\(Source:[^)]*\)/gi, '')
    .replace(/\[Written by[^\]]*\]/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1200)

const uniq = list => [...new Set(list.filter(Boolean))]

/** Ubah satu `media` AniList menjadi kolom katalog. Kolom yang tidak ada = tidak disebut. */
export function toFields(m) {
  const authors = []
  const artists = []
  for (const e of m.staff?.edges || []) {
    const name = e?.node?.name?.full
    const role = String(e?.role || '')
    if (!name) continue
    if (/story|original|author/i.test(role)) authors.push(name)
    if (/art|illustrat/i.test(role)) artists.push(name)
  }
  const out = {}
  const rating = normRating((m.averageScore || m.meanScore || 0) / 10)
  if (rating) out.rating = rating
  if (m.startDate?.year) out.year = String(m.startDate.year)
  const status = canonStatus(STATUS[m.status] || '')
  if (status) out.status = status
  const type = ORIGIN_TYPE[m.countryOfOrigin]
  if (type) out.type = type
  const genres = normGenres(m.genres)
  if (genres.length) out.genres = genres
  if (authors.length) out.author = uniq(authors).join(', ')
  if (artists.length) out.artist = uniq(artists).join(', ')
  const synopsis = strip(m.description)
  if (synopsis) out.synopsis = synopsis
  return out
}

/** Pilih kecocokan yang yakin; null kalau tidak ada. */
export function pickMatch(media, { title, alt = [], type = '' }) {
  const keys = new Set([title, ...alt].map(normTitle).filter(k => k.length >= 3))
  if (!keys.size) return null
  const novel = type === 'novel'
  const exact = (Array.isArray(media) ? media : []).filter(m => {
    if (!m || (m.format === 'NOVEL') !== novel) return false
    const names = [m.title?.romaji, m.title?.english, m.title?.native, ...(m.synonyms || [])].map(normTitle)
    if (!names.some(n => keys.has(n))) return false
    const origin = ORIGIN_TYPE[m.countryOfOrigin]
    return !origin || !FAMILY[type] || FAMILY[origin] === FAMILY[type]
  })
  exact.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
  return exact[0] || null
}

/**
 * lookup() -> { ok: true, data: {...kolom} | null }  (null = tidak ada kecocokan yang yakin; aman di-cache lama)
 *          -> { ok: false }                          (gagal sementara: jangan di-cache)
 * Permintaan diantre satu per satu dengan jeda (batas AniList 90/menit) dan berhenti sejenak kalau kena 429.
 */
export function createExternalMeta({ enabled = true, fetchImpl = globalThis.fetch, gapMs = 750, timeoutMs = 7000, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), logger = console } = {}) {
  let chain = Promise.resolve()
  let pausedUntil = 0
  const stats = { requests: 0, matched: 0, none: 0, failed: 0 }

  async function request(search) {
    if (now() < pausedUntil) return { ok: false }
    stats.requests++
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { s: search } }),
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (res.status === 429) {
        const wait = Number(res.headers?.get?.('retry-after')) || 60
        pausedUntil = now() + wait * 1000
        stats.failed++
        return { ok: false }
      }
      if (!res.ok) {
        stats.failed++
        return { ok: false }
      }
      const json = await res.json()
      return { ok: true, media: json?.data?.Page?.media || [] }
    } catch (err) {
      stats.failed++
      logger.error?.(`[meta] AniList gagal → ${err?.message || err}`)
      return { ok: false }
    }
  }

  function lookup(query) {
    if (!enabled || !query?.title) return Promise.resolve({ ok: false })
    const run = chain.then(async () => {
      const r = await request(query.title)
      await sleep(gapMs)
      if (!r.ok) return r
      const hit = pickMatch(r.media, query)
      if (hit) stats.matched++
      else stats.none++
      return { ok: true, data: hit ? toFields(hit) : null, id: hit?.id ?? null }
    })
    chain = run.catch(() => {})
    return run
  }

  return { enabled, lookup, stats: () => ({ ...stats, pausedUntil }) }
}
