import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import komiku, { resetCache } from '../src/scrapers/komiku.js'

const card = (slug, title, rating, cls = 'trend-card') =>
  `<article class="${cls}"><a href="/manga/${slug}"><img src="https://cdn.komiku.asia/c/${slug}.jpg"></a>` +
  `<h3>${title}</h3><span aria-label="Rating ${rating}"></span><span>Chapter 12</span></article>`

const HOME = `<html><body>
  ${card('solo-leveling', 'Solo Leveling', '9.1')}
  ${card('tower-of-god', 'Tower of God', '8.7')}
</body></html>`

const DETAIL = `<html><head><script type="application/ld+json">${JSON.stringify({
  '@type': 'CreativeWorkSeries',
  name: 'Solo Leveling',
  genre: ['Action', 'Fantasy'],
  description: 'Sinopsis singkat',
  image: 'https://cdn.komiku.asia/c/solo-leveling.jpg',
  author: { name: 'Chugong' },
  aggregateRating: { ratingValue: '9.1' }
})}</script></head><body>
  <a href="/read/id/solo-leveling/ch2">Chapter 2</a>
  <a href="/read/id/solo-leveling/ch10">Chapter 10</a>
  <a href="/read/id/solo-leveling/ch1">Chapter 1</a>
</body></html>`

const READER = `<html><body><div class="rd-ch-title">Chapter 2</div><div id="kompaca-reader">
  <img class="rd-page-image" src="https://cdn.komiku.asia/p/1.jpg">
  <img class="rd-page-image" src="https://cdn.komiku.asia/p/logo.png">
  <img class="rd-page-image" src="https://cdn.komiku.asia/p/2.jpg">
</div></body></html>`

let routes, hits
const realFetch = globalThis.fetch
beforeEach(() => {
  resetCache()
  hits = []
  routes = new Map()
  globalThis.fetch = async url => {
    const u = new URL(url)
    hits.push(u.pathname + u.search)
    const hit = routes.get(u.pathname + u.search) ?? routes.get(u.pathname)
    return hit === undefined ? new Response('nf', { status: 404 }) : new Response(hit, { status: 200 })
  }
})
test.after(() => (globalThis.fetch = realFetch))

test('popular: kartu terbaca lengkap + host gambar didaftarkan', async () => {
  routes.set('/', HOME)
  const p = await komiku.popular({ limit: 10 })
  assert.deepEqual(p.map(x => x.slug), ['solo-leveling', 'tower-of-god'])
  assert.equal(p[0].title, 'Solo Leveling')
  assert.equal(p[0].rating, 9.1)
  assert.equal(p[0].cover, 'https://cdn.komiku.asia/c/solo-leveling.jpg')
  assert.equal(p[0].latestChapter, '12')
  assert.ok(komiku.imageHosts.includes('cdn.komiku.asia'))
})

test('search: query kosong tidak memanggil situs; query terisi di-encode', async () => {
  assert.deepEqual(await komiku.search('  '), [])
  assert.equal(hits.length, 0)
  routes.set('/browse?q=solo+leveling', HOME)
  routes.set('/browse?q=solo%20leveling', HOME)
  const r = await komiku.search('solo leveling', { limit: 1 })
  assert.equal(r.length, 1)
})

test('detail: JSON-LD terbaca, chapter urut terbaru → terlama', async () => {
  routes.set('/manga/solo-leveling', DETAIL)
  const d = await komiku.detail('solo-leveling')
  assert.equal(d.title, 'Solo Leveling')
  assert.deepEqual(d.genres, ['Action', 'Fantasy'])
  assert.equal(d.author, 'Chugong')
  assert.equal(d.rating, 9.1)
  assert.deepEqual(d.chapters.map(c => c.slug), ['ch10', 'ch2', 'ch1'])
  assert.deepEqual(d.chapters.map(c => c.number), ['10', '2', '1'])
})

test('detail: halaman kosong → error 404', async () => {
  routes.set('/manga/hilang', '<html><body></body></html>')
  await assert.rejects(komiku.detail('hilang'), e => e.status === 404)
})

test('chapter: gambar logo dibuang, prev/next dari daftar chapter', async () => {
  routes.set('/manga/solo-leveling', DETAIL)
  routes.set('/read/id/solo-leveling/ch2', READER)
  const c = await komiku.chapter('solo-leveling', 'ch2')
  assert.deepEqual(c.images, ['https://cdn.komiku.asia/p/1.jpg', 'https://cdn.komiku.asia/p/2.jpg'])
  assert.equal(c.totalImages, 2)
  assert.equal(c.number, '2')
  assert.equal(c.prev, 'ch1')
  assert.equal(c.next, 'ch10')
})

test('chapter: tanpa gambar → error 404', async () => {
  routes.set('/read/id/x/ch1', '<html><body></body></html>')
  await assert.rejects(komiku.chapter('x', 'ch1'), e => e.status === 404)
})
