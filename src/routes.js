import { badRequest, notFound, HttpError } from './lib/errors.js'
import { imageProxy } from './image-proxy.js'
import { playground } from './playground.js'

const SLUG = /^[\w.~%-]{1,200}$/
const CHAPTER = /^[\w.~%-]{1,50}$/

/* ───── helper validasi query ───── */
const str = (q, name, max = 100) => {
  const v = (q.get(name) ?? '').trim()
  if (v.length > max) throw badRequest(`"${name}" terlalu panjang (maks ${max})`)
  return v
}
const int = (q, name, def, min, max) => {
  const raw = q.get(name)
  if (raw == null || raw === '') return def
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`"${name}" harus angka ${min}-${max}`)
  return n
}
const oneOf = (value, allowed, name) => {
  if (value && allowed && !allowed.includes(value)) throw badRequest(`"${name}" tidak valid. Pilihan: ${allowed.join(', ')}`)
  return value
}
const slugParam = (v, name, re = SLUG) => {
  if (!re.test(v)) throw badRequest(`"${name}" tidak valid`)
  return v
}

export function registerRoutes(router, { registry, config }) {
  const source = params => {
    if (!registry.has(params.source)) throw notFound(`Sumber "${params.source}" tidak ada`)
    return registry.get(params.source)
  }
  const call = (p, fn, ...args) => {
    if (typeof p[fn] !== 'function') throw new HttpError(501, 'NOT_SUPPORTED', `${p.id} tidak mendukung ${fn}`)
    return p[fn](...args)
  }

  /* ───── info ───── */
  router.get(
    '/',
    () => ({ name: 'comic-api', sources: registry.list().map(s => s.id), docs: '/api/sources', playground: config.playground ? '/playground' : null }),
    { public: true }
  )
  if (config.playground) router.get('/playground', playground(), { raw: true, public: true })
  router.get('/health', () => ({ status: 'ok', uptime: Math.round(process.uptime()), sources: registry.list().length }), {
    public: true
  })
  router.get('/api/sources', () => ({ items: registry.list() }), { ttl: 3600 })

  /* ───── cari ke semua sumber ───── */
  router.get(
    '/api/search',
    async ({ query }) => {
      const q = str(query, 'q')
      if (!q) throw badRequest('Parameter "q" wajib diisi')
      const { items, failed } = await registry.searchAll(q, { limit: int(query, 'limit', 10, 1, 30) })
      return { items, failed }
    },
    { ttl: 60 }
  )

  /* ───── per sumber ───── */
  router.get(
    '/api/:source/search',
    async ({ params, query }) => {
      const q = str(query, 'q')
      if (!q) throw badRequest('Parameter "q" wajib diisi')
      const items = await call(source(params), 'search', q, { limit: int(query, 'limit', 10, 1, 30) })
      return { items }
    },
    { ttl: 60 }
  )

  router.get(
    '/api/:source/latest',
    async ({ params, query }) => {
      const page = int(query, 'page', 1, 1, 500)
      return { page, items: await call(source(params), 'latest', { page }) }
    },
    { ttl: 60 }
  )

  router.get(
    '/api/:source/popular',
    async ({ params, query }) => {
      const items = await call(source(params), 'popular', {
        period: str(query, 'period', 20).toLowerCase(),
        limit: int(query, 'limit', 10, 1, 50)
      })
      return { items }
    },
    { ttl: 300 }
  )

  router.get(
    '/api/:source/browse',
    ({ params, query }) => {
      const p = source(params)
      const f = p.filters || {}
      return call(p, 'browse', {
        q: str(query, 'q'),
        genre: str(query, 'genre', 200).split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
        type: oneOf(str(query, 'type', 20).toLowerCase(), f.types, 'type'),
        status: oneOf(str(query, 'status', 20).toLowerCase(), f.statuses, 'status'),
        sort: oneOf(str(query, 'sort', 20).toLowerCase(), f.sorts, 'sort'),
        minChapters: int(query, 'min', 0, 0, 10000) || '',
        page: int(query, 'page', 1, 1, 500)
      })
    },
    { ttl: 120 }
  )

  router.get('/api/:source/genres', async ({ params }) => ({ items: await call(source(params), 'genres') }), { ttl: 3600 })

  router.get(
    '/api/:source/comic/:slug',
    ({ params }) => call(source(params), 'detail', slugParam(params.slug, 'slug')),
    { ttl: 300 }
  )

  router.get(
    '/api/:source/chapter/:slug/:chapter',
    async ({ params }) => {
      const p = source(params)
      const data = await call(p, 'chapter', slugParam(params.slug, 'slug'), slugParam(params.chapter, 'chapter', CHAPTER))
      // path relatif: klien (APK) tinggal prefix dengan base URL server
      return { ...data, proxy: data.images.map(u => `/api/image?url=${encodeURIComponent(u)}`) }
    },
    { ttl: 600 }
  )

  /* ───── image proxy (streaming, bukan JSON) ───── */
  router.get('/api/image', imageProxy(registry), { raw: true, limiter: 'image' })
}
