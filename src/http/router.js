const segmentCount = path => {
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  let n = 0
  for (let i = 0; i < trimmed.length; i++) if (trimmed.charCodeAt(i) === 47) n++
  return trimmed === '/' ? 0 : n
}

export class Router {
  #buckets = new Map()

  add(method, path, handler, opts = {}) {
    const keys = []
    const re = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$')
    const bucket = segmentCount(path)
    if (!this.#buckets.has(bucket)) this.#buckets.set(bucket, [])
    this.#buckets.get(bucket).push({ method, re, keys, handler, ...opts })
    return this
  }

  get = (path, handler, opts) => this.add('GET', path, handler, opts)
  post = (path, handler, opts) => this.add('POST', path, handler, { body: true, ...opts })
  put = (path, handler, opts) => this.add('PUT', path, handler, { body: true, ...opts })
  patch = (path, handler, opts) => this.add('PATCH', path, handler, { body: true, ...opts })
  delete = (path, handler, opts) => this.add('DELETE', path, handler, opts)

  match(pathname, method = 'GET') {
    const verb = method === 'HEAD' ? 'GET' : method
    const routes = this.#buckets.get(segmentCount(pathname))
    if (!routes) return null
    const allowed = new Set()
    for (const route of routes) {
      const m = route.re.exec(pathname)
      if (!m) continue
      if (route.method !== verb) {
        allowed.add(route.method)
        continue
      }
      const params = {}
      try {
        route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
      } catch {
        return { bad: true }
      }
      return { route, params }
    }
    return allowed.size ? { allowed: [...allowed] } : null
  }
}
