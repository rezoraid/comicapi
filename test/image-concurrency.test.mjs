import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { PNG, listen, makeRegistry } from './helpers.mjs'

let img, api, app
let upstream = 0
let peak = 0
const logger = { log() {}, error() {} }
const proxy = id => `${api.url}/api/image?url=${encodeURIComponent(`http://127.0.0.1:${img.port}/${id}.png`)}`

before(async () => {
  img = await listen((req, res) => {
    peak = Math.max(peak, ++upstream)
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
      res.end(PNG, () => upstream--)
    }, 40)
  })
  const config = loadConfig({ LOG_REQUESTS: 'false', IMAGE_CACHE_MB: '0', IMAGE_CONCURRENCY: '2', IMAGE_MAX_QUEUE: '3', IMAGE_RATE_LIMIT_MAX: '1000' })
  app = createApp({ registry: makeRegistry(img.port), config, logger })
  api = await listen(app.handler)
})

after(() => {
  api.server.close()
  img.server.close()
  app.close()
})

test('image proxy: unduhan ke sumber dibatasi, sisanya antre, dan kelebihan antrean ditolak 503', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => fetch(proxy(i)).then(async r => ({ status: r.status, body: Buffer.from(await r.arrayBuffer()) }))))
  const ok = results.filter(r => r.status === 200)
  const busy = results.filter(r => r.status === 503)
  assert.equal(ok.length + busy.length, 8)
  assert.ok(ok.length >= 5)
  assert.ok(busy.length >= 1)
  assert.ok(ok.every(r => r.body.equals(PNG)))
  assert.ok(peak <= 2)
})

test('image proxy: slot dilepas setelah selesai sehingga request berikutnya normal', async () => {
  const res = await fetch(proxy('after'))
  assert.equal(res.status, 200)
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG)
})

test('image proxy: klien yang batal saat mengantre tidak menahan slot', async () => {
  const ac = new AbortController()
  const slow = Array.from({ length: 2 }, (_, i) => fetch(proxy(`s${i}`)).then(r => r.arrayBuffer()))
  const queued = fetch(proxy('queued'), { signal: ac.signal }).catch(() => 'aborted')
  setTimeout(() => ac.abort(), 10)
  assert.equal(await queued, 'aborted')
  await Promise.all(slow)
  const res = await fetch(proxy('final'))
  assert.equal(res.status, 200)
  await res.arrayBuffer()
})
