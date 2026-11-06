import { Router } from './http/router.js'
import { encode, send, sendError, acceptsGzip } from './http/respond.js'
import { applyCors, isAuthorized, clientIp, createRateLimiter, readJson } from './http/middleware.js'
import { HttpError, badRequest, notFound, toHttpError } from './lib/errors.js'
import { withTimeout } from './lib/timeout.js'
import { TtlCache } from './lib/cache.js'
import { RedisRestCache } from './lib/redis-rest-cache.js'
import { registerRoutes } from './routes.js'
import { registerCommunityRoutes } from './community/routes.js'

/** Key cache: path + query yang diurutkan (?a=1&b=2 sama dengan ?b=2&a=1). */
function cacheKey(url) {
  // URLSearchParams.sort() is stable and re-encodes values, avoiding collisions
  // when a query value itself contains '&' or '=' characters.
  const params = new URLSearchParams(url.searchParams)
  params.sort()
  return `${url.pathname}?${params.toString()}`
}

export function createApp({ registry, config, logger = console, community = null, sharedCache: injectedSharedCache = null }) {
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
  const router = new Router()
  registerCommunityRoutes(router, { registry, community })
  registerRoutes(router, { registry, config, community })

  const limiters = {
    default: createRateLimiter(config.rateLimit),
    image: createRateLimiter(config.imageRateLimit)
  }

  // di-cache: dikompres sekali (level tinggi) lalu dipakai ulang oleh semua request berikutnya
  function cachedEntry(url, route, ctx) {
    const key = cacheKey(url)
    return cache.remember(key, route.ttl * 1000, async () => {
      // Redis is L2: only consulted after local memory misses. Redis outage never blocks correctness.
      const shared = await sharedCache.get(key)
      if (shared) return shared
      const fresh = await encode({ ok: true, data: await withTimeout(Promise.resolve(route.handler(ctx)), config.requestTimeoutMs) })
      // Do not add Redis write latency to the first response.
      void sharedCache.set(key, fresh, route.ttl).catch(() => {})
      return fresh
    })
  }

  // Preload di server: chapter berikutnya dimuat diam-diam begitu chapter ini diambil dari sumber,
  // sehingga ketika pembaca menekan "Next" datanya sudah ada di cache. Maks 3 sekaligus, error diabaikan.
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

  // Pemanas cache: daftar Home (latest/popular), detail komik teratas, dan chapter terbarunya dijaga selalu hangat,
  // sehingga request PERTAMA pengguna pun langsung HIT (bukan menunggu scrape ke situs sumber).
  async function warmPath(pathAndQuery) {
    const url = new URL(pathAndQuery, 'http://localhost')
    const found = router.match(url.pathname, 'GET')
    if (!found?.route || !(found.route.ttl > 0)) return null
    const { value } = await cachedEntry(url, found.route, { params: found.params, query: url.searchParams, warm: null })
    try {
      return JSON.parse(value.body.toString('utf8')).data
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
      for (const s of registry.list()) {
        if (only && !only.has(s.id)) continue
        const id = encodeURIComponent(s.id)
        try {
          const latest = await warmPath(`/api/${id}/latest?page=1`)
          const popular = await warmPath(`/api/${id}/popular`)
          const slugs = [...new Set([...(latest?.items || []), ...(popular?.items || [])].map(i => i?.slug).filter(x => typeof x === 'string' && x))].slice(0, config.warmDetails ?? 6)
          let chapters = 0
          for (const slug of slugs) {
            const detail = await warmPath(`/api/${id}/comic/${encodeURIComponent(slug)}`)
            const first = detail?.chapters?.[0]?.slug
            if (typeof first === 'string' && first && chapters < (config.warmChapters ?? 3)) {
              chapters++
              await warmPath(`/api/${id}/chapter/${encodeURIComponent(slug)}/${encodeURIComponent(first)}`)
            }
            await new Promise(r => setTimeout(r, 100)) // jeda kecil agar situs sumber tidak dibanjiri
          }
        } catch (err) {
          logger.error(`[warm] ${s.id} gagal → ${err?.message || err}`)
        }
      }
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
      if (route.body) ctx.body = await readJson(req, url.pathname.endsWith('/me/avatar') ? 512 * 1024 : 16_384)
      if (route.raw) return await route.handler(ctx)

      if (route.ttl > 0) {
        const { value, state } = await cachedEntry(url, route, ctx)
        return send(req, res, value, { cacheSeconds: route.ttl, cacheState: state })
      }
      // dinamis: kompres hanya kalau klien meminta, level ringan
      // GET dinamis (profil, komentar, riwayat): boleh disimpan klien tapi wajib divalidasi ETag; tulis (POST/PUT/DELETE) tetap no-store
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
    cache,
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
