import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createSign } from 'node:crypto'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createCommunity } from '../src/community/index.js'
import { sniffImage, filePart } from '../src/community/catalog.js'
import { quiet, listen, makeRegistry, PNG } from './helpers.mjs'
import { fakeDb } from './fake-mongo.mjs'

const CLIENT_ID = 'test-client.apps.googleusercontent.com'
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const clock = { t: Date.now() }
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
const mint = (sub, email) => {
  const sec = Math.floor(clock.t / 1000)
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const body = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub, email, email_verified: true, name: `Nama ${sub}`, picture: `https://lh3.googleusercontent.com/${sub}`, iat: sec, exp: sec + 3600 })
  return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')}`
}
const cfg = () => loadConfig({ LOG_REQUESTS: 'false', MONGODB_URI: 'x', GOOGLE_CLIENT_ID: CLIENT_ID, AUTH_SECRET: 'x'.repeat(40), OWNER_EMAILS: 'owner@example.com' }).community

let srv, app, community, owner, member
const call = async (method, path, { token, body, headers, raw } = {}) => {
  const res = await fetch(`${srv.url}${path}`, {
    method,
    headers: { ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
  })
  const json = await res.json()
  return { status: res.status, headers: res.headers, ...json }
}
const login = async (sub, email) => {
  const r = await call('POST', '/api/community/auth/google', { body: { idToken: mint(sub, email) } })
  assert.equal(r.status, 200, JSON.stringify(r))
  return r.data.token
}
const device = id => ({ 'x-device-id': id })
const viewComic = (slug, headers, token) => call('POST', '/api/community/views/comic', { body: { source: 'mock', slug }, headers, token })
const viewChapter = (slug, chapter, headers, token) => call('POST', '/api/community/views/chapter', { body: { source: 'mock', comic: slug, chapter }, headers, token })
const A = '/api/community/admin'

const multipart = (bytes, { name = 'file', filename = 'x.png', type = 'image/png' } = {}) => {
  const boundary = '----komikta1234'
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`)
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return { body: Buffer.concat([head, bytes, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } }
}
const upload = (bytes, token, opts) => call('POST', `${A}/media`, { token, raw: true, ...multipart(bytes, opts) })

before(async () => {
  community = await createCommunity(cfg(), {
    db: fakeDb(), messaging: null, fetchJwks: async () => ({ keys: [jwk], maxAge: 3600 }), now: () => clock.t, logger: quiet,
    limits: { write: { max: 100000 }, login: { max: 100000 }, view: { max: 100000 } }
  })
  app = createApp({ registry: makeRegistry(0), config: loadConfig({ LOG_REQUESTS: 'false', RATE_LIMIT_MAX: '100000' }), logger: quiet, community })
  srv = await listen(app.handler)
  owner = await login('o1', 'owner@example.com')
  member = await login('m1', 'member@example.com')
})
after(async () => {
  srv.server.close()
  app.close()
  await community.close()
})

test('views: dedupe per perangkat, per akun, dan jendela 6 jam', async () => {
  const a = await viewComic('komik-1', device('device-aaaa-1'))
  assert.equal(a.status, 200)
  assert.equal(a.data.viewCount, 1)
  assert.equal((await viewComic('komik-1', device('device-aaaa-1'))).data.viewCount, 1) // perangkat sama: tidak bertambah
  assert.equal((await viewComic('komik-1', device('device-bbbb-2'))).data.viewCount, 2) // perangkat lain: bertambah
  assert.equal((await viewComic('komik-1', device('device-cccc-3'), member)).data.viewCount, 3) // login: kunci = userId
  assert.equal((await viewComic('komik-1', device('device-dddd-4'), member)).data.viewCount, 3) // akun sama, perangkat lain: tetap
  clock.t += 6 * 3_600_000 + 1000
  assert.equal((await viewComic('komik-1', device('device-aaaa-1'))).data.viewCount, 4) // jendela lewat (walau TTL MongoDB belum menyapu)
  assert.equal((await viewComic('komik-1', device('device-aaaa-1'))).data.viewCount, 4)
})

test('views: validasi sumber dan slug', async () => {
  const bad = await call('POST', '/api/community/views/comic', { body: { source: 'nope', slug: 'x' } })
  assert.equal(bad.status, 404)
  const noSlug = await call('POST', '/api/community/views/comic', { body: { source: 'mock', slug: 'a/b' } })
  assert.equal(noSlug.status, 400)
  const badCh = await call('POST', '/api/community/views/chapter', { body: { source: 'mock', comic: 'komik-1' } })
  assert.equal(badCh.status, 400)
})

test('viewCount muncul di daftar, pencarian, dan detail (komik + chapter)', async () => {
  await viewChapter('komik-2', '1', device('device-eeee-5'))
  await viewChapter('komik-2', '1', device('device-ffff-6'))
  await viewComic('komik-2', device('device-eeee-5'))
  const latest = await call('GET', '/api/mock/latest')
  assert.equal(latest.data.items.find(i => i.slug === 'komik-2').viewCount, 1)
  assert.equal(latest.data.items.find(i => i.slug === 'komik-3').viewCount, 0)
  const all = await call('GET', '/api/search?q=komik')
  assert.equal(all.data.items.find(i => i.slug === 'komik-2').viewCount, 1)
  const detail = await call('GET', '/api/mock/comic/komik-2')
  assert.equal(detail.data.viewCount, 1)
  assert.equal(detail.data.chapters[0].viewCount, 2)
  assert.equal((await call('GET', '/api/mock/comic/komik-9')).data.chapters[0].viewCount, 0)
})

test('admin komik: hanya OWNER, simpan override tampil di semua respons, reset mengembalikan data asli', async () => {
  assert.equal((await call('GET', `${A}/comics/mock/komik-4`)).status, 401)
  assert.equal((await call('GET', `${A}/comics/mock/komik-4`, { token: member })).status, 403)
  assert.equal((await call('PUT', `${A}/comics/mock/komik-4`, { token: member, body: { title: 'X' } })).status, 403)

  const before = await call('GET', `${A}/comics/mock/komik-4`, { token: owner })
  assert.equal(before.status, 200)
  assert.equal(before.data.edited, false)
  assert.equal(before.data.title, 'komik-4')
  assert.deepEqual(before.data.chapters.map(c => c.slug), ['1'])

  await call('GET', '/api/mock/comic/komik-4') // panaskan cache dengan data asli
  const saved = await call('PUT', `${A}/comics/mock/komik-4`, {
    token: owner,
    body: { title: 'Judul Baru', cover: '', synopsis: 'Sinopsis baru', genres: ['Action', 'Action', 'Fantasy'], type: 'Manga', status: 'completed', author: 'Penulis', artist: '' }
  })
  assert.equal(saved.status, 200, JSON.stringify(saved))
  assert.equal(saved.data.edited, true)
  assert.equal(saved.data.title, 'Judul Baru')
  assert.deepEqual(saved.data.genres, ['Action', 'Fantasy'])
  assert.equal(saved.data.type, 'manga')

  const detail = await call('GET', '/api/mock/comic/komik-4')
  assert.equal(detail.data.title, 'Judul Baru')
  assert.equal(detail.data.synopsis, 'Sinopsis baru')
  assert.equal(detail.data.status, 'completed')
  assert.equal(detail.data.author, 'Penulis')
  assert.equal(detail.data.chapters.length, 1) // chapter scraper tetap
  const latest = await call('GET', '/api/mock/latest')
  assert.equal(latest.data.items.find(i => i.slug === 'komik-4').title, 'Judul Baru')
  const search = await call('GET', '/api/mock/search?q=x')
  assert.equal(search.data.items.find(i => i.slug === 'komik-4').type, 'manga')

  const reset = await call('DELETE', `${A}/comics/mock/komik-4/override`, { token: owner })
  assert.equal(reset.status, 200)
  assert.equal(reset.data.edited, false)
  assert.equal((await call('GET', '/api/mock/comic/komik-4')).data.title, 'komik-4') // data cache asli tidak rusak oleh override
  assert.equal((await call('GET', '/api/mock/latest')).data.items.find(i => i.slug === 'komik-4').title, 'Komik 4')
})

test('admin komik: validasi, field kosong semua = hapus override, komik tak ada', async () => {
  const put = body => call('PUT', `${A}/comics/mock/komik-5`, { token: owner, body })
  assert.equal((await put({ type: 'novel' })).status, 400)
  assert.equal((await put({ status: 'selesai' })).status, 400)
  assert.equal((await put({ cover: 'javascript:alert(1)' })).status, 400)
  assert.equal((await put({ genres: 'Action' })).status, 400)
  assert.equal((await put({ title: 'x'.repeat(201) })).status, 400)
  assert.equal((await put({ title: 'Ok', cover: '/media/0123456789abcdef01234567' })).status, 200)
  const cleared = await put({})
  assert.equal(cleared.status, 200)
  assert.equal(cleared.data.edited, false)
  assert.equal((await call('GET', `${A}/comics/nope/komik-5`, { token: owner })).status, 404)
  assert.equal((await call('GET', `${A}/comics/mock/missing`, { token: owner })).status, 404)
  assert.equal((await call('PUT', `${A}/comics/mock/missing`, { token: owner, body: { title: 'x' } })).status, 404)
})

test('browse: override type ikut dihitung (keluar dari / masuk ke filter)', async () => {
  const q = () => call('GET', '/api/mock/browse?type=manhwa&page=1')
  assert.deepEqual((await q()).data.items.map(i => i.slug), ['komik-0', 'komik-1', 'komik-2'])
  await call('PUT', `${A}/comics/mock/komik-0`, { token: owner, body: { type: 'manga' } })
  await call('PUT', `${A}/comics/mock/komik-30`, { token: owner, body: { title: 'Pindahan', type: 'manhwa' } })
  const after = (await q()).data.items
  assert.deepEqual(after.map(i => i.slug), ['komik-1', 'komik-2', 'komik-30'])
  assert.equal(after[2].title, 'Pindahan')
  assert.equal((await call('GET', '/api/mock/browse?type=manhwa&page=2')).data.items.some(i => i.slug === 'komik-30'), false) // hanya halaman 1
  await call('DELETE', `${A}/comics/mock/komik-0/override`, { token: owner })
  await call('DELETE', `${A}/comics/mock/komik-30/override`, { token: owner })
  assert.deepEqual((await q()).data.items.map(i => i.slug), ['komik-0', 'komik-1', 'komik-2'])
})

test('gambar chapter: simpan, tampil di endpoint publik, urutan dipertahankan, reset', async () => {
  const pub = () => call('GET', '/api/mock/chapter/komik-6/1')
  const orig = await pub()
  assert.equal(orig.data.images.length, 1)
  const adminGet = await call('GET', `${A}/comics/mock/komik-6/chapters/1/pages`, { token: owner })
  assert.deepEqual(adminGet.data, { pages: orig.data.images, edited: false })

  const pages = ['/media/aaaaaaaaaaaaaaaaaaaaaaaa', 'http://127.0.0.1:1/img/b.png', '/media/bbbbbbbbbbbbbbbbbbbbbbbb']
  assert.equal((await call('PUT', `${A}/comics/mock/komik-6/chapters/1/pages`, { token: member, body: { pages } })).status, 403)
  assert.equal((await call('PUT', `${A}/comics/mock/komik-6/chapters/1/pages`, { token: owner, body: { pages: [] } })).status, 400)
  assert.equal((await call('PUT', `${A}/comics/mock/komik-6/chapters/1/pages`, { token: owner, body: { pages: ['ftp://x/y.png'] } })).status, 400)
  const saved = await call('PUT', `${A}/comics/mock/komik-6/chapters/1/pages`, { token: owner, body: { pages } })
  assert.deepEqual(saved.data, { pages, edited: true })

  const now = await pub()
  assert.deepEqual(now.data.images, pages)
  assert.deepEqual(now.data.proxy, ['/media/aaaaaaaaaaaaaaaaaaaaaaaa', `/api/image?url=${encodeURIComponent(pages[1])}`, '/media/bbbbbbbbbbbbbbbbbbbbbbbb'])
  assert.equal(now.data.next, '2') // field lain dari scraper tetap ada
  assert.equal((await call('GET', `${A}/comics/mock/komik-6`, { token: owner })).data.chapters[0].edited, true)

  const reset = await call('DELETE', `${A}/comics/mock/komik-6/chapters/1/pages`, { token: owner })
  assert.equal(reset.data.edited, false)
  assert.deepEqual((await pub()).data.images, orig.data.images)
})

test('batas ukuran daftar gambar: 500 boleh, 501 ditolak, body besar tidak kena batas 16 KB', async () => {
  const mk = n => Array.from({ length: n }, (_, i) => `/media/${String(i).padStart(24, '0').replace(/[^0-9a-f]/g, '0')}`)
  const ok = await call('PUT', `${A}/comics/mock/komik-7/chapters/1/pages`, { token: owner, body: { pages: mk(500) } })
  assert.equal(ok.status, 200, JSON.stringify(ok).slice(0, 200))
  assert.equal((await call('PUT', `${A}/comics/mock/komik-7/chapters/1/pages`, { token: owner, body: { pages: mk(501) } })).status, 400)
})

test('unggah gambar: hanya OWNER, cek byte (bukan Content-Type), tersaji immutable + ETag', async () => {
  assert.equal((await upload(PNG, member)).status, 403)
  assert.equal((await upload(PNG, undefined)).status, 401)
  assert.equal((await upload(Buffer.from('<html>bukan gambar</html>'), owner, { type: 'image/png' })).status, 400)
  assert.equal((await upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), owner, { type: 'image/svg+xml' })).status, 400)
  assert.equal((await call('POST', `${A}/media`, { token: owner, raw: true, body: Buffer.from('x'), headers: { 'content-type': 'multipart/form-data' } })).status, 400)
  assert.equal((await upload(PNG, owner, { name: 'lain' })).status, 400)

  const up = await upload(PNG, owner, { type: 'text/plain' }) // Content-Type dusta, byte PNG asli
  assert.equal(up.status, 200, JSON.stringify(up))
  assert.match(up.data.url, /^\/media\/[0-9a-f]{24}$/)

  const res = await fetch(`${srv.url}${up.data.url}`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  assert.match(res.headers.get('cache-control'), /immutable/)
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG)
  const etag = res.headers.get('etag')
  const again = await fetch(`${srv.url}${up.data.url}`, { headers: { 'if-none-match': etag } })
  assert.equal(again.status, 304)
  assert.equal((await fetch(`${srv.url}/media/ffffffffffffffffffffffff`)).status, 404)
  assert.equal((await fetch(`${srv.url}/media/bukan-id`)).status, 404)
})

test('unggah gambar: lebih dari 10 MB ditolak 413', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 10)])
  const r = await upload(big, owner)
  assert.equal(r.status, 413)
})

test('gambar unggahan bisa jadi cover dan panel chapter', async () => {
  const { data } = await upload(PNG, owner)
  await call('PUT', `${A}/comics/mock/komik-8`, { token: owner, body: { cover: data.url } })
  assert.equal((await call('GET', '/api/mock/comic/komik-8')).data.cover, data.url)
  assert.equal((await call('GET', '/api/mock/latest')).data.items.find(i => i.slug === 'komik-3').cover, '')
})

test('MongoDB bermasalah: katalog tetap terbaca tanpa views/override (tidak 5xx)', async () => {
  const find = community.c.comicStats.find
  community.c.comicStats.find = () => { throw new Error('mongo down') }
  try {
    const r = await call('GET', '/api/mock/latest?page=1')
    assert.equal(r.status, 200)
    assert.ok(r.data.items.length > 0)
  } finally {
    community.c.comicStats.find = find
  }
})

test('overlay tidak mengubah data cache bersama (dua request beruntun konsisten)', async () => {
  const a = await call('GET', '/api/mock/comic/komik-3')
  a.data.chapters.length = 0
  const b = await call('GET', '/api/mock/comic/komik-3')
  assert.equal(b.data.chapters.length, 1)
})

test('CORS mengizinkan header X-Device-Id', async () => {
  const res = await fetch(`${srv.url}/api/community/views/comic`, { method: 'OPTIONS', headers: { origin: 'http://x', 'access-control-request-method': 'POST' } })
  assert.match(res.headers.get('access-control-allow-headers'), /x-device-id/)
})

test('sniffImage & filePart', () => {
  assert.equal(sniffImage(PNG), 'image/png')
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg')
  assert.equal(sniffImage(Buffer.from('GIF89a....')), 'image/gif')
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')), 'image/webp')
  assert.equal(sniffImage(Buffer.from('<svg/>')), null)
  const m = multipart(Buffer.from('abc\r\n--x'))
  assert.equal(filePart(m.body, m.headers['content-type']).toString(), 'abc\r\n--x')
})
