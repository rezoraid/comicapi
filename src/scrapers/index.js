/**
 * Registry semua scraper komik — satu pintu untuk server.
 *
 * Nambah scraper baru:
 *   1. Bikin src/scrapers/<nama>.js, export default object:
 *      { id, name, base, imageHeaders, imageHosts, filters?,
 *        search, latest, popular, browse, genres, detail, chapter }
 *   2. import di bawah lalu masukkan ke array PROVIDERS. Selesai —
 *      route, cache, dan image proxy otomatis ikut.
 */
import manta from './manta.js'
import shinigami from './shinigami.js'

const PROVIDERS = [manta, shinigami]
const METHODS = ['search', 'latest', 'popular', 'browse', 'genres', 'detail', 'chapter']

const providers = new Map()

export function register(p) {
  providers.set(p.id, p)
}
PROVIDERS.forEach(register)

export const has = id => providers.has(id)

export function get(id) {
  const p = providers.get(id)
  if (!p) throw new Error(`Scraper "${id}" tidak ditemukan`)
  return p
}

export function list() {
  return [...providers.values()].map(p => ({
    id: p.id,
    name: p.name,
    base: p.base,
    filters: p.filters || {},
    features: METHODS.filter(m => typeof p[m] === 'function')
  }))
}

/** Provider yang boleh membuka host gambar ini (untuk image proxy). */
export function findByImageHost(hostname) {
  const h = String(hostname).toLowerCase()
  for (const p of providers.values()) {
    if ((p.imageHosts || []).some(x => h === x || h.endsWith('.' + x))) return p
  }
  return null
}

function timeout(promise, ms) {
  let t
  const timer = new Promise((_, rej) => (t = setTimeout(() => rej(new Error('timeout')), ms)))
  return Promise.race([promise, timer]).finally(() => clearTimeout(t))
}

/** Cari ke semua sumber paralel; hasil di-interleave biar tiap sumber kebagian di atas. */
export async function searchAll(query, { limit = 10, timeoutMs = 8000 } = {}) {
  const all = [...providers.values()]
  const settled = await Promise.allSettled(all.map(p => timeout(p.search(query, { limit }), timeoutMs)))

  const lists = []
  const failed = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') lists.push(r.value.map(x => ({ ...x, source: all[i].id })))
    else failed.push(all[i].id)
  })

  const items = []
  for (let i = 0; ; i++) {
    let added = false
    for (const l of lists) {
      if (i < l.length) {
        items.push(l[i])
        added = true
      }
    }
    if (!added) break
  }
  return { items, failed }
}

export default { register, has, get, list, findByImageHost, searchAll }
