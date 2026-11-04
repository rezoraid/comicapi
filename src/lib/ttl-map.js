/**
 * Map dengan TTL + batas ukuran (LRU kasar). Aman di bawah traffic tinggi:
 * tidak bocor memori meski jutaan IP/user unik lewat.
 */
export class TtlMap {
  constructor({ max = 10_000, ttlMs = 60_000 } = {}) {
    this.max = max
    this.ttlMs = ttlMs
    this.map = new Map()
  }

  get size() {
    return this.map.size
  }

  get(key) {
    const e = this.map.get(key)
    if (!e) return undefined
    if (e.exp <= Date.now()) {
      this.map.delete(key)
      return undefined
    }
    // refresh LRU
    this.map.delete(key)
    this.map.set(key, e)
    return e.value
  }

  set(key, value, ttlMs = this.ttlMs) {
    this.map.delete(key)
    this.map.set(key, { value, exp: Date.now() + ttlMs })
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value)
  }

  delete(key) {
    this.map.delete(key)
  }

  clear() {
    this.map.clear()
  }
}
