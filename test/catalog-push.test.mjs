import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createSign } from 'node:crypto'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createCommunity } from '../src/community/index.js'
import { createChapterAlerts, topicOf } from '../src/community/push.js'
import { createFcm } from '../src/lib/fcm.js'
import { quiet, listen, makeRegistry, PNG } from './helpers.mjs'
import { fakeDb } from './fake-mongo.mjs'

const CLIENT_ID = 'test-client.apps.googleusercontent.com'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const mint = (sub, email) => {
  const sec = Math.floor(Date.now() / 1000)
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const body = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: sub, picture: '', iat: sec, exp: sec + 3600 })
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')}`
}
const cfg = loadConfig({ LOG_REQUESTS: 'false', MONGODB_URI: 'x', GOOGLE_CLIENT_ID: CLIENT_ID, AUTH_SECRET: 'x'.repeat(40), OWNER_EMAILS: 'owner@example.com' }).community
const sent = []
const fcm = { enabled: true, send: async (target, data) => (sent.push({ target, data }), (target.token === 'gone-token-aaaaaaaaaaaaaaaaaaaa' ? { ok: false, gone: true } : { ok: true })) }
let srv, app, community, registry

const call = async (method, path, { token, body, headers } = {}) => {
  const res = await fetch(`${srv.url}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: res.status, ...(await res.json()) }
}
const login = async (sub, email) => (await call('POST', '/api/community/auth/google', { body: { idToken: mint(sub, email) } })).data

before(async () => {
  community = await createCommunity(cfg, { db: fakeDb(), fetchJwks: async () => ({ keys: [jwk], maxAge: 3600 }), logger: quiet, fcm, limits: { write: { max: 100000 }, login: { max: 100000 } } })
  registry = makeRegistry(0)
  app = createApp({ registry, config: loadConfig({ LOG_REQUESTS: 'false', RATE_LIMIT_MAX: '100000' }), logger: quiet, community })
  srv = await listen(app.handler)
})
after(async () => {
  srv.server.close()
  app.close()
  await community.close()
})

test('push: token terdaftar, pengumuman dikirim ke semua HP, token mati dibuang', async () => {
  const owner = await login('o1', 'owner@example.com')
  assert.equal((await call('PUT', '/api/community/push-token', { body: { token: 'short' } })).status, 400)
  assert.equal((await call('PUT', '/api/community/push-token', { body: { token: 'live-token-aaaaaaaaaaaaaaaaaaaaa' } })).status, 200)
  assert.equal((await call('PUT', '/api/community/push-token', { body: { token: 'gone-token-aaaaaaaaaaaaaaaaaaaa' } })).status, 200)
  assert.equal((await call('PUT', '/api/community/push-token', { body: { token: 'live-token-bbbbbbbbbbbbbbbbbbbbb', previous: 'live-token-aaaaaaaaaaaaaaaaaaaaa' } })).status, 200)
  sent.length = 0
  const r = await call('POST', '/api/community/admin/broadcasts', { token: owner.token, body: { title: 'Halo', body: 'Pengumuman' } })
  assert.equal(r.status, 200)
  await new Promise(res => setTimeout(res, 50))
  assert.deepEqual(sent.map(s => s.target.token).sort(), ['gone-token-aaaaaaaaaaaaaaaaaaaa', 'live-token-bbbbbbbbbbbbbbbbbbbbb'])
  assert.equal(sent[0].data.type, 'broadcast')
  assert.equal(await community.c.pushTokens.findOne({ _id: 'gone-token-aaaaaaaaaaaaaaaaaaaa' }), null)
  assert.equal((await call('POST', '/api/community/push-token/unregister', { body: { token: 'live-token-bbbbbbbbbbbbbbbbbbbbb' } })).status, 200)
  assert.equal(await community.c.pushTokens.findOne({ _id: 'live-token-bbbbbbbbbbbbbbbbbbbbb' }), null)
})

test('push: chapter baru dikirim ke topik komik, pengamatan pertama hanya mencatat', async () => {
  const out = []
  const alerts = createChapterAlerts({ fcm: { enabled: true, send: async (t, d) => (out.push({ t, d }), { ok: true }) }, logger: quiet })
  const item = n => ({ slug: 'solo', title: 'Solo', chapters: [{ slug: `c${n}`, number: String(n) }] })
  assert.equal(await alerts.observe('mock', [item(1)]), 0)
  assert.equal(await alerts.observe('mock', [item(1)]), 0)
  assert.equal(await alerts.observe('mock', [item(2)]), 1)
  assert.equal(out[0].t.topic, topicOf('mock', 'solo'))
  assert.equal(out[0].d.type, 'chapter')
  assert.equal(out[0].d.chapter, '2')
  assert.match(topicOf('a', 'b'), /^c_[0-9a-f]{24}$/)
})

test('fcm: tanpa akun layanan dinonaktifkan', async () => {
  assert.equal(createFcm({ serviceAccount: '' }).enabled, false)
  assert.equal(createFcm({ serviceAccount: 'bukan json' }).enabled, false)
})

test('katalog: edit komik OWNER tampil di detail & daftar, bisa dikembalikan', async () => {
  const user = await login('u1', 'u1@example.com')
  const owner = await login('o2', 'owner@example.com')
  const body = { title: 'Judul Baru', cover: '', synopsis: 'Sinopsis', genres: ['action', 'drama'], type: 'manga', status: 'completed', author: 'A', artist: 'B' }
  assert.equal((await call('PUT', '/api/community/admin/comics/mock/komik-1', { token: user.token, body })).status, 403)
  assert.equal((await call('PUT', '/api/community/admin/comics/mock/komik-1', { token: owner.token, body: { ...body, type: 'novel' } })).status, 400)
  const before = await call('GET', '/api/mock/comic/komik-1')
  assert.equal(before.data.title, 'komik-1')
  const saved = await call('PUT', '/api/community/admin/comics/mock/komik-1', { token: owner.token, body })
  assert.equal(saved.status, 200, JSON.stringify(saved))
  assert.equal(saved.data.edited, true)
  assert.deepEqual(saved.data.genres, ['Action', 'Drama'])
  const after = await call('GET', '/api/mock/comic/komik-1')
  assert.equal(after.data.title, 'Judul Baru')
  assert.equal(after.data.type, 'manga')
  const latest = await call('GET', '/api/mock/latest')
  assert.equal(latest.data.items.find(i => i.slug === 'komik-1')?.title, 'Judul Baru')
  const reset = await call('DELETE', '/api/community/admin/comics/mock/komik-1/override', { token: owner.token })
  assert.equal(reset.data.edited, false)
  assert.equal((await call('GET', '/api/mock/comic/komik-1')).data.title, 'komik-1')
})

test('katalog: gambar chapter diganti, diurutkan, dan dikembalikan ke sumber', async () => {
  const owner = await login('o3', 'owner@example.com')
  const url = '/api/community/admin/comics/mock/komik-2/chapters/1/pages'
  const orig = await call('GET', url, { token: owner.token })
  assert.equal(orig.data.edited, false)
  assert.equal(orig.data.pages.length, 1)
  assert.equal((await call('PUT', url, { token: owner.token, body: { pages: [] } })).status, 400)
  assert.equal((await call('PUT', url, { token: owner.token, body: { pages: ['javascript:alert(1)'] } })).status, 400)
  const pages = ['https://cdn.example.com/b.jpg', '/media/0123456789abcdef01234567']
  assert.equal((await call('PUT', url, { token: owner.token, body: { pages } })).data.edited, true)
  const pub = await call('GET', '/api/mock/chapter/komik-2/1')
  assert.deepEqual(pub.data.images, pages)
  assert.equal(pub.data.proxy[1], '/media/0123456789abcdef01234567')
  assert.match(pub.data.proxy[0], /^\/api\/image\?url=/)
  const admin = await call('GET', '/api/community/admin/comics/mock/komik-2', { token: owner.token })
  assert.equal(admin.data.chapters[0].edited, true)
  assert.equal((await call('DELETE', url, { token: owner.token })).data.edited, false)
  assert.equal((await call('GET', '/api/mock/chapter/komik-2/1')).data.images.length, 1)
})

test('katalog: unggah gambar multipart lalu sajikan lewat /media/:id', async () => {
  const owner = await login('o4', 'owner@example.com')
  const user = await login('u2', 'u2@example.com')
  const form = bytes => {
    const f = new FormData()
    f.append('file', new Blob([bytes], { type: 'image/png' }), 'a.png')
    return f
  }
  const up = (token, bytes) => fetch(`${srv.url}/api/community/admin/media`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form(bytes) }).then(async r => ({ status: r.status, ...(await r.json()) }))
  assert.equal((await up(user.token, PNG)).status, 403)
  assert.equal((await up(owner.token, Buffer.from('bukan gambar'))).status, 400)
  const ok = await up(owner.token, PNG)
  assert.equal(ok.status, 200, JSON.stringify(ok))
  assert.match(ok.data.url, /^\/media\/[0-9a-f]{24}$/)
  const got = await fetch(`${srv.url}${ok.data.url}`)
  assert.equal(got.status, 200)
  assert.equal(got.headers.get('content-type'), 'image/png')
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), PNG)
  assert.equal((await fetch(`${srv.url}/media/ffffffffffffffffffffffff`)).status, 404)
})

test('views: dihitung sekali per pengguna/perangkat dalam jendela dedupe, tampil di detail', async () => {
  const h = { 'x-device-id': 'dev-1' }
  const a = await call('POST', '/api/community/views/comic', { body: { source: 'mock', slug: 'komik-3' }, headers: h })
  const b = await call('POST', '/api/community/views/comic', { body: { source: 'mock', slug: 'komik-3' }, headers: h })
  const c = await call('POST', '/api/community/views/comic', { body: { source: 'mock', slug: 'komik-3' }, headers: { 'x-device-id': 'dev-2' } })
  assert.deepEqual([a.data.viewCount, b.data.viewCount, c.data.viewCount], [1, 1, 2])
  await call('POST', '/api/community/views/chapter', { body: { source: 'mock', comic: 'komik-3', chapter: '1' }, headers: h })
  const detail = await call('GET', '/api/mock/comic/komik-3')
  assert.equal(detail.data.viewCount, 2)
  assert.equal(detail.data.chapters[0].viewCount, 1)
  assert.equal((await call('POST', '/api/community/views/comic', { body: { source: 'mock' } })).status, 400)
})
