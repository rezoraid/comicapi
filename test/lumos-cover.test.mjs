import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import lumos, { resetCache } from '../src/scrapers/lumos.js'

const realFetch = globalThis.fetch
let calls
beforeEach(() => {
  resetCache()
  calls = []
})
test.after(() => (globalThis.fetch = realFetch))

const mock = routes => {
  globalThis.fetch = async url => {
    const u = new URL(url)
    calls.push(u.pathname)
    const hit = routes[u.pathname]
    if (hit === undefined) return new Response('nf', { status: 404 })
    return typeof hit === 'string'
      ? new Response(hit, { status: 200 })
      : new Response(JSON.stringify(hit), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

test('cover dari JSON: konfigurasi gambar dibaca dari beranda dulu, host CDN baru ikut diizinkan', async () => {
  mock({
    '/': '<script>window.__IMG_CFG__ = {"proxyEnabled":false,"base":"https://cdn-baru.example.net/file"}</script>',
    '/api/home-latest': { data: { items: [{ title: 'A', slug: 'a', coverImage: '/api/image/comic/a/cover.webp', recentChapters: [] }] } }
  })
  const out = await lumos.latest({ page: 1 })
  assert.equal(out[0].cover, 'https://cdn-baru.example.net/file/comic/a/cover.webp')
  assert.ok(lumos.imageHosts.includes('cdn-baru.example.net'))
})

test('cover dari JSON: format asli situs (kunci tanpa kutip, base tanpa /file) → /covers/ di CDN', async () => {
  mock({
    '/': '<script>window.__IMG_CFG__ = { proxyEnabled: false, base: "https://lms.imgsvr.my.id" };</script>',
    '/api/home-latest': { data: { items: [{ title: 'Suit Red', slug: 'suit-red', coverImage: '/api/image/covers/abc123.webp', recentChapters: [] }] } }
  })
  const out = await lumos.latest({ page: 1 })
  assert.equal(out[0].cover, 'https://lms.imgsvr.my.id/covers/abc123.webp')
})

test('imageFallback: CDN → proxy situs, proxy situs → CDN, mirror → mirror berikutnya', () => {
  const fromCdn = lumos.imageFallback(new URL('https://lms.imgsvr.my.id/covers/x.webp'))
  assert.match(fromCdn || '', /^https:\/\/0\d\.lumosgg\.com\/api\/image\/covers\/x\.webp$|^https:\/\/lumoskomik\.com\/api\/image\/covers\/x\.webp$/)
  const fromSite = lumos.imageFallback(new URL('https://03.lumosgg.com/api/image/covers/x.webp'))
  assert.equal(fromSite, 'https://lms.imgsvr.my.id/covers/x.webp')
  const thumb = lumos.imageFallback(new URL('https://03.lumosgg.com/api/image/thumbnail?src=abc&w=640&sig=x'))
  assert.match(thumb || '', /^https:\/\/02\.lumosgg\.com\/api\/image\/thumbnail\?src=abc/)
  assert.equal(lumos.imageFallback(new URL('https://other.example.org/a.png')), null)
})

test('popular: period=weekly + type → /api/popular dipakai sebagai sumber utama', async () => {
  mock({
    '/': '<script>window.__IMG_CFG__ = { proxyEnabled: false, base: "https://lms.imgsvr.my.id" };</script>',
    '/api/popular': { data: [{ title: 'P1', slug: 'p1', coverImage: '/api/image/covers/p1.webp' }, { title: 'P2', slug: 'p2' }] }
  })
  const out = await lumos.popular({ period: 'weekly', type: 'manhwa', limit: 5 })
  assert.deepEqual(out.map(x => x.slug), ['p1', 'p2'])
  assert.equal(out[0].cover, 'https://lms.imgsvr.my.id/covers/p1.webp')
})

test('popular: bentuk JSON tak dikenal tetap terbaca (larik berisi slug)', async () => {
  mock({ '/': '<html></html>', '/api/popular': { payload: { rows: [{ title: 'Z', slug: 'z' }] } } })
  const out = await lumos.popular({ period: 'daily', limit: 5 })
  assert.deepEqual(out.map(x => x.slug), ['z'])
})

test('parseReaderNav: prev/next dibaca dari props island Astro (HTML ter-escape)', async () => {
  const { parseReaderNav } = await import('../src/scrapers/lumos.js')
  const html = '<astro-island props="{&quot;comicSlug&quot;:[0,&quot;x&quot;],&quot;prevChapterSlug&quot;:[0,&quot;chapter-105&quot;],&quot;nextChapterSlug&quot;:[0,null]}"></astro-island>'
  assert.deepEqual(parseReaderNav(html), { prev: 'chapter-105', next: null })
  assert.deepEqual(parseReaderNav('{"prevChapterSlug":[0,"c-1"],"nextChapterSlug":[0,"c-3"]}'), { prev: 'c-1', next: 'c-3' })
  assert.deepEqual(parseReaderNav('<html></html>'), { prev: null, next: null })
})
