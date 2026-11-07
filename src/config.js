const int = (v, d) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : d
}

// LOG_REQUESTS: true/all = semua request, false/off = mati, selain itu (default) = hanya error (>=400) dan request lambat.
// Log per-request ke stdout itu sinkron di Linux, jadi mencatat semuanya ikut membebani server saat ramai.
const logMode = v => {
  const s = String(v ?? '').toLowerCase()
  if (['false', '0', 'off', 'no'].includes(s)) return 'off'
  if (['true', '1', 'all', 'yes'].includes(s)) return 'all'
  return 'errors'
}

const list = v => (v || '').split(',').map(s => s.trim()).filter(Boolean)

export function loadConfig(env = process.env) {
  return {
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    // '*' atau daftar origin dipisah koma, mis. https://app.example.com
    corsOrigin: env.CORS_ORIGIN || '*',
    // kosong = tanpa auth. Kalau diisi, klien wajib kirim header x-api-key
    apiKey: env.API_KEY || '',
    // di belakang proxy (Railway, Nginx, Cloudflare) → baca IP asli dari x-forwarded-for
    trustProxy: env.TRUST_PROXY !== 'false',
    rateLimit: { max: int(env.RATE_LIMIT_MAX, 120), windowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000) },
    imageRateLimit: { max: int(env.IMAGE_RATE_LIMIT_MAX, 1500), windowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000) },
    cacheMax: int(env.CACHE_MAX, 1000),
    // cache gambar proxy di memori (MB). 0 = mati. Item > 1,5 MB tidak disimpan
    imageCacheMb: int(env.IMAGE_CACHE_MB, 48),
    // proxy gambar: tunggu sumber mulai merespons (ms), batas diam saat unduh (ms), jumlah ulang kalau timeout
    imageHeaderTimeoutMs: int(env.IMAGE_HEADER_TIMEOUT_MS, 12_000),
    imageBodyIdleMs: int(env.IMAGE_BODY_IDLE_MS, 15_000),
    imageFetchRetries: int(env.IMAGE_FETCH_RETRIES, 1),
    imageConcurrency: int(env.IMAGE_CONCURRENCY, 128),
    imageMaxQueue: int(env.IMAGE_MAX_QUEUE, 1024),
    // pemanas cache: daftar utama + detail/chapter teratas dijaga hangat di server (0 detik interval = mati lewat WARM_ENABLED=false)
    warmEnabled: env.WARM_ENABLED !== 'false',
    warmIntervalSec: int(env.WARM_INTERVAL_SEC, 30),
    warmDetails: int(env.WARM_DETAILS, 6),
    warmChapters: int(env.WARM_CHAPTERS, 3),
    warmSources: (env.WARM_SOURCES || '').split(',').map(s => s.trim()).filter(Boolean),
    // batas total memori cache respons (MB). 0 = tanpa batas byte
    cacheMaxMb: int(env.CACHE_MAX_MB, 96),
    // Optional Upstash Redis REST shared L2 cache. Keep local L1 cache active if unset/unavailable.
    redisRestUrl: env.REDIS_REST_URL || '',
    redisRestToken: env.REDIS_REST_TOKEN || '',
    redisKeyPrefix: env.REDIS_KEY_PREFIX || 'komikta:api:v1:',
    redisTimeoutMs: int(env.REDIS_TIMEOUT_MS, 250),
    slowRequestMs: int(env.SLOW_REQUEST_MS, 1000),
    requestTimeoutMs: int(env.REQUEST_TIMEOUT_MS, 25_000),
    logRequests: logMode(env.LOG_REQUESTS),
    // halaman tes di /playground — set PLAYGROUND=false untuk mematikan
    playground: env.PLAYGROUND !== 'false',
    contactEmail: env.CONTACT_EMAIL || '',
    // katalog internal: sinkronisasi detail komik, metadata luar (AniList), dan crawler seluruh komik
    catalog: {
      enabled: env.CATALOG !== 'false',
      metaEnrich: env.META_ENRICH !== 'false', // false = tidak menghubungi AniList sama sekali
      crawl: env.CATALOG_CRAWL !== 'false',
      crawlPagesPerCycle: int(env.CATALOG_CRAWL_PAGES, 8),
      crawlIntervalMs: int(env.CATALOG_CRAWL_INTERVAL_MIN, 20) * 60_000,
      crawlDelayMs: int(env.CATALOG_CRAWL_DELAY_MS, 400),
      inlineMax: int(env.CATALOG_INLINE_MAX, 12)
    },
    community: {
      mongoUri: env.MONGODB_URI || '',
      dbName: env.MONGODB_DB || 'komikta',
      googleClientIds: list(env.GOOGLE_CLIENT_ID),
      authSecret: env.AUTH_SECRET || '',
      ownerEmails: list(env.OWNER_EMAILS).map(s => s.toLowerCase()),
      moderatorEmails: list(env.MODERATOR_EMAILS).map(s => s.toLowerCase()),
      tokenTtlDays: int(env.AUTH_TOKEN_TTL_DAYS, 30),
      // connection pool MongoDB (per instance)
      mongoPoolMax: int(env.MONGO_POOL_MAX, 30),
      mongoPoolMin: int(env.MONGO_POOL_MIN, 2),
      // jeda tulis-belakangan untuk progres baca (ms). 0 = tulis langsung
      progressFlushMs: int(env.PROGRESS_FLUSH_MS, 1000),
      firebase: { projectId: env.FIREBASE_PROJECT_ID || 'komikta-id', serviceAccount: env.FIREBASE_SERVICE_ACCOUNT || '' }
    }
  }
}
