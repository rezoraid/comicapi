import test from 'node:test'
import assert from 'node:assert/strict'
import { RedisRestCache } from '../src/lib/redis-rest-cache.js'
import { createHybridRateLimiter } from '../src/http/middleware.js'

test('Redis REST cache round-trips encoded HTTP response and uses namespaced hashed keys', async t => {
  const originalFetch = globalThis.fetch
  const store = new Map()
  const commands = []
  globalThis.fetch = async (_url, options) => {
    const command = JSON.parse(options.body)
    commands.push(command)
    if (command[0] === 'SET') {
      store.set(command[1], command[2])
      return new Response(JSON.stringify({ result: 'OK' }), { status: 200 })
    }
    if (command[0] === 'GET') {
      return new Response(JSON.stringify({ result: store.get(command[1]) ?? null }), { status: 200 })
    }
    return new Response(JSON.stringify({ error: 'unsupported' }), { status: 400 })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const cache = new RedisRestCache({ url: 'https://redis.example', token: 'secret', prefix: 'test:', timeoutMs: 100 })
  const entry = { body: Buffer.from('{"ok":true}'), gzipped: Buffer.from('gzip-data'), etag: '"abc"' }
  assert.equal(await cache.set('/api/demo?a=1', entry, 45), true)
  const restored = await cache.get('/api/demo?a=1')
  assert.equal(restored.body.toString(), entry.body.toString())
  assert.equal(restored.gzipped.toString(), entry.gzipped.toString())
  assert.equal(restored.etag, entry.etag)
  assert.equal(commands[0][0], 'SET')
  assert.equal(commands[0][3], 'EX')
  assert.equal(commands[0][4], 45)
  assert.match(commands[0][1], /^test:[a-f0-9]{64}$/)
})

test('Redis REST cache fails open when Redis is unavailable or payload is malformed', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  globalThis.fetch = async () => { throw new Error('offline') }
  const cache = new RedisRestCache({ url: 'https://redis.example', token: 'secret' })
  assert.equal(await cache.get('/api/offline'), null)
  assert.equal(await cache.set('/api/offline', { body: Buffer.from('x'), etag: '"x"' }, 10), false)

  globalThis.fetch = async () => new Response(JSON.stringify({ result: '{bad json' }), { status: 200 })
  assert.equal(await cache.get('/api/bad'), null)
})

test('Redis REST cache disables itself when credentials are absent', async () => {
  const cache = new RedisRestCache({ url: '', token: '' })
  assert.equal(cache.enabled, false)
  assert.equal(await cache.get('/api/anything'), null)
})

test('Redis REST rate limiter shares atomic fixed-window counts across instances', async t => {
  const originalFetch = globalThis.fetch
  const store = new Map()
  globalThis.fetch = async (_url, options) => {
    const command = JSON.parse(options.body)
    if (command[0] !== 'EVAL') return new Response(JSON.stringify({ error: 'unsupported' }), { status: 400 })
    const key = command[3]
    const current = (store.get(key) || 0) + 1
    store.set(key, current)
    return new Response(JSON.stringify({ result: [current, 30_000] }), { status: 200 })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const a = new RedisRestCache({ url: 'https://redis.example', token: 'secret', prefix: 'test:' })
  const b = new RedisRestCache({ url: 'https://redis.example', token: 'secret', prefix: 'test:' })
  const first = await a.consumeRateLimit('user-123', { max: 2, windowMs: 60_000 }, 'community:write')
  const second = await b.consumeRateLimit('user-123', { max: 2, windowMs: 60_000 }, 'community:write')
  const third = await a.consumeRateLimit('user-123', { max: 2, windowMs: 60_000 }, 'community:write')
  assert.equal(first.ok, true)
  assert.equal(second.remaining, 0)
  assert.equal(third.ok, false)
  assert.equal(third.retryAfter, 30)
})


test('hybrid limiter uses shared Redis counts and bounded local fallback on Redis failure', async t => {
  const originalFetch = globalThis.fetch
  const counts = new Map()
  let fail = false
  globalThis.fetch = async (_url, options) => {
    if (fail) throw new Error('redis offline')
    const command = JSON.parse(options.body)
    const key = command[3]
    const count = (counts.get(key) || 0) + 1
    counts.set(key, count)
    return new Response(JSON.stringify({ result: [count, 5000] }), { status: 200 })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  const shared = new RedisRestCache({ url: 'https://redis.example', token: 'secret' })
  const a = createHybridRateLimiter({ max: 1, windowMs: 5000, sharedCache: shared, namespace: 'test' })
  const b = createHybridRateLimiter({ max: 1, windowMs: 5000, sharedCache: shared, namespace: 'test' })
  assert.equal((await a.check('same-user')).ok, true)
  assert.equal((await b.check('same-user')).ok, false)
  fail = true
  assert.equal((await a.check('fallback-user')).ok, true)
  assert.equal((await a.check('fallback-user')).ok, false)
  a.close(); b.close()
})
