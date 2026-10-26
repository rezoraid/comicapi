/**
 * Cache TTL in-memory (LRU sederhana) dengan:
 *  - dedupe: request identik yang datang barengan cuma memicu 1 scrape
 *  - stale-if-error: kalau sumber down, tetap sajikan data lama (maks staleMs)
 */
export class TtlCache {
  constructor({ max = 1000, staleMs = 6 * 60 * 60 * 1000 } = {}) {
    this.max = max
    this.staleMs = staleMs
    this.map = new Map()
    this.inflight = new Map()
  }

  get size() {
    return this.map.size
  }

  set(key, value, ttlMs) {
    const now = Date.now()
    this.map.delete(key)
    this.map.set(key, { value, exp: now + ttlMs, staleUntil: now + ttlMs + this.staleMs })
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value)
  }

  /** loader() dipanggil hanya saat cache kosong/kadaluarsa. Return { value, state: HIT|MISS|STALE } */
  remember(key, ttlMs, loader) {
    const now = Date.now()
    const entry = this.map.get(key)
    if (entry && entry.exp > now) {
      this.map.delete(key)
      this.map.set(key, entry) // refresh urutan LRU
      return Promise.resolve({ value: entry.value, state: 'HIT' })
    }
    if (this.inflight.has(key)) return this.inflight.get(key)

    const p = Promise.resolve()
      .then(async () => {
        try {
          const value = await loader()
          this.set(key, value, ttlMs)
          return { value, state: 'MISS' }
        } catch (err) {
          if (entry && entry.staleUntil > Date.now()) return { value: entry.value, state: 'STALE' }
          throw err
        }
      })
      .finally(() => this.inflight.delete(key))

    this.inflight.set(key, p)
    return p
  }
}
