import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

const BREAKER_THRESHOLD = 3
const BREAKER_COOLDOWN_MS = 10_000

/**
 * Optional shared L2 cache for Upstash Redis REST (no native module required).
 * Local TtlCache remains L1 so hot requests never wait for Redis.
 * Redis failures are deliberately fail-open: the scraper/API remains available.
 */
export class RedisRestCache {
  constructor({ url, token, prefix = 'komikta:api:v1:', timeoutMs = 250 }) {
    this.url = String(url || '').replace(/\/+$/, '')
    this.token = token
    this.prefix = prefix
    this.timeoutMs = timeoutMs
    this.enabled = Boolean(this.url && this.token)
    this.failures = 0
    this.downUntil = 0
  }

  #fail() {
    if (++this.failures >= BREAKER_THRESHOLD) {
      this.failures = 0
      this.downUntil = Date.now() + BREAKER_COOLDOWN_MS
    }
    return null
  }

  key(input) {
    const digest = createHash('sha256').update(String(input)).digest('hex')
    return `${this.prefix}${digest}`
  }

  async #command(command) {
    if (!this.enabled || Date.now() < this.downUntil) return null
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(this.timeoutMs)
      })
      if (response.status >= 500 || response.status === 429) return this.#fail()
      if (!response.ok) return null
      const payload = await response.json()
      this.failures = 0
      if (payload?.error) return null
      return payload?.result ?? null
    } catch {
      return this.#fail()
    }
  }

  async get(input) {
    const raw = await this.#command(['GET', this.key(input)])
    if (typeof raw !== 'string') return null
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.etag !== 'string') return null
      const gzipped = typeof parsed.gzipped === 'string' ? Buffer.from(parsed.gzipped, 'base64') : null
      if (typeof parsed.body === 'string') return { body: Buffer.from(parsed.body, 'base64'), gzipped, etag: parsed.etag }
      if (!gzipped) return null
      return { body: gunzipSync(gzipped), gzipped, etag: parsed.etag }
    } catch {
      return null
    }
  }


  /** Atomic shared fixed-window counter for rate limiting across backend replicas. */
  async consumeRateLimit(identifier, { max, windowMs }, namespace = 'api') {
    if (!this.enabled || !Number.isFinite(max) || max < 1 || !Number.isFinite(windowMs) || windowMs < 1) return null
    const key = `${this.prefix}rl:${namespace}:${createHash('sha256').update(String(identifier)).digest('hex')}`
    const script = `local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; local ttl = redis.call('PTTL', KEYS[1]); return {count, ttl}`
    const result = await this.#command(['EVAL', script, '1', key, String(Math.floor(windowMs))])
    if (!Array.isArray(result) || result.length < 2) return null
    const count = Number(result[0])
    const ttl = Number(result[1])
    if (!Number.isFinite(count) || !Number.isFinite(ttl)) return null
    return {
      ok: count <= max,
      remaining: Math.max(0, max - count),
      retryAfter: Math.max(1, Math.ceil(Math.max(0, ttl) / 1000))
    }
  }

  async set(input, entry, ttlSeconds) {
    if (!this.enabled || !Number.isFinite(ttlSeconds) || ttlSeconds < 1) return false
    const value = JSON.stringify(
      entry.gzipped
        ? { gzipped: entry.gzipped.toString('base64'), etag: entry.etag }
        : { body: entry.body.toString('base64'), etag: entry.etag }
    )
    const result = await this.#command(['SET', this.key(input), value, 'EX', Math.max(1, Math.floor(ttlSeconds))])
    return result === 'OK'
  }
}
