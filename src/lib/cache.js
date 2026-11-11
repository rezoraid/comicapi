const entrySize = value => (value?.body?.length || 0) + (value?.gzipped?.length || 0) + 256

export class TtlCache {
  constructor({ max = 1000, maxBytes = 0, staleMs = 6 * 60 * 60 * 1000, swrRatio = 1, retryMs = 15_000, sizeOf = entrySize, onError = () => {} } = {}) {
    this.max = max
    this.maxBytes = maxBytes
    this.staleMs = staleMs
    this.swrRatio = swrRatio
    this.retryMs = retryMs
    this.sizeOf = sizeOf
    this.onError = onError
    this.map = new Map()
    this.inflight = new Map()
    this.bytes = 0
  }
  get size() {
    return this.map.size
  }
  #drop(key) {
    const e = this.map.get(key)
    if (e) {
      this.bytes -= e.size
      this.map.delete(key)
    }
  }
  set(key, value, ttlMs) {
    const now = Date.now()
    const size = this.maxBytes ? this.sizeOf(value) : 0
    this.#drop(key)
    if (this.maxBytes && size > this.maxBytes) return
    this.map.set(key, { value, size, exp: now + ttlMs, swrUntil: now + ttlMs + ttlMs * this.swrRatio, staleUntil: now + ttlMs + this.staleMs, retryAt: 0 })
    this.bytes += size
    while (this.map.size > this.max || (this.maxBytes && this.bytes > this.maxBytes)) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.#drop(oldest)
    }
  }
  remember(key, ttlMs, loader) {
    const now = Date.now()
    const entry = this.map.get(key)
    if (entry && entry.exp > now) {
      this.map.delete(key)
      this.map.set(key, entry)
      return Promise.resolve({ value: entry.value, state: 'HIT' })
    }
    if (entry && entry.swrUntil > now) {
      if (!this.inflight.has(key) && entry.retryAt <= now) this.#load(key, ttlMs, loader, entry).catch(() => {})
      return Promise.resolve({ value: entry.value, state: 'STALE' })
    }
    if (this.inflight.has(key)) return this.inflight.get(key)
    return this.#load(key, ttlMs, loader, entry)
  }
  #load(key, ttlMs, loader, entry) {
    const p = Promise.resolve()
      .then(async () => {
        try {
          const value = await loader()
          this.set(key, value, ttlMs)
          return { value, state: 'MISS' }
        } catch (err) {
          this.onError(key, err)
          if (entry && entry.staleUntil > Date.now()) {
            entry.retryAt = Date.now() + this.retryMs
            return { value: entry.value, state: 'STALE' }
          }
          throw err
        }
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }
}
