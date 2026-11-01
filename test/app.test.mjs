import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { TtlCache } from '../src/lib/cache.js'

import { PNG, quiet, listen, makeRegistry } from './helpers.mjs'

let img, api, registry, app
const j = async res => ({ status: res.status, headers: res.headers, body: await res.json() })

before(async () => {
  img = await listen((req, res) => {
    if (req.url === '/img/1.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
      return res.end(PNG)
    }
    if (req.url === '/img/html') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<html/>')
    }
    res.writeHead(404).end()
  })
  registry = makeRegistry(img.port)
  app = createApp({ registry, config: loadConfig({ LOG_REQUESTS: 'false' }), logger: quiet })
  api = await listen(app.handler)
})

after(() => {
  api.server.close()
  img.server.close()
  app.close()
})

test('health & root bisa diakses publik', async () => {
  const r = await j(await fetch(`${api.url}/health`))
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.data.status, 'ok')
  assert.equal((await j(await fetch(`${api.url}/`))).body.data.name, 'comic-api')
})

test('/api/sources', async () => {
  const r = await j(await fetch(`${api.url}/api/sources`))
  assert.equal(r.body.data.items[0].id, 'mock')
})

test('search per sumber + validasi', async () => {
  const r = await j(await fetch(`${api.url}/api/mock/search?q=solo&limit=3`))
  assert.equal(r.body.data.items.length, 3)
  assert.equal((await j(await fetch(`${api.url}/api/mock/search`))).status, 400)
  assert.equal((await j(await fetch(`${api.url}/api/mock/search?q=a&limit=999`))).status, 400)
})

test('search semua sumber', async () => {
  const r = await j(await fetch(`${api.url}/api/search?q=solo&limit=2`))
  assert.equal(r.body.data.items[0].source, 'mock')
  assert.deepEqual(r.body.data.failed, [])
})

test('cache: request kedua HIT dan scraper tidak dipanggil lagi', async () => {
  const url = `${api.url}/api/mock/search?q=cachetest&limit=5`
  const before = registry.provider.calls
  const a = await fetch(url)
  const b = await fetch(`${api.url}/api/mock/search?limit=5&q=cachetest`) // urutan param beda
  assert.equal(a.headers.get('x-cache'), 'MISS')
  assert.equal(b.headers.get('x-cache'), 'HIT')
  assert.equal(registry.provider.calls - before, 1)
})

test('request identik barengan hanya memicu 1 scrape (dedupe)', async () => {
  const before = registry.provider.calls
  await Promise.all(Array.from({ length: 10 }, () => fetch(`${api.url}/api/mock/search?q=barengan&limit=4`).then(r => r.json())))
  assert.equal(registry.provider.calls - before, 1)
})

test('gzip untuk payload besar + ETag/304', async () => {
  const url = `${api.url}/api/mock/search?q=besar&limit=30`
  const a = await fetch(url)
  assert.equal(a.headers.get('content-encoding'), 'gzip')
  const etag = a.headers.get('etag')
  await a.arrayBuffer()
  const b = await fetch(url, { headers: { 'if-none-match': etag } })
  assert.equal(b.status, 304)
})

test('latest / popular / browse / genres', async () => {
  assert.equal((await j(await fetch(`${api.url}/api/mock/latest?page=2`))).body.data.page, 2)
  assert.equal((await j(await fetch(`${api.url}/api/mock/popular?limit=2`))).body.data.items.length, 2)
  const b = await j(await fetch(`${api.url}/api/mock/browse?q=x&genre=Action,Fantasy&type=manhwa&page=3`))
  assert.deepEqual(b.body.data.got.genre, ['action', 'fantasy'])
  assert.equal(b.body.data.got.page, 3)
  assert.equal((await j(await fetch(`${api.url}/api/mock/browse?type=bukan`))).status, 400)
  assert.deepEqual((await j(await fetch(`${api.url}/api/mock/genres`))).body.data.items, ['Action', 'Fantasy'])
})

test('detail + error mapping (404 / 502 / sumber tak ada)', async () => {
  assert.equal((await j(await fetch(`${api.url}/api/mock/comic/solo-leveling`))).body.data.slug, 'solo-leveling')
  const nf = await j(await fetch(`${api.url}/api/mock/comic/missing`))
  assert.equal(nf.status, 404)
  assert.equal(nf.body.error.code, 'NOT_FOUND')
  const boom = await j(await fetch(`${api.url}/api/mock/comic/boom`))
  assert.equal(boom.status, 502)
  assert.ok(!JSON.stringify(boom.body).includes('meledak'), 'pesan internal tidak boleh bocor')
  assert.equal((await j(await fetch(`${api.url}/api/nope/latest`))).status, 404)
  assert.equal((await j(await fetch(`${api.url}/api/mock/comic/a%20b%2Fc`))).status, 400)
})

test('chapter menyertakan URL proxy relatif', async () => {
  const r = await j(await fetch(`${api.url}/api/mock/chapter/solo/12`))
  assert.equal(r.body.data.images.length, 1)
  assert.ok(r.body.data.proxy[0].startsWith('/api/image?url='))
})

test('image proxy: streaming gambar', async () => {
  const c = await j(await fetch(`${api.url}/api/mock/chapter/solo/1`))
  const res = await fetch(api.url + c.body.data.proxy[0])
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG)
})

test('image proxy: tolak host asing (anti-SSRF), non-gambar, url rusak', async () => {
  const bad = u => fetch(`${api.url}/api/image?url=${encodeURIComponent(u)}`)
  assert.equal((await bad('http://169.254.169.254/latest/meta-data')).status, 403)
  assert.equal((await bad('https://example.com/a.png')).status, 403)
  assert.equal((await bad('file:///etc/passwd')).status, 400)
  assert.equal((await bad(`http://127.0.0.1:${img.port}/img/html`)).status, 502)
  assert.equal((await fetch(`${api.url}/api/image`)).status, 400)
})

test('image proxy: redirect ke alamat internal ditolak, pesan menyebut host', async () => {
  const redir = await listen((req, res) => {
    res.writeHead(302, { location: `http://localhost:${img.port}/img/1.png` })
    res.end()
  })
  const r = await fetch(`${api.url}/api/image?url=${encodeURIComponent(`http://127.0.0.1:${redir.port}/x.png`)}`)
  const body = await r.json()
  redir.server.close()
  assert.equal(r.status, 403)
  assert.equal(body.error.code, 'FORBIDDEN_HOST')
  assert.match(body.error.message, /localhost/)
})

test('404 endpoint, 405 method, CORS preflight', async () => {
  assert.equal((await fetch(`${api.url}/tidak-ada`)).status, 404)
  assert.equal((await fetch(`${api.url}/api/sources`, { method: 'POST' })).status, 405)
  const pre = await fetch(`${api.url}/api/sources`, { method: 'OPTIONS' })
  assert.equal(pre.status, 204)
  assert.equal(pre.headers.get('access-control-allow-origin'), '*')
})

test('API key', async () => {
  const a = createApp({ registry, config: loadConfig({ API_KEY: 'rahasia', LOG_REQUESTS: 'false' }), logger: quiet })
  const s = await listen(a.handler)
  assert.equal((await fetch(`${s.url}/api/sources`)).status, 401)
  assert.equal((await fetch(`${s.url}/api/sources`, { headers: { 'x-api-key': 'salah' } })).status, 401)
  assert.equal((await fetch(`${s.url}/api/sources`, { headers: { 'x-api-key': 'rahasia' } })).status, 200)
  assert.equal((await fetch(`${s.url}/health`)).status, 200)
  s.server.close()
  a.close()
})

test('rate limit', async () => {
  const a = createApp({ registry, config: loadConfig({ RATE_LIMIT_MAX: '2', LOG_REQUESTS: 'false' }), logger: quiet })
  const s = await listen(a.handler)
  assert.equal((await fetch(`${s.url}/api/sources`)).status, 200)
  assert.equal((await fetch(`${s.url}/api/sources`)).status, 200)
  const r = await fetch(`${s.url}/api/sources`)
  assert.equal(r.status, 429)
  assert.ok(r.headers.get('retry-after'))
  s.server.close()
  a.close()
})

test('cache: stale-if-error saat sumber down', async () => {
  const c = new TtlCache({ staleMs: 60_000 })
  assert.equal((await c.remember('k', 1, async () => 'lama')).state, 'MISS')
  await new Promise(r => setTimeout(r, 5))
  const r = await c.remember('k', 1, async () => {
    throw new Error('down')
  })
  assert.deepEqual(r, { value: 'lama', state: 'STALE' })
  await assert.rejects(c.remember('lain', 1, async () => { throw new Error('down') }))
})

test('registry asli: manta, shinigami', async () => {
  const { default: real } = await import('../src/scrapers/index.js')
  assert.deepEqual(real.list().map(x => x.id), ['manta', 'shinigami'])
  assert.equal(real.has('softkomik'), false)
})
