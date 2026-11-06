import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import mangaplus, { decode } from '../src/scrapers/mangaplus.js'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { requestScope } from '../src/scrapers/utils.js'
import { PNG, quiet, listen, makeRegistry } from './helpers.mjs'

const vi = n => {
  const o = []
  while (n >= 128) {
    o.push((n % 128) | 128)
    n = Math.floor(n / 128)
  }
  o.push(n)
  return Buffer.from(o)
}
const v = (f, n) => Buffer.concat([vi(f * 8), vi(n)])
const l = (f, x) => {
  const b = Buffer.isBuffer(x) ? x : Buffer.from(x)
  return Buffer.concat([vi(f * 8 + 2), vi(b.length), b])
}
const m = (f, ...parts) => l(f, Buffer.concat(parts))
const title = (id, name, author, thumb = 'https://jumpg-assets.tokyo-cdn.com/t/' + id + '.jpg') => [v(1, id), l(2, name), l(3, author), l(4, thumb)]
const chap = (tid, cid, name, sub, ts) => [v(1, tid), v(2, cid), l(3, name), l(4, sub), v(6, ts)]
const ok = (...parts) => m(1, ...parts)

const key = Buffer.from('a1b2c3', 'hex')
const enc = Buffer.from(PNG.map((b, i) => b ^ key[i % key.length]))

const responses = {
  'title_list/all_v3': ok(
    m(35, m(2, l(1, 'Action'), l(2, 'action')), m(3, m(2, ...title(100020, 'One Piece', 'Eiichiro Oda')), m(3, l(2, 'action'))), m(3, m(2, ...title(100021, 'Hi', 'Mr A')))),
  ),
  'title_list/updated': ok(m(20, m(1, m(1, ...title(100020, 'One Piece', 'Eiichiro Oda')), v(2, 1700000000)))),
  'title_list/rankingV2': ok(m(37, m(3, m(2, ...title(100021, 'Hi', 'Mr A'))))),
  title_detailV4: ok(
    m(8, m(1, ...title(100020, 'One Piece', 'Eiichiro Oda')), l(2, 'https://jumpg-assets.tokyo-cdn.com/b.jpg'), l(3, 'Bajak laut'), v(5, 1700000000), m(10, ...[chap(100020, 1000001, '#001', 'Romance Dawn', 1600000000)].map(x => m(1, ...x))), m(11, m(1, ...chap(100020, 1000003, '#003', 'Ch 3', 1600200000)), m(2, ...chap(100020, 1000002, '#002', 'Ch 2', 1600100000)))),
  ),
  manga_viewer_v3: ok(m(10, v(2, 1000002), m(1, m(3, l(1, 'https://jumpg-assets.tokyo-cdn.com/s/manga_page/low/1.jpg'), v(2, 800), v(3, 1200), l(5, 'a1b2c3')), m(3, l(1, 'https://jumpg-assets.tokyo-cdn.com/s/banner/ad.jpg'))), l(19, 'tok123')))
}

const realFetch = globalThis.fetch
const calls = []
before(() => {
  globalThis.fetch = (url, opts) => {
    const u = new URL(url)
    if (u.hostname !== 'jumpg-webapi.tokyo-cdn.com') return realFetch(url, opts)
    const name = u.pathname.replace('/api/', '')
    calls.push({ name, params: u.searchParams, headers: opts.headers })
    const body = responses[name]
    return Promise.resolve(body ? new Response(body) : new Response('', { status: 404 }))
  }
})
after(() => {
  globalThis.fetch = realFetch
})

test('decoder: string pendek yang kebetulan valid protobuf tetap terbaca sebagai teks', () => {
  const root = decode(l(2, 'Hi'))
  assert.equal(root[2][0].$s, 'Hi')
})

test('search, latest, popular, genres, browse', async () => {
  const s = await mangaplus.search('one piece')
  assert.equal(s.length, 1)
  assert.deepEqual([s[0].slug, s[0].title, s[0].cover.startsWith('https://jumpg-assets')], ['100020', 'One Piece', true])
  assert.equal((await mangaplus.search('mr a'))[0].title, 'Hi')
  assert.equal((await mangaplus.search('oda'))[0].slug, '100020')
  const l1 = await mangaplus.latest({ page: 1 })
  assert.equal(l1[0].slug, '100020')
  assert.ok(l1[0].updatedAt.startsWith('2023-11'))
  assert.equal((await mangaplus.popular({ limit: 5 }))[0].slug, '100021')
  assert.deepEqual(await mangaplus.genres(), ['Action'])
  const b = await mangaplus.browse({ genre: ['action'], page: 1 })
  assert.deepEqual(b.items.map(x => x.slug), ['100020'])
  assert.equal(b.total, 1)
  assert.ok(calls.every(c => c.headers['session-token'] && c.headers.origin))
})

test('detail: chapter terurut baru ke lama, nomor dinormalkan', async () => {
  const d = await mangaplus.detail('100020')
  assert.equal(d.title, 'One Piece')
  assert.equal(d.author, 'Eiichiro Oda')
  assert.equal(d.synopsis, 'Bajak laut')
  assert.deepEqual(d.chapters.map(c => [c.slug, c.number]), [['1000003', '3'], ['1000002', '2'], ['1000001', '1']])
  assert.equal(d.chapters[2].title, 'Romance Dawn')
  await assert.rejects(mangaplus.detail('abc'), { status: 404 })
})

test('chapter: hanya halaman manga, kunci + token ikut di fragment, prev/next benar', async () => {
  const c = await mangaplus.chapter('100020', '2')
  assert.equal(c.chapter, '1000002')
  assert.equal(c.totalImages, 1)
  assert.equal(c.images[0], 'https://jumpg-assets.tokyo-cdn.com/s/manga_page/low/1.jpg#k=a1b2c3&t=tok123')
  assert.deepEqual([c.prev, c.next], ['1000001', '1000003'])
})

test('imagePrep: validasi key/token', () => {
  assert.equal(mangaplus.imagePrep(new URL('https://x.com/a.jpg')), null)
  assert.equal(mangaplus.imagePrep(new URL('https://x.com/a.jpg#k=zz&t=bad token')), null)
  const p = mangaplus.imagePrep(new URL('https://x.com/a.jpg#k=a1b2c3&t=tok123'))
  assert.equal(p.headers['plus-vw-token'], 'tok123')
  assert.deepEqual(p.decode(Buffer.from([0xa1 ^ 1, 0xb2 ^ 2, 0xc3 ^ 3, 0xa1 ^ 4])), Buffer.from([1, 2, 3, 4]))
})

test('image proxy: dekripsi XOR + header token, via provider.imagePrep', async () => {
  const seen = []
  const img = await listen((req, res) => {
    seen.push(req.headers['plus-vw-token'])
    if (req.headers['plus-vw-token'] !== 'tok123') return res.writeHead(403).end()
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(enc)
  })
  const registry = makeRegistry(img.port)
  registry.provider.imagePrep = mangaplus.imagePrep
  const app = createApp({ registry, config: loadConfig({ LOG_REQUESTS: 'false' }), logger: quiet })
  const api = await listen(app.handler)
  try {
    const target = `http://127.0.0.1:${img.port}/manga_page/1.jpg#k=a1b2c3&t=tok123`
    const res = await realFetch(`${api.url}/api/image?url=${encodeURIComponent(target)}`)
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG)
    const again = await realFetch(`${api.url}/api/image?url=${encodeURIComponent(target)}`)
    assert.equal(again.headers.get('x-cache'), 'HIT')
    const bad = await realFetch(`${api.url}/api/image?url=${encodeURIComponent(`http://127.0.0.1:${img.port}/manga_page/2.jpg#k=a1b2c3&t=salah`)}`)
    assert.equal(bad.status, 502)
    const junk = await realFetch(`${api.url}/api/image?url=${encodeURIComponent(`http://127.0.0.1:${img.port}/manga_page/3.jpg#k=ffffff&t=tok123`)}`)
    assert.equal(junk.status, 502)
  } finally {
    api.server.close()
    img.server.close()
    app.close?.()
  }
})

test('bahasa per-request lewat requestScope, tidak tercampur di cache', async () => {
  const lastLang = () => calls[calls.length - 1].params.get('lang')
  await requestScope.run({ lang: 'ind' }, () => mangaplus.popular({ limit: 3 }))
  assert.equal(lastLang(), 'ind')
  await requestScope.run({ lang: 'esp' }, () => mangaplus.popular({ limit: 3 }))
  assert.equal(lastLang(), 'esp')
  const n = calls.length
  await requestScope.run({ lang: 'ind' }, () => mangaplus.popular({ limit: 3 }))
  assert.equal(calls.length, n)
  await requestScope.run({ lang: 'xx' }, () => mangaplus.popular({ period: 'trending' }))
  assert.equal(lastLang(), 'eng')
  assert.deepEqual(mangaplus.filters.languages.slice(0, 3), ['eng', 'fra', 'ind'])
})

test('route: ?lang= diteruskan ke provider', async () => {
  const registry = makeRegistry(1)
  let seen
  registry.provider.latest = async () => ((seen = requestScope.getStore()?.lang), [])
  const app = createApp({ registry, config: loadConfig({ LOG_REQUESTS: 'false' }), logger: quiet })
  const api = await listen(app.handler)
  try {
    await realFetch(`${api.url}/api/mock/latest?lang=IND`)
    assert.equal(seen, 'ind')
  } finally {
    api.server.close()
  }
})
