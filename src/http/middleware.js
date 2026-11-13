import { timingSafeEqual } from 'node:crypto'
import { HttpError, badRequest } from '../lib/errors.js'

export function applyCors(res, requestOrigin, allowed) {
  res.setHeader('access-control-allow-methods', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('access-control-allow-headers', 'x-api-key, content-type, if-none-match, authorization, x-device-id')
  res.setHeader('access-control-expose-headers', 'x-cache, etag, x-ratelimit-remaining')
  if (allowed === '*') {
    res.setHeader('access-control-allow-origin', '*')
    return
  }
  res.setHeader('vary', 'Origin')
  const list = allowed.split(',').map(s => s.trim()).filter(Boolean)
  if (requestOrigin && list.includes(requestOrigin)) res.setHeader('access-control-allow-origin', requestOrigin)
}

export function isAuthorized(req, apiKey) {
  if (!apiKey) return true
  const given = Buffer.from(String(req.headers['x-api-key'] || ''))
  const want = Buffer.from(apiKey)
  return given.length === want.length && timingSafeEqual(given, want)
}

export async function readJson(req, limit = 16_384) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Body terlalu besar')
    chunks.push(c)
  }
  if (!size) return {}
  let data
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw badRequest('Body harus JSON valid')
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw badRequest('Body harus berupa objek JSON')
  return data
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for']
    if (xff) return String(xff).split(',')[0].trim()
  }
  return req.socket.remoteAddress || 'unknown'
}

/** Fixed-window rate limiter per IP (in-memory). */
export function createRateLimiter({ max, windowMs, maxKeys = 100_000 }) {
  const hits = new Map()
  const prune = () => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
  }
  const sweep = setInterval(prune, windowMs)
  sweep.unref()

  return {
    check(key) {
      const now = Date.now()
      let h = hits.get(key)
      if (!h || h.reset <= now) {
        h = { count: 0, reset: now + windowMs }
        // batas memori: banjir IP/ID palsu tidak boleh membuat Map membengkak sampai OOM
        if (!hits.has(key) && hits.size >= maxKeys) {
          prune()
          if (hits.size >= maxKeys) hits.delete(hits.keys().next().value)
        }
        hits.set(key, h)
      }
      h.count++
      return {
        ok: h.count <= max,
        remaining: Math.max(0, max - h.count),
        retryAfter: Math.max(1, Math.ceil((h.reset - now) / 1000))
      }
    },
    close: () => clearInterval(sweep)
  }
}


/** Shared Redis rate limit with bounded in-process fallback when Redis is unavailable. */
export function createHybridRateLimiter({ max, windowMs, maxKeys = 100_000, sharedCache = null, namespace = 'api' }) {
  const local = createRateLimiter({ max, windowMs, maxKeys })
  return {
    async check(key) {
      if (sharedCache?.enabled) {
        const shared = await sharedCache.consumeRateLimit(key, { max, windowMs }, namespace)
        if (shared) return shared
      }
      return local.check(key)
    },
    close: () => local.close()
  }
}
