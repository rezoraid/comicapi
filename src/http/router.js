/** Router mini: '/api/:source/comic/:slug' → { route, params } */
export class Router {
  #routes = []

  get(path, handler, opts = {}) {
    const keys = []
    const re = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$')
    this.#routes.push({ re, keys, handler, ...opts })
    return this
  }

  match(pathname) {
    for (const route of this.#routes) {
      const m = route.re.exec(pathname)
      if (!m) continue
      const params = {}
      try {
        route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])))
      } catch {
        return { bad: true }
      }
      return { route, params }
    }
    return null
  }
}
