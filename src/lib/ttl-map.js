export function createTtlMap({ ttlMs, max = 2000, now = Date.now }) {
  const map = new Map()
  return {
    get(key) {
      const e = map.get(key)
      if (!e) return undefined
      if (e.exp <= now()) {
        map.delete(key)
        return undefined
      }
      return e.value
    },
    set(key, value) {
      map.delete(key)
      map.set(key, { value, exp: now() + ttlMs })
      if (map.size > max) map.delete(map.keys().next().value)
      return value
    },
    delete: key => map.delete(key),
    get size() {
      return map.size
    }
  }
}
