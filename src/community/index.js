import { createRateLimiter } from '../http/middleware.js'
import { connectMongo, collections, ensureIndexes } from './db.js'
import { createGoogleVerifier } from './google.js'
import { createTokens } from './tokens.js'

const defaultLimits = {
  commentBurst: { max: 4, windowMs: 30_000 },
  commentHour: { max: 40, windowMs: 3_600_000 },
  write: { max: 30, windowMs: 60_000 },
  like: { max: 60, windowMs: 60_000 },
  report: { max: 10, windowMs: 3_600_000 },
  login: { max: 20, windowMs: 60_000 }
}

export function missingConfig(cfg) {
  const m = []
  if (!cfg.mongoUri) m.push('MONGODB_URI')
  if (!cfg.googleClientIds.length) m.push('GOOGLE_CLIENT_ID')
  if (cfg.authSecret.length < 32) m.push('AUTH_SECRET (minimal 32 karakter)')
  return m
}

export async function createCommunity(cfg, { db = null, fetchJwks, limits = {}, now = Date.now, logger = console } = {}) {
  const missing = missingConfig(db ? { ...cfg, mongoUri: 'injected' } : cfg)
  if (missing.length) {
    logger.log(`komunitas nonaktif, env belum lengkap: ${missing.join(', ')}`)
    return null
  }
  const conn = db ? { db, close: async () => {} } : await connectMongo(cfg)
  const c = collections(conn.db)
  await ensureIndexes(c)
  const cfgLimits = Object.fromEntries(Object.entries(defaultLimits).map(([k, v]) => [k, createRateLimiter({ ...v, ...limits[k] })]))
  const ctx = {
    c,
    cfg,
    now,
    google: createGoogleVerifier({ clientIds: cfg.googleClientIds, fetchJwks, now }),
    tokens: createTokens({ secret: cfg.authSecret, ttlDays: cfg.tokenTtlDays, now }),
    limits: cfgLimits,
    close: async () => {
      Object.values(cfgLimits).forEach(l => l.close())
      await conn.close()
    }
  }
  return ctx
}
