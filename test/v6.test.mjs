import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createSign } from 'node:crypto'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createCommunity } from '../src/community/index.js'
import { ensureIndexes } from '../src/community/db.js'
import { PNG, quiet, listen, makeRegistry } from './helpers.mjs'
import { fakeDb } from './fake-mongo.mjs'

const CLIENT_ID = 'v6.apps.googleusercontent.com'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const mint = (sub, email) => {
  const sec = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const body = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: `N ${sub}`, picture: 'https://lh3.googleusercontent.com/x', iat: sec, exp: sec + 3600 })
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')}`
}
const huge = { max: 100000 }
let img, srv, app, community, imgHits = 0

before(async () => {
  img = await listen((req, res) => {
    imgHits++
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
    res.end(PNG)
  })
  community = await createCommunity(
    loadConfig({ LOG_REQUESTS: 'false', MONGODB_URI: 'x', GOOGLE_CLIENT_ID: CLIENT_ID, AUTH_SECRET: 'x'.repeat(40) }).community,
    { db: fakeDb(), fetchJwks: async () => ({ keys: [jwk], maxAge: 3600 }), logger: quiet, limits: { commentBurst: huge, commentHour: huge, write: huge, like: huge, report: huge, login: huge, readTime: huge } }
  )
  app = createApp({ registry: makeRegistry(img.port), config: loadConfig({ LOG_REQUESTS: 'false', RATE_LIMIT_MAX: '100000' }), logger: quiet, community })
  srv = await listen(app.handler)
})
after(async () => {
  srv.server.close()
  img.server.close()
  app.close()
  await community.close()
})

const call = async (method, path, { token, body, headers } = {}) => {
  const res = await fetch(`${srv.url}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  return { status: res.status, headers: res.headers, ...(text ? { json: (() => { try { return JSON.parse(text) } catch { return null } })() } : {}) }
}
const login = async sub => (await call('POST', '/api/community/auth/google', { body: { idToken: mint(sub, `${sub}@example.com`) } })).json.data

test('ensureIndexes: konflik opsi dengan indeks setara yang sudah ada tidak dicatat sebagai error', async () => {
  const errors = []
  const conflict = Object.assign(new Error('An existing index has the same name'), { code: 85 })
  const col = { createIndex: async () => { throw conflict }, indexes: async () => [{ key: { banned: 1 }, name: 'banned_1' }] }
  const other = { createIndex: async () => { throw conflict }, indexes: async () => [] }
  const c = new Proxy({}, { get: (_, k) => (k === 'users' ? col : other) })
  await ensureIndexes(c, { error: m => errors.push(m) })
  assert.ok(!errors.some(m => m.includes('"banned":1')), 'indeks banned setara tidak dilaporkan')
  assert.ok(errors.length > 0, 'konflik tanpa indeks setara tetap dilaporkan')
})

test('avatar: URL berversi, ETag/304, immutable, dan foto baru langsung berganti', async () => {
  const u = await login('av1')
  const img1 = `data:image/png;base64,${PNG.toString('base64')}`
  const put = await call('PUT', '/api/community/me/avatar', { token: u.token, body: { image: img1 } })
  const url = put.json.data.user.picture
  assert.match(url, /\/avatar\?v=\d+$/)
  const a = await fetch(`${srv.url}${url}`)
  assert.equal(a.status, 200)
  assert.match(a.headers.get('cache-control'), /immutable/)
  const etag = a.headers.get('etag')
  const b = await fetch(`${srv.url}${url}`, { headers: { 'if-none-match': etag } })
  assert.equal(b.status, 304)
  await new Promise(r => setTimeout(r, 3))
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 7)])
  const put2 = await call('PUT', '/api/community/me/avatar', { token: u.token, body: { image: `data:image/jpeg;base64,${jpeg.toString('base64')}` } })
  assert.notEqual(put2.json.data.user.picture, url)
  const c = await fetch(`${srv.url}${put2.json.data.user.picture}`)
  assert.equal(c.headers.get('content-type'), 'image/jpeg')
  assert.equal(Buffer.from(await c.arrayBuffer()).length, jpeg.length)
})

test('komentar: clientId yang sama tidak menggandakan komentar', async () => {
  const u = await login('cid1')
  const body = { type: 'comic', source: 'mock', slug: 'komik-1', body: 'Ceritanya bagus banget sih', clientId: 'cli-abcdef123456' }
  const a = await call('POST', '/api/community/comments', { token: u.token, body })
  const b = await call('POST', '/api/community/comments', { token: u.token, body })
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.equal(a.json.data.comment.id, b.json.data.comment.id)
  assert.equal(b.json.data.xpGained, 0)
  const list = await call('GET', '/api/community/comments?type=comic&source=mock&slug=komik-1')
  assert.equal(list.json.data.total, 1)
})

test('like komentar: hitungan benar saat like, like ulang, dan unlike', async () => {
  const a = await login('lk-a')
  const b = await login('lk-b')
  const c = await call('POST', '/api/community/comments', { token: a.token, body: { type: 'comic', source: 'mock', slug: 'komik-2', body: 'Komentar untuk di-like ya' } })
  const id = c.json.data.comment.id
  assert.equal((await call('PUT', `/api/community/comments/${id}/like`, { token: b.token })).json.data.likeCount, 1)
  assert.equal((await call('PUT', `/api/community/comments/${id}/like`, { token: b.token })).json.data.likeCount, 1)
  assert.equal((await call('DELETE', `/api/community/comments/${id}/like`, { token: b.token })).json.data.likeCount, 0)
  assert.equal((await call('DELETE', `/api/community/comments/${id}/like`, { token: b.token })).json.data.likeCount, 0)
})

test('header cache: publik SWR, personal private+ETag, tulis no-store', async () => {
  const pub = await call('GET', '/api/mock/genres')
  assert.match(pub.headers.get('cache-control'), /public, max-age=3600, stale-while-revalidate=3600/)
  const u = await login('hdr1')
  const m = await call('GET', '/api/community/me', { token: u.token })
  assert.equal(m.headers.get('cache-control'), 'private, no-cache')
  assert.match(m.headers.get('vary'), /Authorization/)
  const again = await call('GET', '/api/community/me', { token: u.token, headers: { 'if-none-match': m.headers.get('etag') } })
  assert.equal(again.status, 304)
  const w = await call('PATCH', '/api/community/me', { token: u.token, body: { name: 'Nama Baru' } })
  assert.equal(w.headers.get('cache-control'), 'no-store')
})

test('image proxy: gambar kecil dilayani dari memori pada request kedua', async () => {
  imgHits = 0
  const url = `${srv.url}/api/image?url=${encodeURIComponent(`http://127.0.0.1:${img.port}/img/cache-me.png`)}`
  const a = await fetch(url)
  assert.equal(a.status, 200)
  assert.equal(Buffer.from(await a.arrayBuffer()).length, PNG.length)
  const b = await fetch(url)
  assert.equal(b.headers.get('x-cache'), 'HIT')
  assert.equal(Buffer.from(await b.arrayBuffer()).length, PNG.length)
  assert.equal(imgHits, 1, 'upstream hanya dipanggil sekali')
  const bad = await fetch(`${srv.url}/api/image?url=${encodeURIComponent('http://evil.example/x.png')}`)
  assert.equal(bad.status, 403)
})

test('preload: chapter berikutnya dimuat di background saat chapter ini diambil', async () => {
  const reg = makeRegistry(img.port)
  const seen = []
  const orig = reg.provider.chapter.bind(reg.provider)
  reg.provider.chapter = async (slug, ch) => (seen.push(ch), { ...(await orig(slug, ch)), next: ch === '1' ? '2' : null })
  const a2 = createApp({ registry: reg, config: loadConfig({ LOG_REQUESTS: 'false' }), logger: quiet })
  const s2 = await listen(a2.handler)
  try {
    assert.equal((await fetch(`${s2.url}/api/mock/chapter/preload-x/1`)).status, 200)
    await new Promise(r => setTimeout(r, 30))
    assert.deepEqual(seen, ['1', '2'])
    const r = await fetch(`${s2.url}/api/mock/chapter/preload-x/2`)
    assert.equal(r.headers.get('x-cache'), 'HIT')
    assert.deepEqual(seen, ['1', '2'], 'chapter 2 tidak diambil ulang dari sumber')
  } finally {
    s2.server.close()
    a2.close()
  }
})
