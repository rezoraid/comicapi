import lumos from './lumos.js'
import manta from './manta.js'
import shinigami from './shinigami.js'
import { withTimeout } from '../lib/timeout.js'

const PROVIDERS = [lumos, manta, shinigami]
const METHODS = ['search', 'latest', 'popular', 'browse', 'genres', 'detail', 'chapter']

const providers = new Map()

function normalizeId(id) {
  return String(id ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_]+/g, '-')
}

export function register(p) {
  const id = normalizeId(p?.id)
  if (!id) throw new TypeError('Scraper wajib memiliki id')
  providers.set(id, { ...p, id })
}
PROVIDERS.forEach(register)

export const has = id => providers.has(normalizeId(id))

export function get(id) {
  const key = normalizeId(id)
  const p = providers.get(key)
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

export function findByImageHost(hostname) {
  const h = String(hostname).toLowerCase()
  for (const p of providers.values()) {
    if ((p.imageHosts || []).some(x => h === x || h.endsWith('.' + x))) return p
  }
  return null
}

export async function searchAll(query, { limit = 10, timeoutMs = 8000 } = {}) {
  const all = [...providers.values()]
  const settled = await Promise.allSettled(all.map(p => withTimeout(p.search(query, { limit }), timeoutMs)))
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
