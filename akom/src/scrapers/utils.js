import net from 'node:net'

export const UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim()
export const num = s => {
  const m = String(s ?? '').match(/\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

export function trackHost(hosts, url) {
  try {
    const u = new URL(url)
    const h = u.hostname.toLowerCase()
    if (u.protocol === 'https:' && h.includes('.') && !net.isIP(h) && !hosts.includes(h)) hosts.push(h)
  } catch {}
  return url
}

export const PUBLIC_RELAYS = [
  'https://api.allorigins.win/raw?url={url}',
  'https://api.codetabs.com/v1/proxy/?quest={url}'
]

export function relaysFromEnv(...names) {
  const raw = names.map(n => process.env[n]).find(Boolean)
  if (raw) return raw.split('|').map(x => x.trim()).filter(Boolean)
  return process.env.RELAY_PUBLIC === 'false' ? [] : PUBLIC_RELAYS
}

export function createHttp({
  base,
  referer = base + '/',
  headers = {},
  timeout = 15000,
  retries = 2,
  fatal = [404],
  relay = [],
  relayTimeout = 8000
} = {}) {
  const cache = new Map()
  const inflight = new Map()
  const relays = [].concat(relay).filter(Boolean)
  const baseHeaders = {
    'user-agent': UA,
    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    referer,
    ...headers
  }
  let relayUntil = 0
  let relayIdx = 0

  const relayUrl = (template, url) =>
    template.includes('{url}') ? template.replace('{url}', encodeURIComponent(url)) : template + encodeURIComponent(url)

  async function request(url, json, ms = timeout) {
    const res = await fetch(url, {
      headers: {
        accept: json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml,*/*',
        ...baseHeaders
      },
      signal: AbortSignal.timeout(ms)
    })
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`)
      err.status = res.status
      throw err
    }
    return json ? await res.json() : await res.text()
  }

  async function withRetry(url, json) {
    let lastError
    for (let i = 0; i <= retries; i++) {
      try {
        return await request(url, json)
      } catch (e) {
        lastError = e
        if (fatal.includes(e.status)) break
        if (i < retries) await sleep(400 * (i + 1))
      }
    }
    throw lastError
  }

  async function viaRelay(url, json) {
    let lastError
    for (let n = 0; n < relays.length; n++) {
      const i = (relayIdx + n) % relays.length
      try {
        const out = await request(relayUrl(relays[i], url), json, relayTimeout)
        relayIdx = i
        relayUntil = Date.now() + 10 * 60 * 1000
        return out
      } catch (e) {
        if (e.status === 404) throw e
        lastError = e
      }
    }
    throw lastError
  }

  async function fetchRetry(url, json) {
    if (!relays.length) return withRetry(url, json)
    if (Date.now() < relayUntil) {
      try {
        return await viaRelay(url, json)
      } catch (e) {
        if (e.status === 404) throw e
        relayUntil = 0
      }
    }
    try {
      return await withRetry(url, json)
    } catch (e) {
      if (![403, 429, 503].includes(e.status)) throw e
      try {
        return await viaRelay(url, json)
      } catch (r) {
        throw r.status === 404 ? r : e
      }
    }
  }

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

export function createMirrorHttp({ bases, ...options }) {
  const clients = bases.map(base => ({ base, http: createHttp({ ...options, base, referer: base + '/' }) }))
  let active = 0

  async function get(path, opts) {
    if (/^https?:\/\//i.test(path)) return clients[active].http.get(path, opts)
    let notFound = null
    let lastError = null
    for (let n = 0; n < clients.length; n++) {
      const i = (active + n) % clients.length
      try {
        const out = await clients[i].http.get(path, opts)
        active = i
        return out
      } catch (e) {
        if (e.status === 404) notFound ??= e
        else lastError = e
      }
    }
    throw notFound || lastError
  }

  return {
    get,
    base: () => clients[active].base,
    bases: () => clients.map(c => c.base),
    clear: () => clients.forEach(c => c.http.clear())
  }
}
