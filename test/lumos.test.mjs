import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import lumos, { resetCache, allSeries } from '../src/scrapers/lumos.js'

const card = (slug, title, score) =>
  `<article class="htg-card"><a href="/comic/${slug}"><img src="/api/image/thumbnail?src=abc&w=640&sig=x" alt="${title}"></a>` +
  `<h3>${title}</h3><span class="score">${score}</span><span>manhwa</span><span>ongoing</span></article>`

const PAGE = `<html><body>
  <header><a href="/comic/navbar-link">Nav</a></header>
  <main id="main-content">
    ${card('solo-leveling', 'Solo Leveling', '9.1')}
    ${card('tower-of-god', 'Tower of God', '8.7')}
    ${card('omniscient-reader', 'Omniscient Reader', '8.9')}
    <a href="/all-series?sort=popular&page=2">2</a>
    <a href="/all-series?sort=popular&page=5">5</a>
  </main></body></html>`

let routes
const realFetch = globalThis.fetch
beforeEach(() => {
  resetCache()
  routes = new Map()
  globalThis.fetch = async url => {
    const u = new URL(url)
    const hit = routes.get(u.pathname + u.search) ?? routes.get(u.pathname)
    if (hit === undefined) return new Response('nf', { status: 404 })
    return typeof hit === 'string'
      ? new Response(hit, { status: 200 })
      : new Response(JSON.stringify(hit), { status: 200, headers: { 'content-type': 'application/json' } })
  }
})
test.after(() => (globalThis.fetch = realFetch))

test('popular: dibaca dari /all-series?sort=popular, urutan sesuai situs', async () => {
  routes.set('/all-series', PAGE)
  const p = await lumos.popular({ limit: 2 })
  assert.deepEqual(p.map(x => x.slug), ['solo-leveling', 'tower-of-god'])
  assert.equal(p[0].title, 'Solo Leveling')
  assert.match(p[0].cover, /^https:\/\/03\.lumosgg\.com\/api\/image\/thumbnail\?/)
  assert.equal(p[0].rating, 9.1)
})

test('popular: link navbar tidak ikut terbaca', async () => {
  routes.set('/all-series', PAGE)
  const p = await lumos.popular({ limit: 10 })
  assert.ok(!p.some(x => x.slug === 'navbar-link'))
  assert.equal(p.length, 3)
})

test('allSeries: jumlah halaman terbaca', async () => {
  routes.set('/all-series', PAGE)
  const r = await allSeries({ sort: 'popular', page: 1 })
  assert.equal(r.pages, 5)
})

test('popular: /all-series gagal → pakai API trending', async () => {
  routes.set('/api/popular', { data: [{ slug: 'x-comic', title: 'X Comic' }] })
  const p = await lumos.popular({ limit: 5 })
  assert.equal(p[0].slug, 'x-comic')
})

test('latest: API kosong → pakai /all-series?sort=latest', async () => {
  routes.set('/api/home-latest', { data: { items: [] } })
  routes.set('/all-series', PAGE)
  const l = await lumos.latest({ page: 1 })
  assert.equal(l.length, 3)
})
