import http from 'node:http'

export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
export const quiet = { log() {}, error() {} }

export const listen = handler =>
  new Promise(resolve => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${server.address().port}`, port: server.address().port })
    )
  })

export function makeRegistry(imagePort) {
  const items = Array.from({ length: 40 }, (_, i) => ({ title: `Komik ${i}`, slug: `komik-${i}`, cover: '', type: 'manhwa' }))
  const provider = {
    id: 'mock',
    name: 'Mock',
    base: 'http://mock.local',
    imageHeaders: { referer: 'http://mock.local/' },
    imageHosts: ['127.0.0.1'],
    filters: { types: ['manhwa'] },
    calls: 0,
    async search(q, { limit }) {
      this.calls++
      return items.slice(0, limit)
    },
    async latest({ page }) {
      return items.slice(0, 5).map(x => ({ ...x, page }))
    },
    async popular({ limit }) {
      return items.slice(0, limit)
    },
    async browse(o) {
      return { items: items.slice(0, 3), page: o.page, pages: 9, total: 27, got: o }
    },
    async genres() {
      return ['Action', 'Fantasy']
    },
    async detail(slug) {
      if (slug === 'missing') throw Object.assign(new Error('HTTP 404'), { status: 404 })
      if (slug === 'boom') throw new Error('upstream meledak')
      return { title: slug, slug, chapters: [{ slug: '1', number: '1' }] }
    },
    async chapter(slug, ch) {
      return { comic: slug, chapter: ch, images: [`http://127.0.0.1:${imagePort}/img/1.png`], prev: null, next: '2' }
    }
  }
  const all = new Map([['mock', provider]])
  return {
    provider,
    has: id => all.has(id),
    get: id => all.get(id),
    list: () => [{ id: 'mock', name: 'Mock', base: provider.base, filters: provider.filters, features: ['search'] }],
    findByImageHost: h => (h === '127.0.0.1' ? provider : null),
    async searchAll(q, { limit }) {
      return { items: (await provider.search(q, { limit })).map(x => ({ ...x, source: 'mock' })), failed: [] }
    }
  }
}

