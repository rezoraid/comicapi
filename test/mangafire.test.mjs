import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mangafire, { resetCache } from '../src/scrapers/mangafire.js'

const card = (slug, title, type) =>
  `<div class="unit"><div class="inner"><a class="poster" href="/manga/${slug}"><div><img src="https://static.mfcdn.cc/${slug}.jpg"></div></a>` +
  `<div class="info"><div><span class="type">${type}</span></div><a href="/manga/${slug}">${title}</a></div></div></div>`

const LIST = `<html><body><div class="original card-lg">${card('one-piece.dkw', 'One Piece', 'Manga')}${card('solo.abc', 'Solo Leveling', 'Manhwa')}</div>
<ul class="pagination"><li class="page-item"><a class="page-link" href="/filter?page=2">2</a></li><li class="page-item"><a class="page-link" href="/filter?page=7">7</a></li></ul></body></html>`

const CHAPTERS = `<ul><li class="item" data-number="2"><a href="/read/one-piece.dkw/en/chapter-2" data-number="2" data-id="222"><span>Chapter 2: B</span><span>Jan 2, 2025</span></a></li>
<li class="item" data-number="1"><a href="/read/one-piece.dkw/en/chapter-1" data-number="1" data-id="111"><span>Chapter 1: A</span><span>Jan 1, 2025</span></a></li></ul>`

const DETAIL = `<html><head><meta property="og:image" content="https://static.mfcdn.cc/op.jpg"></head><body><div class="info"><p>Releasing</p><h1 itemprop="name">One Piece</h1><h6>Wan Pisu; OP</h6></div>
<div class="poster"><div><img src="https://static.mfcdn.cc/op.jpg"></div></div><div class="description">Bajak laut.</div>
<div class="meta"><div><span>Author:</span><span>Oda</span></div><div><span>Published:</span><span>Jul 22, 1997 to ?</span></div></div>
<a href="/genre/action">Action</a><a href="/genre/adventure">Adventure</a><div class="min-info"><a href="/type/manga">Manga</a></div></body></html>`

let routes
const realFetch = globalThis.fetch
beforeEach(() => {
  resetCache()
  routes = new Map()
  globalThis.fetch = async url => {
    const u = new URL(url)
    const hit = routes.get(u.pathname + u.search) ?? routes.get(u.pathname)
    if (hit === undefined) return new Response('nf', { status: 404 })
    return typeof hit === 'string' ? new Response(hit, { status: 200 }) : new Response(JSON.stringify(hit), { status: 200, headers: { 'content-type': 'application/json' } })
  }
})
test.after(() => (globalThis.fetch = realFetch))

test('browse: kartu & jumlah halaman terbaca', async () => {
  routes.set('/filter', LIST)
  const r = await mangafire.browse({ q: 'one' })
  assert.deepEqual(r.items.map(x => x.slug), ['one-piece.dkw', 'solo.abc'])
  assert.equal(r.items[0].title, 'One Piece')
  assert.equal(r.items[1].type, 'manhwa')
  assert.equal(r.pages, 7)
})

test('search & latest memakai /filter', async () => {
  routes.set('/filter', LIST)
  assert.equal((await mangafire.search('x', { limit: 1 })).length, 1)
  assert.equal((await mangafire.latest({ page: 1 })).length, 2)
})

test('detail: metadata dan chapter dari ajax', async () => {
  routes.set('/manga/one-piece.dkw', DETAIL)
  routes.set('/ajax/manga/dkw/chapter/en', { status: 200, result: CHAPTERS })
  const d = await mangafire.detail('one-piece.dkw')
  assert.equal(d.title, 'One Piece')
  assert.equal(d.status, 'ongoing')
  assert.equal(d.author, 'Oda')
  assert.equal(d.year, '1997')
  assert.deepEqual(d.genres, ['Action', 'Adventure'])
  assert.deepEqual(d.chapters.map(c => c.slug), ['chapter-2', 'chapter-1'])
  assert.deepEqual(d.alt, ['Wan Pisu', 'OP'])
})

test('chapter: gambar, prev & next', async () => {
  routes.set('/ajax/read/dkw/chapter/en', { status: 200, result: { html: CHAPTERS } })
  routes.set('/ajax/read/chapter/111', { status: 200, result: { images: [['https://static.mfcdn.cc/1.jpg', 0, 0], ['https://static.mfcdn.cc/2.jpg', 0, 0]] } })
  const c = await mangafire.chapter('one-piece.dkw', 'chapter-1')
  assert.equal(c.totalImages, 2)
  assert.equal(c.next, 'chapter-2')
  assert.equal(c.prev, null)
})

test('chapter tidak ada → 404', async () => {
  routes.set('/ajax/read/dkw/chapter/en', { result: CHAPTERS })
  await assert.rejects(() => mangafire.chapter('one-piece.dkw', 'chapter-99'), { status: 404 })
})
