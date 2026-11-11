import { createHybridRateLimiter } from '../http/middleware.js'
import { connectMongo, collections, ensureIndexes, backfillAvatarFlag } from './db.js'
import { createProgressWriter } from './progress-writer.js'
import { createTtlMap } from '../lib/ttl-map.js'
import { createGoogleVerifier } from './google.js'
import { createTokens } from './tokens.js'
import { createPush, createMessaging } from './push.js'

const defaultLimits = {
  commentBurst: { max: 4, windowMs: 30_000 },
  commentHour: { max: 40, windowMs: 3_600_000 },
  write: { max: 30, windowMs: 60_000 },
  like: { max: 60, windowMs: 60_000 },
  report: { max: 10, windowMs: 3_600_000 },
  login: { max: 20, windowMs: 60_000 },
  readTime: { max: 12, windowMs: 60_000 },
  view: { max: 120, windowMs: 60_000 }
}

function missingConfig(cfg) {
  const m = []
  if (!cfg.mongoUri) m.push('MONGODB_URI')
  if (!cfg.googleClientIds.length) m.push('GOOGLE_CLIENT_ID')
  if (cfg.authSecret.length < 32) m.push('AUTH_SECRET (minimal 32 karakter)')
  return m
}

export async function createCommunity(cfg, opts = {}) {
  const { db = null, fetchJwks, limits = {}, now = Date.now, logger = console, sharedCache = null } = opts
  const missing = missingConfig(db ? { ...cfg, mongoUri: 'injected' } : cfg)
  if (missing.length) {
    logger.log(`komunitas nonaktif, env belum lengkap: ${missing.join(', ')}`)
    return null
  }
  const conn = db ? { db, close: async () => {} } : await connectMongo(cfg)
  const c = collections(conn.db)
  await ensureIndexes(c, logger)
  await backfillAvatarFlag(c, logger)
  const cfgLimits = Object.fromEntries(Object.entries(defaultLimits).map(([k, v]) => [k, createHybridRateLimiter({ ...v, ...limits[k], sharedCache, namespace: `community:${k}` })]))
  const progress = createProgressWriter(c.readingProgress, { flushMs: opts.progressFlushMs ?? cfg.progressFlushMs ?? 1000, logger })
  const messaging = opts.messaging !== undefined ? opts.messaging : await createMessaging(cfg, logger)
  const ctx = {
    c,
    cfg,
    now,
    progress,
    push: createPush({ c, messaging, now, logger }),
    avatars: createTtlMap({ ttlMs: 300_000, max: 120, now }),
    stats: {
      chaptersRead: createTtlMap({ ttlMs: 10_000, now }),
      likeCount: createTtlMap({ ttlMs: 5_000, now }),
      commentTotal: createTtlMap({ ttlMs: 5_000, now }),
      chapterCounts: createTtlMap({ ttlMs: 15_000, max: 500, now })
    },
    google: createGoogleVerifier({ clientIds: cfg.googleClientIds, fetchJwks, now }),
    tokens: createTokens({ secret: cfg.authSecret, ttlDays: cfg.tokenTtlDays, now }),
    limits: cfgLimits,
    close: async () => {
      Object.values(cfgLimits).forEach(l => l.close())
      await ctx.push.flush()
      await progress.close()
      await conn.close()
    }
  }
  return ctx
}
