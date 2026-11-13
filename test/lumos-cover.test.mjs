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
