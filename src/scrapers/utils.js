export const UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim()
export const num = s => {
  const m = String(s ?? '').match(/\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

/**
 * HTTP client kecil: retry, cache (TTL), dan dedupe request yang sama.
 * Dipakai semua scraper biar konsisten & cepat.
 */
export function createHttp({ base, referer = base + '/', headers = {}, timeout = 15000, retries = 2 } = {}) {
  const cache = new Map()
  const inflight = new Map()
  const baseHeaders = {
    'user-agent': UA,
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    referer,
    ...headers
  }

  async function fetchRetry(url, json) {
    let lastError
    for (let i = 0; i <= retries; i++) {
      try {
        const res = await fetch(url, {
          headers: {
            ...baseHeaders,
            accept: json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,*/*'
          },
          signal: AbortSignal.timeout(timeout)
        })
        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`)
          err.status = res.status
          throw err
        }
        return json ? await res.json() : await res.text()
      } catch (e) {
        lastError = e
        if (e.status === 404) break // gak perlu retry
        if (i < retries) await sleep(400 * (i + 1))
      }
    }
    throw lastError
  }

  /** get(path, { json, ttl }) — ttl dalam ms, 0 = tanpa cache */
  function get(path, { json = false, ttl = 0 } = {}) {
    const url = path.startsWith('http') ? path : base + path
    const key = (json ? 'j:' : 't:') + url

    const hit = cache.get(key)
    if (hit && hit.exp > Date.now()) return Promise.resolve(hit.val)
    if (inflight.has(key)) return inflight.get(key)

    const p = fetchRetry(url, json)
      .then(val => {
        if (ttl) {
          cache.set(key, { val, exp: Date.now() + ttl })
          if (cache.size > 500) cache.delete(cache.keys().next().value)
        }
        return val
      })
      .finally(() => inflight.delete(key))

    inflight.set(key, p)
    return p
  }

  return { get, clear: () => cache.clear() }
}
