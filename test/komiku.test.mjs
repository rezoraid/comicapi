import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import komiku, { resetCache } from '../src/scrapers/komiku.js'

const card = slug =>
  `<div class="bge"><a href="/manga/${slug}/"><img src="https://img.example/${slug}.jpg"></a>` +
  `<h3>${slug.replaceAll('-', ' ')}</h3><span>Chapter 12</span></div>`

let routes
let requested
const realFetch = globalThis.fetch

beforeEach(() => {
  resetCache()
  routes = new Map()
  requested = []
  globalThis.fetch = async input => {
    const url = new URL(input)
    requested.push(url.href)
    const hit = routes.get(url.host + url.pathname + url.search)
      ?? routes.get(url.pathname + url.search)
      ?? routes.get(url.pathname)
    if (hit === undefined) return new Response('not found', { status: 404 })
    return new Response(hit, { status: 200 })
  }
})

test.after(() => {
  globalThis.fetch = realFetch
})

test('uses Komiku canonical domain', () => {
  assert.equal(komiku.base, 'https://komiku.org')
})

test('search uses the public site when its first search path has no results', async () => {
  routes.set('/?s=solo&post_type=manga', '<html><body>no cards</body></html>')
  routes.set('/?s=solo', card('solo-leveling'))

  const items = await komiku.search('solo')

  assert.equal(items.length, 1)
  assert.equal(items[0].slug, 'solo-leveling')
  assert.ok(requested.some(url => url === 'https://komiku.org/?s=solo'))
})

test('listing tries the alternate public endpoint when the first page is empty', async () => {
  routes.set('/daftar-komik/?tipe=manga&orderby=modified', '<html><body>empty</body></html>')
  routes.set('/manga/?tipe=manga&orderby=modified', card('solo-leveling'))
  routes.set('/daftar-komik/?tipe=manhwa&orderby=modified', '<html><body>empty</body></html>')
  routes.set('/manga/?tipe=manhwa&orderby=modified', card('tower-of-god'))

  const items = await komiku.latest({ page: 1 })

  assert.deepEqual(items.map(item => item.slug), ['solo-leveling', 'tower-of-god'])
  assert.ok(requested.some(url => url.startsWith('https://api.komiku.org/manga/')))
})
