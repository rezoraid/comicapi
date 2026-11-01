export class Router {
  #routes = []

  add(method, path, handler, opts = {}) {
    const keys = []
    const re = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$')
    this.#routes.push({ method, re, keys, handler, ...opts })
    return this
  }

  get = (path, handler, opts) => this.add('GET', path, handler, opts)
  post = (path, handler, opts) => this.add('POST', path, handler, { body: true, ...opts })
  put = (path, handler, opts) => this.add('PUT', path, handler, { body: true, ...opts })
  patch = (path, handler, opts) => this.add('PATCH', path, handler, { body: true, ...opts })
  delete = (path, handler, opts) => this.add('DELETE', path, handler, opts)

  match(pathname, method = 'GET') {
    const verb = method === 'HEAD' ? 'GET' : method
    const allowed = new Set()
    for (const route of this.#routes) {
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
