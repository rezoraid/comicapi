import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { PNG, listen, makeRegistry } from './helpers.mjs'

let img, api, app, registry
const hits = { bad: 0, good: 0 }
const proxy = path => `${api.url}/api/image?url=${encodeURIComponent(`http://127.0.0.1:${img.port}${path}`)}`

before(async () => {
  img = await listen((req, res) => {
    if (req.url.startsWith('/bad/')) {
      hits.bad++
      res.writeHead(403)
      return res.end('no')
    }
    if (req.url.startsWith('/good/')) hits.good++
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
    res.end(PNG)
  })
  const config = loadConfig({ LOG_REQUESTS: 'false', IMAGE_CACHE_MB: '0' })
  registry = makeRegistry(img.port)
  registry.provider.imageFallback = u => (u.pathname.startsWith('/bad/') ? `http://127.0.0.1:${img.port}${u.pathname.replace('/bad/', '/good/')}` : null)
  app = createApp({ registry, config, logger: { log() {}, error() {} } })
  api = await listen(app.handler)
})

after(() => {
  api.server.close()
  img.server.close()
  app.close()
})

test('image proxy: sumber utama 403 → pakai alamat cadangan scraper dan berhasil', async () => {
  const res = await fetch(proxy('/bad/a.png'))
  assert.equal(res.status, 200)
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG)
  assert.equal(hits.bad, 1)
  assert.equal(hits.good, 1)
})

test('image proxy: gagal dan tidak ada cadangan → tetap error 502', async () => {
  registry.provider.imageFallback = () => null
  const res = await fetch(proxy('/bad/c.png'))
  assert.equal(res.status, 502)
  registry.provider.imageFallback = u => (u.pathname.startsWith('/bad/') ? `http://127.0.0.1:${img.port}${u.pathname.replace('/bad/', '/good/')}` : null)
})

test('image proxy: gambar normal tidak memicu cadangan', async () => {
  const before = hits.good
  const res = await fetch(proxy('/good/b.png'))
  assert.equal(res.status, 200)
  assert.equal(hits.good, before + 1)
})
