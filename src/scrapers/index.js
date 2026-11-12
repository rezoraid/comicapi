import { readdirSync } from 'node:fs'
import { withTimeout } from '../lib/timeout.js'

const NON_SCRAPERS = new Set(['index.js', 'utils.js'])
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
const broken = []

const dir = new URL('./', import.meta.url)
for (const file of readdirSync(dir).filter(f => f.endsWith('.js') && !f.startsWith('_') && !NON_SCRAPERS.has(f)).sort()) {
  try {
    register((await import(new URL(file, dir))).default)
  } catch (err) {
    const at = String(err?.stack || '').match(/scrapers\/([\w.-]+\.js):(\d+)/)
    broken.push({ file, error: String(err?.message || err).split('\n')[0].slice(0, 300), where: at ? `${at[1]}:${at[2]}` : '' })
    console.error(`[scrapers] ${file} gagal dimuat → ${err?.message || err}`)
  }
}

export const failed = () => [...broken]

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

export const searchAll = (query, opts) => searchProviders([...providers.values()], query, opts)

export async function searchProviders(all, query, { limit = 10, timeoutMs = 8000, graceMs = 2500 } = {}) {
  const results = new Array(all.length)
  await new Promise(resolve => {
    let pending = all.length
    let timer = null
    const finish = () => {
      clearTimeout(timer)
      resolve()
    }
    if (!pending) return finish()
    all.forEach((p, i) => {
      withTimeout((async () => p.search(query, { limit }))(), timeoutMs)
        .then(
          v => {
            results[i] = v
            if (!timer) timer = setTimeout(finish, graceMs)
          },
          () => {}
        )
        .finally(() => {
          if (--pending === 0) finish()
        })
    })
  })
  const lists = []
  const failed = []
  all.forEach((p, i) => {
    if (results[i]) lists.push(results[i].map(x => ({ ...x, source: p.id })))
    else failed.push(p.id)
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

export default { register, has, get, list, failed, findByImageHost, searchAll }
