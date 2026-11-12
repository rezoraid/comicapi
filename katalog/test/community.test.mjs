import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createSign } from 'node:crypto'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createCommunity } from '../src/community/index.js'
import { createGoogleVerifier } from '../src/community/google.js'
import { createTokens } from '../src/community/tokens.js'
import { newId } from '../src/community/util.js'
import { levelFromXp, xpForLevel, isQuality } from '../src/community/xp.js'
import { quiet, listen, makeRegistry } from './helpers.mjs'
import { fakeDb } from './fake-mongo.mjs'

const CLIENT_ID = 'test-client.apps.googleusercontent.com'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const clock = { t: Date.now() }
const now = () => clock.t
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')

const mint = (sub, email, over = {}, { kid = 'k1', key = privateKey } = {}) => {
  const sec = Math.floor(clock.t / 1000)
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' })
  const body = b64({
    iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true,
    name: `Nama ${sub}`, picture: `https://lh3.googleusercontent.com/${sub}`, iat: sec, exp: sec + 3600, ...over
  })
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url')
  return `${head}.${body}.${sig}`
}

const cfg = () => loadConfig({
  LOG_REQUESTS: 'false', MONGODB_URI: 'x', GOOGLE_CLIENT_ID: CLIENT_ID, AUTH_SECRET: 'x'.repeat(40),
  OWNER_EMAILS: 'owner@example.com', MODERATOR_EMAILS: 'dev@example.com'
}).community

const fcm = { calls: [], dead: new Set(), fail: false }
const fakeMessaging = {
  async sendEachForMulticast(m) {
    if (fcm.fail) throw new Error('fcm down')
    fcm.calls.push(m)
    return { responses: m.tokens.map(t => (fcm.dead.has(t) ? { success: false, error: { code: 'messaging/registration-token-not-registered' } } : { success: true })) }
  }
}
const tok = n => `tok${String(n).padStart(4, '0')}:APA91b${'x'.repeat(40)}`

let jwksCalls = 0
const fetchJwks = async () => (jwksCalls++, { keys: [jwk], maxAge: 3600 })
let env, srv, app, community

const call = async (method, path, { token, body, headers } = {}) => {
  const res = await fetch(`${srv.url}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  })
  const json = await res.json()
  return { status: res.status, ...json }
}
const login = async (sub, email) => {
  const r = await call('POST', '/api/community/auth/google', { body: { idToken: mint(sub, email) } })
  assert.equal(r.status, 200, JSON.stringify(r))
  return { token: r.data.token, user: r.data.user }
}
const comic = { type: 'comic', source: 'mock', slug: 'solo-leveling' }
const chap = { type: 'chapter', source: 'mock', slug: 'solo-leveling', chapter: '12' }
const post = (token, extra) => call('POST', '/api/community/comments', { token, body: extra })
const list = (q, token) => call('GET', `/api/community/comments?${new URLSearchParams(q)}`, { token })
const me = token => call('GET', '/api/community/me', { token }).then(r => r.data.user)

before(async () => {
  env = { db: fakeDb() }
  community = await createCommunity(cfg(), { db: env.db, messaging: fakeMessaging, fetchJwks, now, logger: quiet, limits: { commentBurst: { max: 1000 }, commentHour: { max: 1000 }, write: { max: 1000 }, like: { max: 1000 }, report: { max: 1000 }, login: { max: 10000 }, readTime: { max: 100000 } } })
  app = createApp({ registry: makeRegistry(0), config: loadConfig({ LOG_REQUESTS: 'false', RATE_LIMIT_MAX: '100000' }), logger: quiet, community })
  srv = await listen(app.handler)
})
after(async () => {
  srv.server.close()
  app.close()
  await community.close()
})

test('level & XP: kurva, batas, kualitas teks', () => {
  assert.equal(levelFromXp(0), 1)
  assert.equal(levelFromXp(49), 1)
  assert.equal(levelFromXp(50), 2)
  assert.equal(levelFromXp(149), 2)
  assert.equal(levelFromXp(150), 3)
  assert.equal(levelFromXp(-20), 1)
  assert.equal(levelFromXp(10_000_000), 100)
  for (let l = 1; l < 50; l++) assert.equal(levelFromXp(xpForLevel(l)), l)
  assert.equal(isQuality('Ceritanya bagus banget'), true)
  assert.equal(isQuality('wkwkwk'), false)
  assert.equal(isQuality('aaaaaaaaaaaa bbbb'), false)
  assert.equal(isQuality('bagus'), false)
})

test('token sesi: tanda tangan, kedaluwarsa, rusak', () => {
  const t = createTokens({ secret: 's'.repeat(40), ttlDays: 1, now })
  const tok = t.sign('abc')
  assert.equal(t.verify(tok).sub, 'abc')
  assert.equal(t.verify(tok.slice(0, -2) + 'xx'), null)
  assert.equal(t.verify('v1.' + Buffer.from('{"sub":"x","exp":9999999999}').toString('base64url') + '.zzz'), null)
  assert.equal(createTokens({ secret: 'lain'.repeat(10), ttlDays: 1, now }).verify(tok), null)
  const old = clock.t
  clock.t += 2 * 86_400_000
  assert.equal(t.verify(tok), null)
  clock.t = old
  assert.equal(t.verify(''), null)
  assert.equal(t.verify(null), null)
})

test('verifikasi ID token Google: valid dan semua penolakan', async () => {
  const g = createGoogleVerifier({ clientIds: [CLIENT_ID], fetchJwks, now })
  const ok = await g.verify(mint('s1', 'A@Example.com'))
  assert.deepEqual([ok.sub, ok.email], ['s1', 'a@example.com'])
  const bad = async tok => assert.rejects(g.verify(tok), e => e.status === 401 && e.code === 'INVALID_GOOGLE_TOKEN')
  await bad(mint('s1', 'a@example.com', { aud: 'client-lain' }))
  await bad(mint('s1', 'a@example.com', { iss: 'https://evil.example' }))
  await bad(mint('s1', 'a@example.com', { exp: Math.floor(clock.t / 1000) - 600 }))
  await bad(mint('s1', 'a@example.com', { email_verified: false }))
  await bad(mint('s1', 'a@example.com', {}, { key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey }))
  await bad(mint('s1', 'a@example.com', {}, { kid: 'tidak-ada' }))
  await bad('bukan.jwt')
  await bad(undefined)
  await bad({ $ne: null })
  const none = `${b64({ alg: 'none', kid: 'k1' })}.${b64({ iss: 'accounts.google.com', aud: CLIENT_ID, sub: 'x', exp: 9999999999, email: 'a@b.c', email_verified: true })}.`
  await bad(none)
})

test('JWKS di-cache dan tidak di-fetch ulang untuk kid asing terus-menerus', async () => {
  jwksCalls = 0
  const g = createGoogleVerifier({ clientIds: [CLIENT_ID], fetchJwks, now })
  await g.verify(mint('s1', 'a@example.com'))
  await g.verify(mint('s2', 'b@example.com'))
  assert.equal(jwksCalls, 1)
  for (let i = 0; i < 5; i++) await assert.rejects(g.verify(mint('s1', 'a@example.com', {}, { kid: 'x' })))
  assert.ok(jwksCalls <= 2)
})

test('komunitas nonaktif → 503 tanpa merusak endpoint lama', async () => {
  const a = createApp({ registry: makeRegistry(0), config: loadConfig({ LOG_REQUESTS: 'false' }), logger: quiet, community: null })
  const s = await listen(a.handler)
  const r = await fetch(`${s.url}/api/community/me`)
  assert.equal(r.status, 503)
  assert.equal((await r.json()).error.code, 'COMMUNITY_DISABLED')
  assert.equal((await fetch(`${s.url}/api/mock/search?q=a`)).status, 200)
  s.server.close()
  a.close()
})

test('config env tidak lengkap → createCommunity mengembalikan null', async () => {
  assert.equal(await createCommunity(loadConfig({ MONGODB_URI: 'x' }).community, { logger: quiet }), null)
  assert.equal(await createCommunity(loadConfig({}).community, { logger: quiet }), null)
})

test('login Google: akun dibuat permanen, identitas konsisten, role dari env', async () => {
  const a = await login('g-alice', 'alice@example.com')
  assert.equal(a.user.username, 'alice')
  assert.equal(a.user.role, 'USER')
  assert.equal(a.user.level, 1)
  assert.match(a.user.picture, /googleusercontent\.com/)
  const again = await login('g-alice', 'alice@example.com')
  assert.equal(again.user.id, a.user.id)
  assert.equal(again.user.username, 'alice')
  assert.equal((await login('g-alice2', 'alice@other.com')).user.username.startsWith('alice'), true)
  assert.notEqual((await login('g-alice3', 'alice@third.com')).user.username, 'alice')
  assert.equal((await login('g-owner', 'owner@example.com')).user.role, 'OWNER')
  assert.equal((await login('g-dev', 'dev@example.com')).user.role, 'MODERATOR')
  assert.equal(env.db.collection('users').docs.filter(u => u.googleSub === 'g-alice').length, 1)
})

test('login: input jahat ditolak (NoSQL injection, token palsu)', async () => {
  for (const idToken of [{ $ne: null }, ['a'], 123, null, '', 'a.b.c']) {
    const r = await call('POST', '/api/community/auth/google', { body: { idToken } })
    assert.equal(r.status, 401)
  }
  assert.equal((await call('POST', '/api/community/auth/google', { body: '{rusak' })).status, 400)
  assert.equal((await call('POST', '/api/community/auth/google', { body: '[]' })).status, 400)
})

test('auth: endpoint butuh token valid', async () => {
  assert.equal((await call('GET', '/api/community/me')).status, 401)
  assert.equal((await call('GET', '/api/community/me', { token: 'v1.abc.def' })).status, 401)
  assert.equal((await call('POST', '/api/community/comments', { body: { ...comic, body: 'halo dunia' } })).status, 401)
  const { token } = await login('g-bob', 'bob@example.com')
  assert.equal((await call('GET', '/api/community/me', { token })).data.user.username, 'bob')
})

test('komentar: buat, daftar terpisah comic vs chapter, validasi', async () => {
  const { token, user } = await login('g-c1', 'c1@example.com')
  const r = await post(token, { ...comic, body: '  Komiknya seru banget!  ' })
  assert.equal(r.status, 200)
  assert.equal(r.data.comment.body, 'Komiknya seru banget!')
  assert.equal(r.data.comment.user.id, user.id)
  assert.equal(r.data.comment.canDelete, true)
  assert.equal(r.data.comment.canEdit, true)
  const r2 = await post(token, { ...chap, body: 'Chapter ini bikin merinding' })
  assert.equal(r2.status, 200)
  const lc = await list({ type: 'comic', source: 'mock', slug: 'solo-leveling' })
  const lh = await list({ type: 'chapter', source: 'mock', slug: 'solo-leveling', chapter: '12' })
  const lo = await list({ type: 'chapter', source: 'mock', slug: 'solo-leveling', chapter: '13' })
  assert.deepEqual(lc.data.items.map(x => x.id), [r.data.comment.id])
  assert.deepEqual(lh.data.items.map(x => x.id), [r2.data.comment.id])
  assert.equal(lo.data.items.length, 0)
  assert.equal(lc.data.items[0].canEdit, false)
  assert.equal((await post(token, { ...comic, body: '' })).status, 400)
  assert.equal((await post(token, { ...comic, body: 'x'.repeat(1001) })).status, 400)
  assert.equal((await post(token, { ...comic, body: 12345 })).status, 400)
  assert.equal((await post(token, { ...comic, body: { $gt: '' } })).status, 400)
  assert.equal((await post(token, { ...comic, source: 'tidak-ada', body: 'halo semua' })).status, 400)
  assert.equal((await post(token, { ...comic, slug: '../../etc', body: 'halo semua' })).status, 400)
  assert.equal((await post(token, { type: 'chapter', source: 'mock', slug: 'a', body: 'halo semua' })).status, 400)
  assert.equal((await post(token, { ...comic, parentId: { $ne: null }, body: 'halo semua' })).status, 400)
  assert.equal((await list({ type: 'comic', source: 'mock' })).status, 400)
})

test('balasan: satu level, replyTo, hitungan, daftar balasan', async () => {
  const a = await login('g-r1', 'r1@example.com')
  const b = await login('g-r2', 'r2@example.com')
  const root = (await post(a.token, { ...comic, slug: 'reply-test', body: 'Komentar utama di sini' })).data.comment
  const r1 = (await post(b.token, { parentId: root.id, body: 'Balasan pertama dari b' })).data.comment
  assert.equal(r1.parentId, root.id)
  assert.equal(r1.replyTo, null)
  const r2 = (await post(a.token, { parentId: r1.id, body: 'Balas balasannya lagi ya' })).data.comment
  assert.equal(r2.parentId, root.id)
  assert.equal(r2.replyTo, b.user.username)
  assert.equal(r2.slug, 'reply-test')
  const l = await list({ ...comic, slug: 'reply-test' })
  assert.equal(l.data.items.length, 1)
  assert.equal(l.data.items[0].replyCount, 2)
  assert.equal(l.data.total, 3)
  const rep = await call('GET', `/api/community/comments/${root.id}/replies`)
  assert.deepEqual(rep.data.items.map(x => x.id), [r1.id, r2.id])
  assert.equal((await post(a.token, { parentId: 'f'.repeat(24), body: 'balas yang tidak ada' })).status, 404)
})

test('like: idempotent, toggle, flag liked per viewer', async () => {
  const a = await login('g-l1', 'l1@example.com')
  const b = await login('g-l2', 'l2@example.com')
  const c = (await post(a.token, { ...comic, slug: 'like-test', body: 'Komentar untuk di-like' })).data.comment
  const put = () => call('PUT', `/api/community/comments/${c.id}/like`, { token: b.token })
  assert.deepEqual((await put()).data, { liked: true, likeCount: 1 })
  assert.deepEqual((await put()).data, { liked: true, likeCount: 1 })
  const asB = await list({ ...comic, slug: 'like-test' }, b.token)
  const asA = await list({ ...comic, slug: 'like-test' }, a.token)
  assert.equal(asB.data.items[0].liked, true)
  assert.equal(asA.data.items[0].liked, false)
  assert.deepEqual((await call('DELETE', `/api/community/comments/${c.id}/like`, { token: b.token })).data, { liked: false, likeCount: 0 })
  assert.deepEqual((await call('DELETE', `/api/community/comments/${c.id}/like`, { token: b.token })).data, { liked: false, likeCount: 0 })
  assert.equal((await call('PUT', `/api/community/comments/${c.id}/like`)).status, 401)
})

test('edit & hapus: hanya pemilik; moderator sesuai rank', async () => {
  const a = await login('g-e1', 'e1@example.com')
  const b = await login('g-e2', 'e2@example.com')
  const dev = await login('g-dev', 'dev@example.com')
  const owner = await login('g-owner', 'owner@example.com')
  const c = (await post(a.token, { ...comic, slug: 'edit-test', body: 'Komentar asli saya' })).data.comment
  assert.equal((await call('PATCH', `/api/community/comments/${c.id}`, { token: b.token, body: { body: 'dibajak orang lain' } })).status, 403)
  assert.equal((await call('PATCH', `/api/community/comments/${c.id}`, { token: dev.token, body: { body: 'dibajak dev juga' } })).status, 403)
  const ed = await call('PATCH', `/api/community/comments/${c.id}`, { token: a.token, body: { body: 'Komentar sudah diedit' } })
  assert.equal(ed.status, 200)
  assert.equal(ed.data.comment.edited, true)
  const l = await list({ ...comic, slug: 'edit-test' })
  assert.equal(l.data.items[0].body, 'Komentar sudah diedit')
  assert.equal(l.data.items[0].edited, true)
  assert.equal((await call('DELETE', `/api/community/comments/${c.id}`, { token: b.token })).status, 403)
  const asDev = await list({ ...comic, slug: 'edit-test' }, dev.token)
  assert.equal(asDev.data.items[0].canDelete, true)
  assert.equal((await call('DELETE', `/api/community/comments/${c.id}`, { token: dev.token })).status, 200)
  assert.equal((await list({ ...comic, slug: 'edit-test' })).data.items.length, 0)
  assert.equal((await call('PATCH', `/api/community/comments/${c.id}`, { token: a.token, body: { body: 'edit setelah dihapus' } })).status, 404)
  assert.equal((await call('DELETE', `/api/community/comments/${c.id}`, { token: a.token })).status, 200)
  const oc = (await post(owner.token, { ...comic, slug: 'edit-test', body: 'Pengumuman dari owner' })).data.comment
  assert.equal((await call('DELETE', `/api/community/comments/${oc.id}`, { token: dev.token })).status, 403)
  assert.equal((await call('DELETE', `/api/community/comments/${oc.id}`, { token: b.token })).status, 403)
  assert.equal((await call('DELETE', `/api/community/comments/${oc.id}`, { token: owner.token })).status, 200)
})

test('hapus komentar induk yang punya balasan → placeholder, hilang setelah balasan habis', async () => {
  const a = await login('g-d1', 'd1@example.com')
  const b = await login('g-d2', 'd2@example.com')
  const root = (await post(a.token, { ...comic, slug: 'del-test', body: 'Komentar induk dihapus' })).data.comment
  const rep = (await post(b.token, { parentId: root.id, body: 'Balasan yang tersisa' })).data.comment
  await call('DELETE', `/api/community/comments/${root.id}`, { token: a.token })
  const l = await list({ ...comic, slug: 'del-test' })
  assert.equal(l.data.items.length, 1)
  assert.equal(l.data.items[0].deleted, true)
  assert.equal(l.data.items[0].body, '')
  assert.equal(l.data.items[0].replyCount, 1)
  assert.equal((await post(b.token, { parentId: root.id, body: 'balas yang sudah dihapus' })).status, 404)
  await call('DELETE', `/api/community/comments/${rep.id}`, { token: b.token })
  assert.equal((await list({ ...comic, slug: 'del-test' })).data.items.length, 0)
})

test('laporan: sekali per pengguna, tidak bisa lapor diri sendiri, validasi alasan', async () => {
  const a = await login('g-p1', 'p1@example.com')
  const b = await login('g-p2', 'p2@example.com')
  const c = (await post(a.token, { ...comic, slug: 'report-test', body: 'Komentar yang dilaporkan' })).data.comment
  const rep = (t, body) => call('POST', `/api/community/comments/${c.id}/report`, { token: t, body })
  assert.equal((await rep(a.token, { reason: 'spam' })).status, 400)
  assert.equal((await rep(b.token, { reason: 'bebas' })).status, 400)
  assert.equal((await rep(b.token, { reason: 'spam', note: 'iklan judi' })).status, 200)
  const again = await rep(b.token, { reason: 'abuse' })
  assert.equal(again.status, 409)
  assert.equal(again.error.code, 'ALREADY_REPORTED')
  assert.equal(env.db.collection('comments').docs.find(x => x._id === c.id).reportCount, 1)
  assert.equal((await rep(undefined, { reason: 'spam' })).status, 401)
})

test('moderasi laporan: hanya MODERATOR/OWNER; hapus komentar menutup semua laporan', async () => {
  const a = await login('g-m1', 'm1@example.com')
  const b = await login('g-m2', 'm2@example.com')
  const dev = await login('g-dev', 'dev@example.com')
  const c = (await post(a.token, { ...comic, slug: 'mod-test', body: 'Komentar bermasalah nih' })).data.comment
  await call('POST', `/api/community/comments/${c.id}/report`, { token: b.token, body: { reason: 'abuse' } })
  assert.equal((await call('GET', '/api/community/admin/reports', { token: b.token })).status, 403)
  const rs = await call('GET', '/api/community/admin/reports', { token: dev.token })
  assert.equal(rs.status, 200)
  const item = rs.data.items.find(x => x.comment?.id === c.id)
  assert.equal(item.reason, 'abuse')
  assert.equal(item.reporter.username, b.user.username)
  assert.equal((await call('POST', `/api/community/admin/reports/${item.id}/resolve`, { token: b.token, body: { action: 'delete' } })).status, 403)
  assert.equal((await call('POST', `/api/community/admin/reports/${item.id}/resolve`, { token: dev.token, body: { action: 'ngawur' } })).status, 400)
  assert.deepEqual((await call('POST', `/api/community/admin/reports/${item.id}/resolve`, { token: dev.token, body: { action: 'delete' } })).data, { ok: true, status: 'resolved' })
  assert.equal((await list({ ...comic, slug: 'mod-test' })).data.items.length, 0)
  assert.equal((await call('GET', '/api/community/admin/reports?status=open', { token: dev.token })).data.items.some(x => x.id === item.id), false)
})

test('role: tidak bisa ubah sendiri, hanya OWNER yang bisa, OWNER tidak bisa diberikan', async () => {
  const u = await login('g-ro1', 'ro1@example.com')
  const dev = await login('g-dev', 'dev@example.com')
  const owner = await login('g-owner', 'owner@example.com')
  const setRole = (t, id, role) => call('PUT', `/api/community/admin/users/${id}/role`, { token: t, body: { role } })
  assert.equal((await setRole(u.token, u.user.id, 'OWNER')).status, 403)
  assert.equal((await setRole(u.token, u.user.id, 'MODERATOR')).status, 403)
  assert.equal((await setRole(dev.token, u.user.id, 'MODERATOR')).status, 403)
  assert.equal((await setRole(owner.token, owner.user.id, 'USER')).status, 403)
  assert.equal((await setRole(owner.token, u.user.id, 'OWNER')).status, 400)
  assert.equal((await setRole(owner.token, u.user.id, 'ADMIN')).status, 400)
  assert.equal((await setRole(owner.token, u.user.id, 'DEV')).status, 400)
  assert.equal((await setRole(owner.token, u.user.id, 'PREMIUM')).status, 200)
  assert.equal((await me(u.token)).role, 'PREMIUM')
  assert.equal((await setRole(u.token, u.user.id, 'MODERATOR')).status, 403)
  assert.equal((await call('GET', '/api/community/admin/reports', { token: u.token })).status, 403)
  assert.equal((await setRole(owner.token, dev.user.id, 'USER')).status, 200)
  assert.equal((await me(dev.token)).role, 'USER')
  assert.equal((await login('g-dev', 'dev@example.com')).user.role, 'USER')
  assert.equal((await setRole(owner.token, u.user.id, 'MODERATOR')).status, 200)
  assert.equal((await me(u.token)).role, 'MODERATOR')
  assert.equal((await call('PATCH', '/api/community/me', { token: u.token, body: { username: 'ro1x', role: 'OWNER' } })).status, 200)
  assert.equal((await me(u.token)).role, 'MODERATOR')
  assert.equal((await setRole(owner.token, u.user.id, 'USER')).status, 200)
  const found = await call('GET', `/api/community/admin/users?username=ro1x`, { token: owner.token })
  assert.equal(found.data.user.id, u.user.id)
  assert.equal((await call('GET', `/api/community/admin/users?username=ro1x`, { token: u.token })).status, 403)
})

test('OWNER dari env tidak bisa dipegang akun lain; dicabut dari env → turun jadi USER', async () => {
  const c2 = await createCommunity({ ...cfg(), ownerEmails: ['lain@example.com'] }, { db: env.db, fetchJwks, now, logger: quiet, limits: { login: { max: 10000 }, readTime: { max: 100000 } } })
  const a2 = createApp({ registry: makeRegistry(0), config: loadConfig({ LOG_REQUESTS: 'false' }), logger: quiet, community: c2 })
  const s2 = await listen(a2.handler)
  const r = await fetch(`${s2.url}/api/community/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: mint('g-owner', 'owner@example.com') }) })
  assert.equal((await r.json()).data.user.role, 'USER')
  s2.server.close()
  a2.close()
  await c2.close()
  assert.equal((await login('g-owner', 'owner@example.com')).user.role, 'OWNER')
})

test('username: validasi, unik, cooldown, reserved', async () => {
  const a = await login('g-u1', 'u1@example.com')
  const b = await login('g-u2', 'u2@example.com')
  const patch = (t, username) => call('PATCH', '/api/community/me', { token: t, body: { username } })
  assert.equal((await patch(a.token, 'ab')).status, 400)
  assert.equal((await patch(a.token, '1abc')).status, 400)
  assert.equal((await patch(a.token, 'ada spasi')).status, 400)
  assert.equal((await patch(a.token, { $ne: 1 })).status, 400)
  assert.equal((await patch(a.token, 'admin')).status, 400)
  assert.equal((await patch(a.token, 'owner')).status, 400)
  assert.equal((await patch(b.token, 'Nama_Baru')).data.user.username, 'nama_baru')
  const dup = await patch(a.token, 'nama_baru')
  assert.equal(dup.status, 409)
  assert.equal(dup.error.code, 'USERNAME_TAKEN')
  assert.equal((await patch(a.token, 'u1_baru')).status, 200)
  assert.equal((await patch(a.token, 'u1_lagi')).status, 400)
  clock.t += 8 * 86_400_000
  assert.equal((await patch(a.token, 'u1_lagi')).status, 200)
  const c = (await post(a.token, { ...comic, slug: 'uname-test', body: 'Cek username konsisten' })).data.comment
  assert.equal((await list({ ...comic, slug: 'uname-test' })).data.items[0].user.username, 'u1_lagi')
  assert.equal(c.user.id, a.user.id)
})

test('akun diblokir tidak bisa memakai token lama dan tidak bisa login', async () => {
  const bad = await login('g-ban', 'ban@example.com')
  const dev = await login('g-dev2', 'dev@example.com')
  const owner = await login('g-owner', 'owner@example.com')
  const ban = (t, id, banned) => call('PUT', `/api/community/admin/users/${id}/ban`, { token: t, body: { banned } })
  assert.equal((await ban(bad.token, dev.user.id, true)).status, 403)
  assert.equal((await ban(dev.token, dev.user.id, true)).status, 403)
  assert.equal((await ban(dev.token, owner.user.id, true)).status, 403)
  assert.equal((await ban(dev.token, bad.user.id, 'ya')).status, 400)
  assert.equal((await ban(dev.token, bad.user.id, true)).status, 200)
  assert.equal((await call('GET', '/api/community/me', { token: bad.token })).status, 403)
  assert.equal((await post(bad.token, { ...comic, body: 'masih bisa komentar?' })).status, 403)
  assert.equal((await call('POST', '/api/community/auth/google', { body: { idToken: mint('g-ban', 'ban@example.com') } })).status, 403)
  assert.equal((await ban(dev.token, bad.user.id, false)).status, 200)
  assert.equal((await call('GET', '/api/community/me', { token: bad.token })).status, 200)
})

test('XP: komentar bermutu dapat XP, naik level, spam tidak', async () => {
  const a = await login('g-x1', 'x1@example.com')
  const p1 = await post(a.token, { ...comic, slug: 'xp-test', body: 'Alurnya mantap dan ilustrasinya rapi' })
  assert.equal(p1.data.xpGained, 5)
  assert.equal(p1.data.user.xp, 5)
  const lowq = await post(a.token, { ...comic, slug: 'xp-test', body: 'wkwkwkwk' })
  assert.equal(lowq.status, 200)
  assert.equal(lowq.data.xpGained, 0)
  const dup = await post(a.token, { ...comic, slug: 'xp-test', body: 'alurnya MANTAP dan  ilustrasinya rapi' })
  assert.equal(dup.status, 409)
  assert.equal(dup.error.code, 'DUPLICATE_COMMENT')
  assert.equal((await me(a.token)).xp, 5)
  const root = p1.data.comment
  const rp = await post(a.token, { parentId: root.id, body: 'Tambahan dari saya sendiri ya' })
  assert.equal(rp.data.xpGained, 3)
  assert.equal(rp.data.user.xp, 8)
})

test('XP: batas harian komentar, tidak bisa dimanipulasi dengan hapus-ulang', async () => {
  const a = await login('g-x2', 'x2@example.com')
  let total = 0
  for (let i = 0; i < 14; i++) total += (await post(a.token, { ...comic, slug: 'cap-test', body: `Komentar nomor ${i} yang cukup panjang` })).data.xpGained
  assert.equal(total, 50)
  assert.equal((await me(a.token)).xp, 50)
  assert.equal((await me(a.token)).level, 2)
  const mine = env.db.collection('comments').docs.filter(d => d.userId === a.user.id && d.slug === 'cap-test')
  for (const c of mine.slice(0, 4)) await call('DELETE', `/api/community/comments/${c._id}`, { token: a.token })
  assert.equal((await me(a.token)).xp, 50 - mine.slice(0, 4).reduce((s, c) => s + (c.userId === a.user.id ? 5 : 0), 0))
  clock.t += 2 * 86_400_000
  const after = await post(a.token, { ...comic, slug: 'cap-test', body: 'Komentar setelah sehari berlalu' })
  assert.equal(after.data.xpGained, 5)
})

test('XP like: akun baru tidak menghasilkan XP, sekali per pasangan, self-like nol, hapus komentar membalikkan XP', async () => {
  const author = await login('g-xa', 'xa@example.com')
  const fan = await login('g-xf', 'xf@example.com')
  const c = (await post(author.token, { ...comic, slug: 'xplike-test', body: 'Komentar untuk uji XP like' })).data.comment
  const base = (await me(author.token)).xp
  const put = t => call('PUT', `/api/community/comments/${c.id}/like`, { token: t })
  await put(author.token)
  assert.equal((await me(author.token)).xp, base)
  await put(fan.token)
  assert.equal((await me(author.token)).xp, base)
  await call('DELETE', `/api/community/comments/${c.id}/like`, { token: fan.token })
  clock.t += 2 * 3_600_000
  await put(fan.token)
  assert.equal((await me(author.token)).xp, base + 2)
  await call('DELETE', `/api/community/comments/${c.id}/like`, { token: fan.token })
  await put(fan.token)
  assert.equal((await me(author.token)).xp, base + 2)
  await call('DELETE', `/api/community/comments/${c.id}`, { token: author.token })
  assert.equal((await me(author.token)).xp, base - 5)
})

test('XP like: batas pasangan per hari mencegah saling pompa antar akun', async () => {
  const author = await login('g-pa', 'pa@example.com')
  const fan = await login('g-pf', 'pf@example.com')
  clock.t += 2 * 3_600_000
  const base = (await me(author.token)).xp
  for (let i = 0; i < 6; i++) {
    const c = (await post(author.token, { ...comic, slug: 'pair-test', body: `Komentar pasangan nomor ${i} ya` })).data.comment
    await call('PUT', `/api/community/comments/${c.id}/like`, { token: fan.token })
  }
  const postXp = Math.min(6 * 5, 50)
  assert.equal((await me(author.token)).xp - base - postXp, 3 * 2)
})

test('XP: edit jadi spam membalikkan XP, edit jadi bagus tidak menambah XP', async () => {
  const a = await login('g-xe', 'xe@example.com')
  const p = (await post(a.token, { ...comic, slug: 'edit-xp', body: 'Komentar awal yang cukup bagus' })).data
  assert.equal(p.xpGained, 5)
  const base = (await me(a.token)).xp
  const edit = body => call('PATCH', `/api/community/comments/${p.comment.id}`, { token: a.token, body: { body } })
  assert.equal((await edit('Komentar awal yang diedit lagi ya')).status, 200)
  assert.equal((await me(a.token)).xp, base)
  assert.equal((await edit('wkwkwk')).status, 200)
  assert.equal((await me(a.token)).xp, base - 5)
  assert.equal((await edit('Sekarang sudah jadi kalimat panjang')).status, 200)
  assert.equal((await me(a.token)).xp, base - 5)
})

test('XP: kirim paralel tidak bisa melewati batas harian', async () => {
  const a = await login('g-xp', 'xpar@example.com')
  const res = await Promise.all(Array.from({ length: 14 }, (_, i) => post(a.token, { ...comic, slug: 'par-test', body: `Komentar paralel nomor ${i} lumayan panjang` })))
  const total = res.reduce((n, r) => n + (r.data?.xpGained || 0), 0)
  assert.ok(total <= 50)
  assert.equal((await me(a.token)).xp, total)
})

test('XP: alasan 0 XP dikirim ke klien dan saldo dipulihkan dari catatan XP', async () => {
  const a = await login('g-xr', 'xr@example.com')
  const low = await post(a.token, { ...comic, slug: 'reason-test', body: 'wkwkwk' })
  assert.equal(low.data.xpGained, 0)
  assert.equal(low.data.xpReason, 'LOW_QUALITY')
  const ok = await post(a.token, { ...comic, slug: 'reason-test', body: 'Mantap sekali ceritanya' })
  assert.equal(ok.data.xpGained, 5)
  assert.equal(ok.data.xpReason, null)
  await env.db.collection('users').updateOne({ _id: a.user.id }, { $set: { xp: 99999 } })
  assert.equal((await me(a.token)).xp, 5)
  assert.equal((await me(a.token)).level, 1)
  assert.equal((await me(a.token)).commentCount, 2)
  assert.ok((await me(a.token)).joinedAt > 0)
})

test('jumlah komentar per chapter untuk daftar chapter', async () => {
  const a = await login('g-cc', 'cc@example.com')
  const base = { type: 'chapter', source: 'mock', slug: 'count-test' }
  await post(a.token, { ...base, chapter: '1', body: 'Chapter satu seru sekali' })
  const c2 = (await post(a.token, { ...base, chapter: '2', body: 'Chapter dua juga mantap' })).data.comment
  await post(a.token, { parentId: c2.id, body: 'Balasan untuk chapter dua' })
  await post(a.token, { type: 'comic', source: 'mock', slug: 'count-test', body: 'Komentar untuk komiknya saja' })
  const r = await call('GET', '/api/community/comments/counts?source=mock&slug=count-test')
  assert.equal(r.status, 200)
  assert.deepEqual(r.data.counts, { 1: 1, 2: 2 })
  assert.equal((await call('GET', '/api/community/comments/counts?source=nope&slug=x')).status, 400)
})

test('rate limit komentar per pengguna → 429 dengan retry-after', async () => {
  const c2 = await createCommunity(cfg(), { db: env.db, fetchJwks, now, logger: quiet, limits: { commentBurst: { max: 2, windowMs: 60_000 }, login: { max: 10000 }, readTime: { max: 100000 } } })
  const a2 = createApp({ registry: makeRegistry(0), config: loadConfig({ LOG_REQUESTS: 'false' }), logger: quiet, community: c2 })
  const s2 = await listen(a2.handler)
  const tok = (await (await fetch(`${s2.url}/api/community/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: mint('g-rl', 'rl@example.com') }) })).json()).data.token
  const send = n => fetch(`${s2.url}/api/community/comments`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ ...comic, slug: 'rl-test', body: `Komentar uji rate limit ${n}` }) })
  assert.equal((await send(1)).status, 200)
  assert.equal((await send(2)).status, 200)
  const r = await send(3)
  assert.equal(r.status, 429)
  assert.ok(Number(r.headers.get('retry-after') || 1) >= 0)
  assert.equal((await r.json()).error.code, 'RATE_LIMITED')
  s2.server.close()
  a2.close()
  await c2.close()
})

test('sort top & paginasi', async () => {
  const a = await login('g-s1', 'ps1@example.com')
  const b = await login('g-s2', 'ps2@example.com')
  const ids = []
  for (let i = 0; i < 5; i++) ids.push((await post(a.token, { ...comic, slug: 'sort-test', body: `Komentar urutan nomor ${i} ya` })).data.comment.id)
  await call('PUT', `/api/community/comments/${ids[1]}/like`, { token: b.token })
  const newest = await list({ ...comic, slug: 'sort-test', limit: 2 })
  assert.deepEqual(newest.data.items.map(x => x.id), [ids[4], ids[3]])
  assert.equal(newest.data.hasMore, true)
  const p3 = await list({ ...comic, slug: 'sort-test', limit: 2, page: 3 })
  assert.deepEqual(p3.data.items.map(x => x.id), [ids[0]])
  assert.equal(p3.data.hasMore, false)
  const top = await list({ ...comic, slug: 'sort-test', sort: 'top' })
  assert.equal(top.data.items[0].id, ids[1])
  assert.equal((await list({ ...comic, slug: 'sort-test', sort: 'aneh' })).status, 400)
})

test('/me menyegarkan token saat sudah lewat setengah masa berlaku', async () => {
  const a = await login('g-t1', 'tt1@example.com')
  assert.equal((await call('GET', '/api/community/me', { token: a.token })).data.token, undefined)
  clock.t += 20 * 86_400_000
  const r = await call('GET', '/api/community/me', { token: a.token })
  assert.equal(typeof r.data.token, 'string')
  assert.equal((await call('GET', '/api/community/me', { token: r.data.token })).status, 200)
})

test('endpoint lama tetap jalan, 405 dan CORS memuat method baru', async () => {
  assert.equal((await fetch(`${srv.url}/api/mock/search?q=a`)).status, 200)
  assert.equal((await fetch(`${srv.url}/api/sources`, { method: 'POST' })).status, 405)
  assert.equal((await fetch(`${srv.url}/api/community/comments/${'a'.repeat(24)}/like`, { method: 'GET' })).status, 405)
  const pre = await fetch(`${srv.url}/api/community/comments`, { method: 'OPTIONS' })
  assert.equal(pre.status, 204)
  assert.match(pre.headers.get('access-control-allow-methods'), /PATCH/)
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/)
  const big = await fetch(`${srv.url}/api/community/auth/google`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken: 'x'.repeat(40_000) }) })
  assert.equal(big.status, 413)
})

test('hapus akun: komentar dihapus, like ditarik, token mati, OWNER ditolak, bisa daftar ulang', async () => {
  const a = await login('g-del1', 'del1@example.com')
  const b = await login('g-del2', 'del2@example.com')
  const owner = await login('g-owner', 'owner@example.com')
  const mine = (await post(a.token, { ...comic, slug: 'acc-del', body: 'Komentar milik akun yang dihapus' })).data.comment
  const other = (await post(b.token, { ...comic, slug: 'acc-del', body: 'Komentar orang lain yang di-like' })).data.comment
  await call('PUT', `/api/community/comments/${other.id}/like`, { token: a.token })
  await post(b.token, { parentId: mine.id, body: 'Balasan untuk komentar yang akan hilang' })
  assert.equal((await call('DELETE', '/api/community/me', { token: owner.token })).status, 403)
  assert.equal((await call('DELETE', '/api/community/me')).status, 401)
  assert.equal((await call('DELETE', '/api/community/me', { token: a.token })).status, 200)
  assert.equal((await call('GET', '/api/community/me', { token: a.token })).status, 401)
  const l = await list({ ...comic, slug: 'acc-del' })
  const byId = Object.fromEntries(l.data.items.map(x => [x.id, x]))
  assert.equal(byId[mine.id].deleted, true)
  assert.equal(byId[other.id].likeCount, 0)
  const again = await login('g-del1', 'del1@example.com')
  assert.notEqual(again.user.id, a.user.id)
  assert.equal(again.user.level, 1)
})

test('halaman /privacy, /terms, header keamanan, health', async () => {
  for (const p of ['/privacy', '/terms']) {
    const r = await fetch(`${srv.url}${p}`)
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type'), /text\/html/)
    assert.match(await r.text(), /Komikta/)
  }
  const h = await fetch(`${srv.url}/health`)
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff')
  assert.equal((await h.json()).data.community, true)
})

const put = (path, token, body) => call('PUT', `/api/community${path}`, { token, body })
const getp = (path, token) => call('GET', `/api/community${path}`, { token })

test('waktu baca: kredit dibatasi waktu nyata, validasi input, akumulasi ke profil', async () => {
  const a = await login('rt-a', 'rta@example.com')
  const ch = { source: 'mock', slug: 'solo-leveling', chapter: '1', comicTitle: 'Solo Leveling', chapterTitle: 'Chapter 1', coverUrl: 'https://img.example/c.jpg' }
  await put('/me/reading-progress', a.token, ch)
  assert.equal((await put('/me/reading-time', a.token, { ...ch, seconds: 0 })).status, 400)
  assert.equal((await put('/me/reading-time', a.token, { ...ch, seconds: 99999 })).status, 400)
  assert.equal((await put('/me/reading-time', a.token, { ...ch, source: 'tidak-ada', seconds: 10 })).status, 400)
  const first = await put('/me/reading-time', a.token, { ...ch, seconds: 300 })
  assert.equal(first.data.credited, 60)
  const burst = await put('/me/reading-time', a.token, { ...ch, seconds: 300 })
  assert.ok(burst.data.credited <= 6, `burst kredit ${burst.data.credited}`)
  clock.t += 120_000
  const ok = await put('/me/reading-time', a.token, { ...ch, seconds: 120 })
  assert.equal(ok.data.credited, 120)
  const prof = await getp(`/users/${a.user.id}/profile`, a.token)
  assert.equal(prof.data.user.chaptersRead, 1)
  assert.equal(prof.data.self, true)
  const act = await getp(`/users/${a.user.id}/activity?tab=all`, a.token)
  assert.equal(act.data.items[0].comicTitle, 'Solo Leveling')
  assert.equal(act.data.items[0].chaptersRead, 1)
})

test('chapter dibaca: butuh waktu nyata, tidak dihitung dobel, XP dibatasi, tidak bisa dipalsukan klien', async () => {
  const a = await login('cr-a', 'cra@example.com')
  const ch = n => ({ source: 'mock', slug: 'solo-leveling', chapter: String(n) })
  const chaptersOf = async () => (await getp(`/users/${a.user.id}/profile`, a.token)).data.user.chaptersRead
  assert.equal(await chaptersOf(), 0)
  let r = await put('/me/reading-time', a.token, { ...ch(1), seconds: 30 })
  assert.equal(r.data.xpGained, 0)
  assert.equal(await chaptersOf(), 0)
  for (let n = 2; n < 40; n++) await put('/me/reading-time', a.token, { ...ch(n), seconds: 300 })
  assert.equal(await chaptersOf(), 0)
  clock.t += 40_000
  r = await put('/me/reading-time', a.token, { ...ch(1), seconds: 40 })
  assert.equal(r.data.xpGained, 8)
  assert.equal(await chaptersOf(), 1)
  assert.equal((await me(a.token)).chaptersRead, 1)
  clock.t += 60_000
  r = await put('/me/reading-time', a.token, { ...ch(1), seconds: 60 })
  assert.equal(r.data.xpGained, 0)
  assert.equal(await chaptersOf(), 1)
  let total = 8
  for (let n = 100; n < 125; n++) {
    clock.t += 61_000
    const x = await put('/me/reading-time', a.token, { ...ch(n), seconds: 61 })
    total += x.data.xpGained
  }
  assert.equal(total, 80)
  assert.ok(await chaptersOf() > 10)
  assert.equal((await me(a.token)).xp, 80)
})

test('OWNER: #1, level 99999; pengguna lain tidak bisa mengaku #1', async () => {
  const u = await login('own-u', 'ownu@example.com')
  const o = await login('own-o', 'owner@example.com')
  const mo = await me(o.token)
  assert.equal(mo.role, 'OWNER')
  assert.equal(mo.level, 99999)
  assert.equal(mo.publicNo, 1)
  const mu = await me(u.token)
  assert.ok(mu.publicNo > 1)
  assert.ok(mu.level < 100)
  const pub = await getp(`/users/${o.user.id}/profile`, u.token)
  assert.equal(pub.data.user.publicNo, 1)
  assert.equal(pub.data.user.level, 99999)
})

const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(200, 1)]).toString('base64')

test('banner profil sudah dihapus: endpoint hilang dan tidak ada field banner', async () => {
  const a = await login('bn-a', 'bna@example.com')
  assert.equal((await put('/me/banner', a.token, { image: png })).status, 404)
  assert.equal((await getp(`/users/${a.user.id}/banner`)).status, 404)
  const prof = await getp(`/users/${a.user.id}/profile`)
  assert.equal('banner' in prof.data.user, false)
})

test('panel OWNER: detail akun, atur XP, reset foto; non-owner ditolak', async () => {
  const o = await login('pn-o', 'owner@example.com')
  const u = await login('pn-u', 'pnu@example.com')
  await put('/me/avatar', u.token, { image: png })
  assert.equal((await getp(`/admin/users/${u.user.id}`, u.token)).status, 403)
  const d = await getp(`/admin/users/${u.user.id}`, o.token)
  assert.equal(d.data.user.email, 'pnu@example.com')
  assert.equal(d.data.user.hasAvatar, true)
  const post = (path, token, body) => call('POST', `/api/community${path}`, { token, body })
  assert.equal((await post(`/admin/users/${u.user.id}/xp`, u.token, { amount: 100 })).status, 403)
  assert.equal((await post(`/admin/users/${u.user.id}/xp`, o.token, { amount: 0 })).status, 400)
  assert.equal((await post(`/admin/users/${u.user.id}/xp`, o.token, { amount: 1.5 })).status, 400)
  const g = await post(`/admin/users/${u.user.id}/xp`, o.token, { amount: 150 })
  assert.equal(g.status, 200)
  assert.equal(g.data.user.level, 3)
  assert.equal((await me(u.token)).xp, 150)
  const neg = await post(`/admin/users/${u.user.id}/xp`, o.token, { amount: -150 })
  assert.equal(neg.data.user.level, 1)
  assert.equal((await post(`/admin/users/${u.user.id}/reset-media`, o.token, { avatar: true })).status, 200)
  assert.equal((await getp(`/admin/users/${u.user.id}`, o.token)).data.user.hasAvatar, false)
  assert.equal((await post(`/admin/users/${u.user.id}/reset-media`, o.token, {})).status, 400)
})

test('panel OWNER: statistik, daftar pengguna (cari/filter/halaman) dan daftar komentar', async () => {
  const o = await login('ls-o', 'owner@example.com')
  const mod = await login('ls-m', 'dev@example.com')
  const a = await login('ls-a', 'lsalpha@example.com')
  const b = await login('ls-b', 'lsbeta@example.com')
  const adm = (path, token) => call('GET', `/api/community/admin${path}`, { token })
  for (const path of ['/stats', '/users', '/comments']) {
    assert.equal((await adm(path)).status, 401)
    assert.equal((await adm(path, a.token)).status, 403)
    assert.equal((await adm(path, mod.token)).status, 403)
  }
  const s1 = await adm('/stats', o.token)
  assert.equal(s1.status, 200)
  for (const k of ['users', 'newUsers7d', 'active24h', 'banned', 'owners', 'moderators', 'premiums', 'comments', 'comments24h', 'openReports', 'chaptersRead']) {
    assert.equal(typeof s1.data[k], 'number', k)
  }
  assert.ok(s1.data.users >= 4 && s1.data.owners >= 1 && s1.data.moderators >= 1)
  const byName = await adm('/users?q=lsalpha', o.token)
  assert.equal(byName.data.items.length, 1)
  assert.equal(byName.data.items[0].id, a.user.id)
  assert.equal(byName.data.items[0].email, 'lsalpha@example.com')
  assert.equal(byName.data.items[0].banned, false)
  assert.equal(byName.data.total, 1)
  assert.equal((await adm('/users?q=ls.lpha', o.token)).data.items.length, 0, 'karakter regex diperlakukan sebagai teks biasa')
  assert.ok((await adm('/users?role=MODERATOR', o.token)).data.items.every(u => u.role === 'MODERATOR'))
  assert.equal((await adm('/users?role=ADMIN', o.token)).status, 400)
  assert.equal((await call('PUT', `/api/community/admin/users/${b.user.id}/ban`, { token: o.token, body: { banned: true } })).status, 200)
  const bannedList = await adm('/users?banned=1', o.token)
  assert.ok(bannedList.data.items.some(u => u.id === b.user.id && u.banned === true))
  assert.ok(bannedList.data.items.every(u => u.banned))
  assert.equal((await adm('/stats', o.token)).data.banned, s1.data.banned + 1)
  assert.equal((await adm('/users?page=0', o.token)).status, 400)
  assert.equal((await adm(`/users?username=${a.user.username}`, mod.token)).data.user.id, a.user.id)
  const c1 = await post(a.token, { ...comic, body: 'komentar panel admin pertama' })
  const c2 = await post(a.token, { ...comic, body: 'komentar panel admin kedua yang melanggar' })
  assert.equal(c1.status, 200, JSON.stringify(c1))
  assert.equal((await call('POST', `/api/community/comments/${c2.data.comment.id}/report`, { token: mod.token, body: { reason: 'spam' } })).status, 200)
  const all = await adm('/comments', o.token)
  assert.equal(all.data.items[0].id, c2.data.comment.id, 'terbaru dulu')
  assert.equal(all.data.items[0].reportCount, 1)
  assert.equal(all.data.items[0].user.username, a.user.username)
  assert.equal(all.data.items[0].targetKey, 'mock:solo-leveling')
  assert.equal((await adm('/comments?reported=1', o.token)).data.items.every(c => c.reportCount > 0), true)
  assert.equal((await adm('/comments?q=pertama', o.token)).data.items[0].id, c1.data.comment.id)
  assert.ok((await adm(`/comments?q=${a.user.username}`, o.token)).data.items.length >= 2, 'cari lewat username pembuat')
  assert.equal((await call('DELETE', `/api/community/comments/${c1.data.comment.id}`, { token: o.token })).status, 200)
  const withDeleted = await adm('/comments?q=lsalpha', o.token)
  assert.ok(withDeleted.data.items.some(c => c.id === c1.data.comment.id && c.deleted === true))
  const p1 = await adm('/users', o.token)
  assert.equal(p1.data.page, 1)
  assert.ok(p1.data.items.length <= 20 && typeof p1.data.hasMore === 'boolean')
})

test('profil: ID publik berurutan dan stabil, bulan bergabung dari data nyata', async () => {
  const a = await login('id-a', 'ida@example.com')
  const b = await login('id-b', 'idb@example.com')
  const ma = await me(a.token)
  const mb = await me(b.token)
  assert.ok(ma.publicNo > 0 && mb.publicNo > ma.publicNo)
  assert.equal((await me(a.token)).publicNo, ma.publicNo)
  const old = clock.t
  clock.t += 70 * 86_400_000
  const p = await getp(`/users/${a.user.id}/profile`)
  assert.equal(p.data.user.monthsJoined >= 2, true)
  assert.equal(p.data.user.publicNo, ma.publicNo)
  clock.t = old
  assert.equal((await getp('/users/000000000000000000000000/profile')).status, 404)
})

test('likes: komik & chapter, idempotent, hitungan dan daftar di profil', async () => {
  const a = await login('lk-a', 'lka@example.com')
  const b = await login('lk-b', 'lkb@example.com')
  const meta = { comicTitle: 'Tower of God', coverUrl: 'https://img.example/t.jpg' }
  assert.equal((await call('PUT', '/api/community/likes', { body: { type: 'comic', source: 'mock', slug: 'tog' } })).status, 401)
  assert.equal((await put('/likes', a.token, { type: 'comic', source: 'mock', slug: 'tog', ...meta })).data.count, 1)
  assert.equal((await put('/likes', a.token, { type: 'comic', source: 'mock', slug: 'tog', ...meta })).data.count, 1)
  assert.equal((await put('/likes', b.token, { type: 'comic', source: 'mock', slug: 'tog', ...meta })).data.count, 2)
  clock.t += 1000
  await put('/likes', a.token, { type: 'chapter', source: 'mock', slug: 'tog', chapter: '5', chapterTitle: 'Chapter 5', ...meta })
  assert.equal((await put('/likes', a.token, { type: 'chapter', source: 'mock', slug: 'tog' })).status, 400)
  const st = await getp('/likes/status?type=comic&source=mock&slug=tog', a.token)
  assert.deepEqual([st.data.liked, st.data.count], [true, 2])
  assert.equal((await getp('/likes/status?type=comic&source=mock&slug=tog')).data.liked, false)
  const mine = await getp(`/users/${a.user.id}/activity?tab=likes`, a.token)
  assert.deepEqual(mine.data.items.map(i => [i.type, i.comicTitle]), [['chapter', 'Tower of God'], ['comic', 'Tower of God']])
  const del = await call('DELETE', '/api/community/likes?type=comic&source=mock&slug=tog', { token: a.token })
  assert.equal(del.data.count, 1)
  assert.equal((await getp(`/users/${a.user.id}/activity?tab=likes`, a.token)).data.items.length, 1)
})

test('aktivitas: komentar, riwayat, dan likes selalu publik', async () => {
  const a = await login('ac-a', 'aca@example.com')
  const b = await login('ac-b', 'acb@example.com')
  await put('/me/reading-progress', a.token, { source: 'mock', slug: 'one-piece', chapter: '1', comicTitle: 'One Piece', chapterTitle: 'Chapter 1', coverUrl: '' })
  await put('/likes', a.token, { type: 'comic', source: 'mock', slug: 'one-piece', comicTitle: 'One Piece' })
  const c = await post(a.token, { type: 'chapter', source: 'mock', slug: 'one-piece', chapter: '1', body: 'Ceritanya seru sekali ya' })
  assert.equal(c.status, 200)
  const cm = await getp(`/users/${a.user.id}/activity?tab=comments`, b.token)
  assert.equal(cm.data.items[0].comicTitle, 'One Piece')
  assert.equal(cm.data.items[0].chapter, '1')
  assert.equal(cm.data.items[0].body, 'Ceritanya seru sekali ya')
  assert.equal('activityVisible' in (await getp(`/users/${a.user.id}/profile`, b.token)).data, false)
  assert.equal((await getp(`/users/${a.user.id}/activity?tab=all`, b.token)).data.items.length, 1)
  assert.equal((await getp(`/users/${a.user.id}/activity?tab=likes`, b.token)).data.items.length, 1)
  assert.equal((await getp(`/users/${a.user.id}/activity?tab=zzz`, b.token)).status, 400)
})

test('hapus akun ikut menghapus likes dan riwayat', async () => {
  const a = await login('del-a', 'dela@example.com')
  await put('/likes', a.token, { type: 'comic', source: 'mock', slug: 'del-me', comicTitle: 'X' })
  assert.equal((await call('DELETE', '/api/community/me', { token: a.token })).status, 200)
  assert.equal((await getp('/likes/status?type=comic&source=mock&slug=del-me')).data.count, 0)
})

test('nama tampilan: bisa diganti, tervalidasi, tidak tertimpa login Google berikutnya', async () => {
  const a = await login('dn-a', 'dna@example.com')
  const patch = body => call('PATCH', '/api/community/me', { token: a.token, body })
  const ok = await patch({ name: '  Reyz   Forever ' })
  assert.equal(ok.status, 200)
  assert.equal(ok.data.user.name, 'Reyz Forever')
  assert.equal(ok.data.user.username, a.user.username)
  for (const name of ['', 'a', 'x'.repeat(31), '<b>', 123, null]) assert.equal((await patch({ name })).status, 400)
  assert.equal((await patch({})).status, 400)
  assert.equal((await login('dn-a', 'dna@example.com')).user.name, 'Reyz Forever')
  const both = await patch({ name: 'Nama Baru', username: 'nama_baru1' })
  assert.equal(both.data.user.name, 'Nama Baru')
  assert.equal(both.data.user.username, 'nama_baru1')
})

test('riwayat: judul komik keliru (sama dengan judul chapter) tidak menimpa judul benar', async () => {
  const a = await login('rh-a', 'rha@example.com')
  const base = { source: 'mock', slug: 'villain-of-destiny', chapter: '1', chapterTitle: 'Chapter 1' }
  await put('/me/reading-progress', a.token, { ...base, comicTitle: 'The Villain Of Destiny', coverUrl: 'https://img.example/v.jpg' })
  await put('/me/reading-progress', a.token, { ...base, comicTitle: 'Chapter 1', coverUrl: '' })
  const list = await getp(`/users/${a.user.id}/activity?tab=all`, a.token)
  assert.equal(list.data.items[0].comicTitle, 'The Villain Of Destiny')
  assert.equal(list.data.items[0].coverUrl, 'https://img.example/v.jpg')
  const b = await login('rh-b', 'rhb@example.com')
  await put('/me/reading-progress', b.token, { ...base, slug: 'shepherd-wizard', comicTitle: 'Chapter 1', coverUrl: '' })
  const old = await getp(`/users/${b.user.id}/activity?tab=all`, b.token)
  assert.equal(old.data.items[0].comicTitle, 'Shepherd Wizard')
})

test('verified: OWNER otomatis, hanya OWNER yang bisa memberi/mencabut, muncul di semua objek user', async () => {
  const u = await login('g-vf1', 'vf1@example.com')
  const dev = await login('g-dev', 'dev@example.com')
  const owner = await login('g-owner', 'owner@example.com')
  const setV = (t, id, verified) => call('PUT', `/api/community/admin/users/${id}/verified`, { token: t, body: { verified } })
  assert.equal(owner.user.verified, true)
  assert.equal(u.user.verified, false)
  assert.equal((await setV(u.token, u.user.id, true)).status, 403)
  assert.equal((await setV(dev.token, u.user.id, true)).status, 403)
  assert.equal((await setV(owner.token, u.user.id, 'ya')).status, 400)
  assert.equal((await setV(owner.token, owner.user.id, false)).status, 403)
  assert.equal((await setV(owner.token, 'tidak-ada', true)).status, 400)
  assert.equal((await setV(owner.token, 'a'.repeat(u.user.id.length), true)).status, 404)
  const r = await setV(owner.token, u.user.id, true)
  assert.equal(r.status, 200)
  assert.equal(r.data.user.verified, true)
  assert.equal((await call('GET', '/api/community/me', { token: u.token })).data.user.verified, true)
  assert.equal((await call('GET', `/api/community/users/${u.user.id}`)).data.user.verified, true)
  const list = await call('GET', '/api/community/admin/users?verified=1&q=vf1', { token: owner.token })
  assert.equal(list.data.items.length, 1)
  assert.equal(list.data.items[0].id, u.user.id)
  assert.equal((await setV(owner.token, u.user.id, false)).data.user.verified, false)
  assert.equal((await call('GET', '/api/community/admin/users?verified=1&q=vf1', { token: owner.token })).data.items.length, 0)
})

test('pengumuman OWNER: kirim, feed publik untuk HP, riwayat, tarik, dan hak akses', async () => {
  const u = await login('bc-user', 'bc-user@example.com')
  const dev = await login('bc-dev', 'dev@example.com')
  const owner = await login('bc-owner', 'owner@example.com')
  const send = (t, body) => call('POST', '/api/community/admin/broadcasts', { token: t, body })
  assert.equal((await send(u.token, { title: 'Halo', body: 'Tes' })).status, 403)
  assert.equal((await send(dev.token, { title: 'Halo', body: 'Tes' })).status, 403)
  assert.equal((await call('POST', '/api/community/admin/broadcasts', { body: { title: 'a', body: 'b' } })).status, 401)
  assert.equal((await call('GET', '/api/community/admin/broadcasts', { token: dev.token })).status, 403)
  assert.equal((await send(owner.token, { title: '', body: 'isi' })).status, 400)
  assert.equal((await send(owner.token, { title: 'Judul', body: '' })).status, 400)
  assert.equal((await send(owner.token, { title: 'x'.repeat(61), body: 'isi' })).status, 400)
  assert.equal((await send(owner.token, { title: 'Judul', body: 'x'.repeat(201) })).status, 400)
  assert.equal((await send(owner.token, { title: 'Judul', body: 'isi', source: 'mock' })).status, 400)
  assert.equal((await send(owner.token, { title: 'Judul', body: 'isi', source: 'tidak-ada', slug: 'a' })).status, 400)
  assert.equal((await send(owner.token, { title: 'Judul', body: 'isi', source: 'mock', slug: 'a b/c' })).status, 400)
  const before = await call('GET', '/api/community/broadcasts')
  assert.equal(before.status, 200)
  assert.deepEqual(before.data.items, [])
  const base = before.data.latestId
  assert.match(base, /^[0-9a-f]{24}$/)
  const a = await send(owner.token, { title: 'Server maintenance', body: 'Besok pukul 02.00\nselama 30 menit' })
  assert.equal(a.status, 200, JSON.stringify(a))
  assert.equal(a.data.broadcast.title, 'Server maintenance')
  assert.equal(a.data.broadcast.source, '')
  await new Promise(r => setTimeout(r, 5))
  const b = await send(owner.token, { title: 'Chapter baru!', body: 'Solo Leveling sudah update', source: 'mock', slug: 'solo-leveling' })
  assert.equal(b.status, 200)
  assert.equal(b.data.broadcast.slug, 'solo-leveling')
  const feedNow = await call('GET', `/api/community/broadcasts?after=${base}`)
  assert.equal(feedNow.data.items.length, 2)
  assert.deepEqual(feedNow.data.items.map(i => i.title), ['Server maintenance', 'Chapter baru!'])
  assert.equal(feedNow.data.items[0].body, 'Besok pukul 02.00\nselama 30 menit')
  assert.equal(feedNow.data.latestId, b.data.broadcast.id)
  assert.equal(feedNow.data.items[1].source, 'mock')
  assert.equal((await call('GET', `/api/community/broadcasts?after=${b.data.broadcast.id}`)).data.items.length, 0)
  assert.equal((await call('GET', '/api/community/broadcasts?after=bukan-id')).status, 400)
  assert.equal((await call('GET', '/api/community/broadcasts')).data.latestId, b.data.broadcast.id)
  const hist = await call('GET', '/api/community/admin/broadcasts', { token: owner.token })
  assert.equal(hist.data.items[0].id, b.data.broadcast.id)
  assert.equal((await call('DELETE', `/api/community/admin/broadcasts/${a.data.broadcast.id}`, { token: dev.token })).status, 403)
  assert.equal((await call('DELETE', `/api/community/admin/broadcasts/${a.data.broadcast.id}`, { token: owner.token })).status, 200)
  assert.equal((await call('DELETE', `/api/community/admin/broadcasts/${a.data.broadcast.id}`, { token: owner.token })).status, 404)
  assert.deepEqual((await call('GET', `/api/community/broadcasts?after=${base}`)).data.items.map(i => i.title), ['Chapter baru!'])
})

test('FCM: token tersimpan di MongoDB, pengumuman OWNER langsung dikirim, token mati dibuang', async () => {
  const col = env.db.collection('push_tokens')
  col.docs = []
  fcm.calls.length = 0
  fcm.dead.clear()
  const u = await login('fcm-user', 'fcm-user@example.com')
  const owner = await login('fcm-owner', 'owner@example.com')
  const put = (token, t) => call('PUT', '/api/community/push-token', { token: t, body: { token, appVersion: '1.2.0' } })
  assert.equal((await put('pendek')).status, 400)
  assert.equal((await call('PUT', '/api/community/push-token', { body: {} })).status, 400)
  assert.equal((await put(tok(1))).status, 200)
  assert.equal((await put(tok(2), u.token)).status, 200)
  assert.equal((await put(tok(3), owner.token)).status, 200)
  assert.equal((await put(tok(1))).status, 200)
  assert.equal(col.docs.length, 3)
  assert.equal(col.docs.find(d => d.token === tok(2)).userId, u.user.id)
  assert.equal(col.docs.find(d => d.token === tok(1)).userId, null)
  assert.equal(col.docs.find(d => d.token === tok(1)).appVersion, '1.2.0')
  await put(tok(2))
  assert.equal(col.docs.length, 3)
  assert.equal(col.docs.find(d => d.token === tok(2)).userId, null)
  await put(tok(2), u.token)
  assert.equal((await call('PUT', '/api/community/push-token', { token: 'sesi.rusak.token', body: { token: tok(1) } })).status, 200)
  assert.equal((await call('PUT', '/api/community/push-token', { body: { token: tok(4), previous: tok(1) } })).status, 200)
  assert.deepEqual(col.docs.map(d => d.token).sort(), [tok(2), tok(3), tok(4)])
  await put(tok(1))
  assert.equal(col.docs.length, 4)
  await call('POST', '/api/community/push-token/unregister', { body: { token: tok(4) } })
  assert.equal(col.docs.length, 3)
  assert.equal((await call('GET', '/api/community/admin/push-status', { token: u.token })).status, 403)
  const st = await call('GET', '/api/community/admin/push-status', { token: owner.token })
  assert.deepEqual([st.data.enabled, st.data.devices, st.data.linkedToAccount], [true, 3, 2])
  fcm.dead.add(tok(3))
  const sent = await call('POST', '/api/community/admin/broadcasts', { token: owner.token, body: { title: 'Halo FCM', body: 'Isi pesan', source: 'mock', slug: 'solo-leveling' } })
  assert.equal(sent.status, 200)
  await community.push.flush()
  assert.equal(fcm.calls.length, 1)
  const m = fcm.calls[0]
  assert.deepEqual([...m.tokens].sort(), [tok(1), tok(2), tok(3)])
  assert.equal(m.notification, undefined)
  assert.deepEqual(m.data, { type: 'broadcast', id: sent.data.broadcast.id, title: 'Halo FCM', body: 'Isi pesan', source: 'mock', slug: 'solo-leveling', createdAt: String(sent.data.broadcast.createdAt) })
  assert.equal(m.android.priority, 'high')
  assert.equal(m.android.ttl, 3 * 86_400_000)
  assert.deepEqual(col.docs.map(d => d.token).sort(), [tok(1), tok(2)])
  const stored = env.db.collection('broadcasts').docs.find(d => d._id === sent.data.broadcast.id)
  assert.deepEqual([stored.push.sent, stored.push.failed], [2, 1])
  const feed = await call('GET', `/api/community/broadcasts?after=${'0'.repeat(24)}`)
  assert.ok(feed.data.items.some(i => i.id === sent.data.broadcast.id))
  assert.equal(feed.data.items[0].push, undefined)
  assert.equal((await call('GET', '/api/community/admin/broadcasts', { token: owner.token })).data.items[0].id, sent.data.broadcast.id)
  fcm.fail = true
  const down = await call('POST', '/api/community/admin/broadcasts', { token: owner.token, body: { title: 'FCM mati', body: 'Tetap tersimpan' } })
  await community.push.flush()
  fcm.fail = false
  assert.equal(down.status, 200)
  assert.equal(col.docs.length, 2)
  assert.ok((await call('GET', `/api/community/broadcasts?after=${'0'.repeat(24)}`)).data.items.some(i => i.id === down.data.broadcast.id))
  assert.equal((await call('POST', '/api/community/push-token/unregister', { body: { token: tok(1) } })).status, 200)
  assert.deepEqual(col.docs.map(d => d.token), [tok(2)])
  assert.equal((await call('POST', '/api/community/push-token/unregister', { body: { token: 'x' } })).status, 400)
  assert.equal((await call('DELETE', '/api/community/me', { token: u.token })).status, 200)
  assert.equal(col.docs.length, 0)
})

test('FCM: banyak perangkat dikirim per 500 token, token basi dibersihkan', async () => {
  const col = env.db.collection('push_tokens')
  col.docs = []
  fcm.calls.length = 0
  const owner = await login('fcm-owner2', 'owner@example.com')
  const t0 = clock.t
  for (let i = 0; i < 1203; i++) col.docs.push({ _id: newId(), token: tok(i + 10), userId: null, updatedAt: t0, createdAt: t0 })
  col.docs.push({ _id: newId(), token: tok(9999), userId: null, updatedAt: t0 - 61 * 86_400_000, createdAt: t0 - 90 * 86_400_000 })
  const r = await call('POST', '/api/community/admin/broadcasts', { token: owner.token, body: { title: 'Massal', body: 'Tes' } })
  assert.equal(r.status, 200)
  await community.push.flush()
  assert.deepEqual(fcm.calls.map(c => c.tokens.length), [500, 500, 203])
  assert.equal(new Set(fcm.calls.flatMap(c => c.tokens)).size, 1203)
  assert.equal(col.docs.some(d => d.token === tok(9999)), false)
  col.docs = []
})

test('FCM tidak dikonfigurasi: pengumuman tetap jalan lewat feed', async () => {
  const c2 = await createCommunity(cfg(), { db: env.db, messaging: null, fetchJwks, now, logger: quiet })
  assert.equal(c2.push.enabled, false)
  assert.deepEqual(await c2.push.dispatch({ _id: 'a'.repeat(24), title: 't', body: 'b', createdAt: 1 }), { sent: 0, failed: 0, skipped: true })
  await c2.close()
})
