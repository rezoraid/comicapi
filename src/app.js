import { Router } from './http/router.js'
import { encode, send, sendError } from './http/respond.js'
import { applyCors, isAuthorized, clientIp, createRateLimiter } from './http/middleware.js'
import { HttpError, badRequest, notFound, toHttpError } from './lib/errors.js'
import { withTimeout } from './lib/timeout.js'
import { TtlCache } from './lib/cache.js'
import { registerRoutes } from './routes.js'

/** Key cache: path + query yang diurutkan (?a=1&b=2 sama dengan ?b=2&a=1). */
function cacheKey(url) {
  const qs = [...url.searchParams].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`)
  return `${url.pathname}?${qs.join('&')}`
}

export function createApp({ registry, config, logger = console }) {
  const cache = new TtlCache({ max: config.cacheMax })
  const router = new Router()
  registerRoutes(router, { registry, config })

  const limiters = {
    default: createRateLimiter(config.rateLimit),
    image: createRateLimiter(config.imageRateLimit)
  }

  async function handler(req, res) {
    const started = Date.now()
    const path = req.url
    if (config.logRequests && path !== '/health') {
      res.on('finish', () => logger.log(`${req.method} ${path} ${res.statusCode} ${Date.now() - started}ms`))
    }

    try {
      applyCors(res, req.headers.origin, config.corsOrigin)

      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-max-age': '86400' })
        return res.end()
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('allow', 'GET, HEAD, OPTIONS')
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method tidak didukung')
      }

      const url = new URL(req.url, 'http://localhost')
      const found = router.match(url.pathname)
      if (!found) throw notFound('Endpoint tidak ditemukan')
      if (found.bad) throw badRequest('Path tidak valid')
      const { route, params } = found

      if (!route.public) {
        if (!isAuthorized(req, config.apiKey)) throw new HttpError(401, 'UNAUTHORIZED', 'API key salah atau tidak ada')
        const rl = limiters[route.limiter || 'default'].check(clientIp(req, config.trustProxy))
        res.setHeader('x-ratelimit-remaining', rl.remaining)
        if (!rl.ok) {
          res.setHeader('retry-after', rl.retryAfter)
          throw new HttpError(429, 'RATE_LIMITED', 'Terlalu banyak request, coba lagi sebentar')
        }
      }

      const ctx = { req, res, params, query: url.searchParams }
      if (route.raw) return await route.handler(ctx)

      const run = async () =>
        encode({ ok: true, data: await withTimeout(Promise.resolve(route.handler(ctx)), config.requestTimeoutMs) })

      if (route.ttl > 0) {
        const { value, state } = await cache.remember(cacheKey(url), route.ttl * 1000, run)
        return send(req, res, value, { cacheSeconds: route.ttl, cacheState: state })
      }
      return send(req, res, await run())
    } catch (err) {
      const e = toHttpError(err)
      if (e.status >= 500) logger.error(`[${e.code}] ${path} → ${err?.message || err}`)
      if (res.headersSent) return res.destroy()
      await sendError(req, res, e)
    }
  }

  return {
    handler,
    cache,
    close() {
      limiters.default.close()
      limiters.image.close()
    }
  }
}
