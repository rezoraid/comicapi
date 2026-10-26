import { timingSafeEqual } from 'node:crypto'

export function applyCors(res, requestOrigin, allowed) {
  res.setHeader('access-control-allow-methods', 'GET, HEAD, OPTIONS')
  res.setHeader('access-control-allow-headers', 'x-api-key, content-type, if-none-match')
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

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for']
    if (xff) return String(xff).split(',')[0].trim()
  }
  return req.socket.remoteAddress || 'unknown'
}

/** Fixed-window rate limiter per IP (in-memory). */
export function createRateLimiter({ max, windowMs }) {
  const hits = new Map()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
  }, windowMs)
  sweep.unref()

  return {
    check(key) {
      const now = Date.now()
      let h = hits.get(key)
      if (!h || h.reset <= now) {
        h = { count: 0, reset: now + windowMs }
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
