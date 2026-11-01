import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { encrypt, decrypt } from '../src/scrapers/softkomik-crypto.js'
import softkomik, { resetCache } from '../src/scrapers/softkomik.js'

const fx = n => fs.readFileSync(new URL(`./fixtures/softkomik-${n}.stk.txt`, import.meta.url), 'utf8').trim()
const page = pageProps =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps } })}</script></body></html>`

const SLUG = 'debut-or-die-bahasa-indonesia'
const comic = n => ({ title: `Komik ${n}`, title_slug: `komik-${n}`, gambar: `image-cover/k${n}.jpg`, type: 'manhwa', status: 'ongoing', latest_chapter: '12', Genre: ['Action'] })

// peta path → HTML / JSON; fetch dipalsukan supaya tes tidak butuh internet
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

test('crypto: encrypt ↔ decrypt bolak-balik', () => {
  assert.deepEqual(decrypt(encrypt({ a: 1, b: ['x'] })), { a: 1, b: ['x'] })
})

test('crypto: payload asli situs bisa didekripsi', () => {
  assert.equal(decrypt(fx('detail')).data.title_slug, SLUG)
})

test('detail: memakai _stk terenkripsi dan lengkap', async () => {
  routes.set(`/${SLUG}`, page({ _stk: fx('detail'), isAuthenticated: false }))
  const d = await softkomik.detail(SLUG)
  assert.equal(d.title, 'Debut or Die')
  assert.equal(d.slug, SLUG)
  assert.match(d.cover, /^https:\/\/cover\.softdevices\.my\.id\/softkomik-cover\/image-cover\/debut-or-die\.jpeg$/)
  assert.deepEqual(d.genres, ['Drama', 'Fantasy', 'Mature'])
  assert.equal(d.type, 'manhwa')
  assert.equal(d.status, 'ongoing')
  assert.ok(d.synopsis.length > 50)
  assert.ok(d.alt.length >= 2)
  assert.equal(d.rating, 4.97)
  assert.equal(d.ratingCount, 70)
  assert.equal(d.totalChapters, 123)
  assert.equal(d.chapters[0].slug, '121')
  assert.equal(d.chapters[0].isNew, true)
  assert.equal(d.chapters.at(-1).slug, '000')
  assert.equal(d.chapters.at(-1).number, '0')
  assert.ok(d.chapters.some(c => c.slug === '065.5' && c.number === '65.5'))
  assert.equal(d.firstChapter, '000')
  assert.equal(d.latestChapter, '121')
})

test('detail: tidak ada data → 404', async () => {
  routes.set('/nope', page({ isAuthenticated: false }))
  await assert.rejects(softkomik.detail('nope'), e => e.status === 404)
})

test('chapter: gambar, prev/next, nomor berpadding', async () => {
  routes.set(`/${SLUG}`, page({ _stk: fx('detail') }))
  routes.set(`/${SLUG}/chapter/000`, page({ _stk: fx('chapter') }))
  const c = await softkomik.chapter(SLUG, '0')
  assert.equal(c.chapter, '000')
  assert.equal(c.comicTitle, 'Debut or Die')
  assert.equal(c.images.length, 56)
  assert.match(c.images[0], /^https:\/\/psy1\.komik\.im\/img-file\/debut-or-die-bahasa-indonesia\/chapter-000\/softkomik-0-/)
  assert.equal(c.totalImages, 56)
  assert.equal(c.prev, null)
  assert.equal(c.next, '001')
})

test('list: search/latest/browse tetap jalan dengan initialData polos', async () => {
  const initialData = { data: [comic(1), comic(2)], maxPage: 7 }
  routes.set('/komik/list', page({ initialData }))
  routes.set('/komik/update', page({ initialData }))
  const s = await softkomik.search('x', { limit: 1 })
  assert.equal(s.length, 1)
  assert.equal(s[0].slug, 'komik-1')
  assert.equal((await softkomik.latest()).length, 2)
  const b = await softkomik.browse({ q: 'x' })
  assert.equal(b.pages, 7)
})

test('list: initialData terenkripsi juga terbaca', async () => {
  routes.set('/komik/update', page({ _stk: encrypt({ initialData: { data: [comic(3)], maxPage: 2 } }) }))
  const l = await softkomik.latest()
  assert.equal(l[0].slug, 'komik-3')
})

test('popular: beranda kosong → jatuh ke daftar update, tidak kosong', async () => {
  routes.set('/', page({ data: { updateProject: [], updateNonProject: [] } }))
  routes.set('/komik/update', page({ initialData: { data: [comic(1), comic(2)], maxPage: 1 } }))
  const p = await softkomik.popular({ limit: 5 })
  assert.equal(p.length, 2)
})

test('popular: beranda terenkripsi dengan struktur baru tetap ketemu', async () => {
  routes.set('/', page({ _stk: encrypt({ data: { sections: { hot: [comic(9)] } } }) }))
  const p = await softkomik.popular({ limit: 5 })
  assert.equal(p[0].slug, 'komik-9')
})
