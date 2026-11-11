import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { listen, makeRegistry, quiet } from './helpers.mjs'

test('Redis L2 membagikan respons cache antar instance backend', async t => {
  const originalFetch = globalThis.fetch
  const store = new Map()
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://redis.test')) return originalFetch(url, options)
    const [op, key, value, ex, seconds] = JSON.parse(options.body)
    if (op === 'GET') return new Response(JSON.stringify({ result: store.get(key) ?? null }), { status: 200 })
    if (op === 'SET' && ex === 'EX') {
      store.set(key, value)
      return new Response(JSON.stringify({ result: 'OK' }), { status: 200 })
    }
    return new Response(JSON.stringify({ error: 'bad command' }), { status: 400 })
  }
  const config = loadConfig({ LOG_REQUESTS: 'false', REDIS_REST_URL: 'https://redis.test', REDIS_REST_TOKEN: 'test-token' })
  const registry1 = makeRegistry(1)
  const registry2 = makeRegistry(1)
  const app1 = createApp({ registry: registry1, config, logger: quiet })
  const app2 = createApp({ registry: registry2, config, logger: quiet })
  const server1 = await listen(app1.handler)
  const server2 = await listen(app2.handler)
  t.after(() => {
    globalThis.fetch = originalFetch
    server1.server.close()
    server2.server.close()
    app1.close()
    app2.close()
  })
  const path = '/api/mock/search?q=shared-cache&limit=5'
  const first = await fetch(`${server1.url}${path}`)
  assert.equal(first.status, 200)
  assert.equal(registry1.provider.calls, 1)
  for (let i = 0; i < 20 && store.size === 0; i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(store.size, 1)
  const second = await fetch(`${server2.url}${path}`)
  assert.equal(second.status, 200)
  assert.equal(registry2.provider.calls, 0, 'instance kedua harus membaca dari Redis, bukan scrape ulang')
  assert.equal((await second.json()).data.items.length, 5)
})
