const int = (v, d) => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : d
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
    // Default longgar untuk APK: 1 user ≈ puluhan request/menit (browse + chapter + progress)
    rateLimit: { max: int(env.RATE_LIMIT_MAX, 180), windowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000) },
    imageRateLimit: { max: int(env.IMAGE_RATE_LIMIT_MAX, 2000), windowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000) },
    // Default lebih besar: homepage + search + detail chapter sering di-hit ulang
    cacheMax: int(env.CACHE_MAX, 4000),
    requestTimeoutMs: int(env.REQUEST_TIMEOUT_MS, 25_000),
    // Di production set LOG_REQUESTS=false atau LOG_SAMPLE=20 untuk kurangi I/O
    logRequests: env.LOG_REQUESTS !== 'false',
    // halaman tes di /playground — set PLAYGROUND=false untuk mematikan di production
    playground: env.PLAYGROUND !== 'false',
    contactEmail: env.CONTACT_EMAIL || '',
    community: {
      mongoUri: env.MONGODB_URI || '',
      dbName: env.MONGODB_DB || 'komikta',
      googleClientIds: list(env.GOOGLE_CLIENT_ID),
      authSecret: env.AUTH_SECRET || '',
      ownerEmails: list(env.OWNER_EMAILS).map(s => s.toLowerCase()),
      moderatorEmails: list(env.MODERATOR_EMAILS).map(s => s.toLowerCase()),
      tokenTtlDays: int(env.AUTH_TOKEN_TTL_DAYS, 30)
    }
  }
}
