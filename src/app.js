import { Router } from './http/router.js'
import { encode, send, sendError, acceptsGzip } from './http/respond.js'
import { applyCors, isAuthorized, clientIp, createRateLimiter, readJson } from './http/middleware.js'
import { HttpError, badRequest, notFound, toHttpError } from './lib/errors.js'
import { withTimeout } from './lib/timeout.js'
import { TtlCache } from './lib/cache.js'
import { RedisRestCache } from './lib/redis-rest-cache.js'
import { registerRoutes } from './routes.js'
import { registerCommunityRoutes } from './community/routes.js'
import { createCatalog } from './catalog-sync.js'

function cacheKey(url) {
  const params = new URLSearchParams(url.searchParams)
  params.sort()
  return `${url.pathname}?${params.toString()}`
}

export function createApp({ registry, config, logger = console, community = null, sharedCache: injectedSharedCache = null, catalog: injectedCatalog }) {
  const cache = new TtlCache({
    max: config.cacheMax,
    maxBytes: (config.cacheMaxMb ?? 96) * 1024 * 1024,
    onError: (key, err) => {
      if (!(err?.status >= 400 && err.status < 500)) logger.error(`[cache] refresh gagal ${key} → ${err?.message || err}`)
    }
  })
  const sharedCache = injectedSharedCache || new RedisRestCache({
    url: config.redisRestUrl,
    token: config.redisRestToken,
    prefix: config.redisKeyPrefix,
    timeoutMs: config.redisTimeoutMs
  })
  const parsed = new WeakMap()
  const dataOf = value => {
    let d = parsed.get(value)
    if (d === undefined) {
      d = JSON.parse(value.body.toString('utf8')).data
      parsed.set(value, d)
    }
    return d
  }
  const catalog = injectedCatalog !== undefined
    ? injectedCatalog
    : createCatalog({ registry, collection: () => (typeof community === 'function' ? community() : community)?.c?.catalog ?? null, logger, crawl: false })
  const router = new Router()
  registerCommunityRoutes(router, { registry, community, catalog })
  registerRoutes(router, { registry, config, community, catalog })
  const limiters = {
    default: createRateLimiter(config.rateLimit),
    image: createRateLimiter(config.imageRateLimit)
  }
  function cachedEntry(url, route, ctx) {
    const key = cacheKey(url)
    return cache.remember(key, route.ttl * 1000, async () => {
      const shared = await sharedCache.get(key)
      if (shared) return shared
      const fresh = await encode({ ok: true, data: await withTimeout(Promise.resolve(route.handler(ctx)), config.requestTimeoutMs) })
      void sharedCache.set(key, fresh, route.ttl).catch(() => {})
      return fresh
    })
  }
  let warming = 0
  function warm(pathname) {
    if (warming >= 3 || !pathname.startsWith('/api/')) return
    const found = router.match(pathname, 'GET')
    if (!found?.route || !(found.route.ttl > 0)) return
    const url = new URL(pathname, 'http://localhost')
    warming++
    cachedEntry(url, found.route, { params: found.params, query: url.searchParams, warm: null })
      .catch(() => {})
      .finally(() => warming--)
  }
  async function warmPath(pathAndQuery) {
    const url = new URL(pathAndQuery, 'http://localhost')
    const found = router.match(url.pathname, 'GET')
    if (!found?.route || !(found.route.ttl > 0)) return null
    const { value } = await cachedEntry(url, found.route, { params: found.params, query: url.searchParams, warm: null })
    try {
      return dataOf(value)
    } catch {
      return null
    }
  }
  let warmRunning = false
  async function warmOnce() {
    if (warmRunning) return
    warmRunning = true
    try {
      const only = config.warmSources?.length ? new Set(config.warmSources) : null
      const sources = registry.list().filter(s => !only || only.has(s.id))
      await Promise.allSettled(sources.map(async s => {
        const id = encodeURIComponent(s.id)
        try {
          const [latest, popular] = await Promise.all([
            warmPath(`/api/${id}/latest?page=1`),
            s.features?.includes('popular') === false ? null : warmPath(`/api/${id}/popular`)
          ])
          const slugs = [...new Set([...(latest?.items || []), ...(popular?.items || [])].map(i => i?.slug).filter(x => typeof x === 'string' && x))].slice(0, config.warmDetails ?? 6)
          let chapters = 0
          for (const slug of slugs) {
            const detail = await warmPath(`/api/${id}/comic/${encodeURIComponent(slug)}`)
            const first = detail?.chapters?.[0]?.slug
            if (typeof first === 'string' && first && chapters < (config.warmChapters ?? 3)) {
              chapters++
              await warmPath(`/api/${id}/chapter/${encodeURIComponent(slug)}/${encodeURIComponent(first)}`)
            }
            await new Promise(r => setTimeout(r, 100))
          }
        } catch (err) {
          logger.error(`[warm] ${s.id} gagal → ${err?.message || err}`)
        }
      }))
    } finally {
      warmRunning = false
    }
  }
  let warmTimer = null
  let warmStart = null
  function startWarmer() {
    if (warmTimer || config.warmEnabled === false) return
    const tick = () => void warmOnce().catch(() => {})
    warmStart = setTimeout(tick, 1500)
    warmStart.unref?.()
    warmTimer = setInterval(tick, Math.max(5, config.warmIntervalSec ?? 30) * 1000)
    warmTimer.unref?.()
  }
  async function handler(req, res) {
    const started = Date.now()
    const path = req.url
    const logMode = config.logRequests === true ? 'all' : config.logRequests || 'off'
    if (logMode !== 'off' && path !== '/health') {
      res.on('finish', () => {
        const ms = Date.now() - started
        if (logMode === 'all' || res.statusCode >= 400 || ms >= (config.slowRequestMs ?? 1000)) logger.log(`${req.method} ${path} ${res.statusCode} ${ms}ms`)
      })
    }
    try {
      applyCors(res, req.headers.origin, config.corsOrigin)
      res.setHeader('x-content-type-options', 'nosniff')
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-max-age': '86400' })
        return res.end()
      }
      const url = new URL(req.url, 'http://localhost')
      const found = router.match(url.pathname, req.method)
      if (!found) throw notFound('Endpoint tidak ditemukan')
      if (found.bad) throw badRequest('Path tidak valid')
      if (found.allowed) {
        res.setHeader('allow', [...found.allowed, ...(found.allowed.includes('GET') ? ['HEAD'] : []), 'OPTIONS'].join(', '))
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method tidak didukung')
      }
      const { route, params } = found
      if (!route.public) {
        if (!isAuthorized(req, config.apiKey)) throw new HttpError(401, 'UNAUTHORIZED', 'API key salah atau tidak ada')
        const rl = await limiters[route.limiter || 'default'].check(clientIp(req, config.trustProxy))
        res.setHeader('x-ratelimit-remaining', rl.remaining)
        if (!rl.ok) {
          res.setHeader('retry-after', rl.retryAfter)
          throw new HttpError(429, 'RATE_LIMITED', 'Terlalu banyak request, coba lagi sebentar')
        }
      }
      const ctx = { req, res, params, query: url.searchParams, ip: clientIp(req, config.trustProxy), warm }
      if (route.body) ctx.body = await readJson(req, route.bodyLimit ?? (url.pathname.endsWith('/me/avatar') ? 512 * 1024 : 16_384))
      if (route.raw) return await route.handler(ctx)
      if (route.ttl > 0) {
        const { value, state } = await cachedEntry(url, route, ctx)
        if (route.overlay) {
          try {
            const base = dataOf(value)
            const data = await withTimeout(Promise.resolve(route.overlay(base, ctx)), config.requestTimeoutMs)
            if (data !== base) return send(req, res, await encode({ ok: true, data }, { gzip: acceptsGzip(req), level: 4 }), { revalidate: true, cacheState: state })
          } catch (err) {
            logger.error(`[overlay] ${url.pathname} → ${err?.message || err}`)
          }
        }
        return send(req, res, value, { cacheSeconds: route.ttl, cacheState: state })
      }
      return send(req, res, await encode({ ok: true, data: await withTimeout(Promise.resolve(route.handler(ctx)), config.requestTimeoutMs) }, { gzip: acceptsGzip(req), level: 4 }), { revalidate: req.method === 'GET' || req.method === 'HEAD' })
    } catch (err) {
      const e = toHttpError(err)
      if (e.status >= 500) logger.error(`[${e.code}] ${path} → ${err?.message || err}`)
      if (res.headersSent) return res.destroy()
      await sendError(req, res, e)
    }
  }
  return {
    handler,
    catalog,
    startWarmer,
    warmOnce,
    close() {
      if (warmTimer) clearInterval(warmTimer)
      if (warmStart) clearTimeout(warmStart)
      limiters.default.close()
      limiters.image.close()
    }
  }
}
