const int = (v, d) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : d
}

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
    requestTimeoutMs: int(env.REQUEST_TIMEOUT_MS, 25_000),
    logRequests: env.LOG_REQUESTS !== 'false',
    // halaman tes di /playground — set PLAYGROUND=false untuk mematikan
    playground: env.PLAYGROUND !== 'false'
  }
}
