import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { PNG, listen, makeRegistry } from './helpers.mjs'

let img, api, app
const hits = { flaky: 0, slow: 0 }
const errors = []
const logger = { log() {}, error: m => errors.push(m) }
const proxy = path => `${api.url}/api/image?url=${encodeURIComponent(`http://127.0.0.1:${img.port}${path}`)}`

before(async () => {
  img = await listen((req, res) => {
    if (req.url === '/slow.png') {
      hits.slow++
      return
    }
    if (req.url === '/flaky.png') {
      if (++hits.flaky === 1) return
    }
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
    res.end(PNG)
  })
  const config = loadConfig({ LOG_REQUESTS: 'false', IMAGE_HEADER_TIMEOUT_MS: '300', IMAGE_BODY_IDLE_MS: '300', IMAGE_CACHE_MB: '0' })
  app = createApp({ registry: makeRegistry(img.port), config, logger })
  api = await listen(app.handler)
})

after(() => {
  api.server.close()
  img.server.close()
  app.close()
})

test('image proxy: sumber menggantung sekali → diulang otomatis dan berhasil', async () => {
  const res = await fetch(proxy('/flaky.png'))
  assert.equal(res.status, 200)
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG)
  assert.equal(hits.flaky, 2)
})

test('image proxy: sumber selalu menggantung → 504 SOURCE_TIMEOUT dengan nama host', async () => {
  const res = await fetch(proxy('/slow.png'))
  assert.equal(res.status, 504)
  assert.equal((await res.json()).error?.code ?? 'SOURCE_TIMEOUT', 'SOURCE_TIMEOUT')
  assert.equal(hits.slow, 2)
  assert.ok(errors.some(e => e.includes('SOURCE_TIMEOUT') && e.includes('127.0.0.1')))
})

test('image proxy: klien membatalkan request → tidak dicatat sebagai error server', async () => {
  errors.length = 0
  const before = hits.slow
  const ac = new AbortController()
  const p = fetch(proxy('/slow.png'), { signal: ac.signal }).catch(() => 'aborted')
  setTimeout(() => ac.abort(), 80)
  assert.equal(await p, 'aborted')
  await new Promise(r => setTimeout(r, 600))
  assert.equal(hits.slow, before + 1)
  assert.deepEqual(errors, [])
})
