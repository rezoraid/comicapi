import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mangaplus, { resetCache } from '../src/scrapers/mangaplus.js'
import { requestScope } from '../src/scrapers/utils.js'

// --- encoder protobuf mini (sama seperti mangaplus.test.mjs) ---
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
const LANG = { eng: 0, esp: 1, fra: 2, ind: 3, ptb: 4, rus: 5, tha: 6, deu: 7, vie: 8 }
const title = (id, name, author, lang) => [v(1, id), l(2, name), l(3, author), l(4, `https://jumpg-assets.tokyo-cdn.com/t/${id}.jpg`), ...(lang && lang !== 'eng' ? [v(7, LANG[lang])] : [])]
const chap = (tid, cid, name, sub, ts) => [v(1, tid), v(2, cid), l(3, name), l(4, sub), v(6, ts)]
const ok = (...parts) => m(1, ...parts)

// Satu serial = satu grup berisi varian bahasa, tiap bahasa punya ID judul sendiri.
const OP = { eng: 100020, ind: 100120, esp: 100220 }
const allTitles = ok(
  m(
    35,
    m(2, l(1, 'Action'), l(2, 'action')),
    m(3, m(2, ...title(OP.eng, 'One Piece', 'Eiichiro Oda', 'eng')), m(2, ...title(OP.ind, 'One Piece', 'Eiichiro Oda', 'ind')), m(2, ...title(OP.esp, 'One Piece', 'Eiichiro Oda', 'esp')), m(3, l(2, 'action'))),
    m(3, m(2, ...title(100021, 'Hi', 'Mr A', 'eng')))
  )
)

const detailFor = id => {
  const lang = Object.entries(OP).find(([, x]) => x === id)?.[0] ?? 'eng'
  const first = chap(id, id * 10 + 1, '#001', `Ch1 ${lang}`, 1600000000)
  const stray = chap(OP.esp + 1, 999999, '#999', 'Chapter bahasa lain', 1600300000) // chapter milik judul lain: tidak boleh ikut
  return ok(m(8, m(1, ...title(id, 'One Piece', 'Eiichiro Oda', lang)), l(3, `Sinopsis ${lang}`), m(10, m(1, ...first)), m(11, m(1, ...chap(id, id * 10 + 2, '#002', `Ch2 ${lang}`, 1600100000)), m(2, ...stray))))
}

const responses = {
  'title_list/all_v3': () => allTitles,
  'title_list/updated': () => ok(m(20, m(1, m(1, ...title(OP.eng, 'One Piece', 'Eiichiro Oda', 'eng')), v(2, 1700000000)), m(1, m(1, ...title(OP.ind, 'One Piece', 'Eiichiro Oda', 'ind')), v(2, 1700000100)))),
  'title_list/rankingV2': () => ok(m(37, m(3, m(2, ...title(100021, 'Hi', 'Mr A', 'eng'))), m(3, m(2, ...title(OP.ind, 'One Piece', 'Eiichiro Oda', 'ind'))))),
  title_detailV4: p => detailFor(Number(p.get('title_id')))
}

const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = (url, opts) => {
    const u = new URL(url)
    if (u.hostname !== 'jumpg-webapi.tokyo-cdn.com') return realFetch(url, opts)
    const make = responses[u.pathname.replace('/api/', '')]
    return Promise.resolve(make ? new Response(make(u.searchParams)) : new Response('', { status: 404 }))
  }
})
after(() => {
  globalThis.fetch = realFetch
})
beforeEach(() => resetCache())

const as = (lang, fn) => requestScope.run({ lang }, fn)

test('search: satu serial hanya muncul sekali, dalam bahasa yang dipilih', async () => {
  const ind = await as('ind', () => mangaplus.search('one piece'))
  assert.deepEqual(ind.map(x => [x.slug, x.lang]), [[String(OP.ind), 'ind']])
  const esp = await as('esp', () => mangaplus.search('one piece'))
  assert.deepEqual(esp.map(x => x.slug), [String(OP.esp)])
  const eng = await as('eng', () => mangaplus.search('one piece'))
  assert.deepEqual(eng.map(x => x.slug), [String(OP.eng)])
})

test('search: bahasa tidak tersedia -> jatuh ke English, bukan hilang / duplikat', async () => {
  const fra = await as('fra', () => mangaplus.search('one piece'))
  assert.deepEqual(fra.map(x => x.slug), [String(OP.eng)])
  const hi = await as('ind', () => mangaplus.search('mr a'))
  assert.deepEqual(hi.map(x => [x.slug, x.lang]), [['100021', 'eng']])
})

test('browse: dihitung per serial, bukan per varian bahasa', async () => {
  const b = await as('ind', () => mangaplus.browse({ page: 1 }))
  assert.equal(b.total, 2)
  assert.deepEqual(b.items.map(x => x.slug), [String(OP.ind), '100021'])
  const g = await as('ind', () => mangaplus.browse({ genre: ['action'] }))
  assert.deepEqual(g.items.map(x => x.slug), [String(OP.ind)])
})

test('latest & popular hanya berisi judul bahasa terpilih', async () => {
  const lat = await as('ind', () => mangaplus.latest({ page: 1 }))
  assert.deepEqual(lat.map(x => x.slug), [String(OP.ind)])
  const pop = await as('ind', () => mangaplus.popular({ limit: 5 }))
  assert.deepEqual(pop.map(x => x.slug), [String(OP.ind)])
  const popEng = await as('eng', () => mangaplus.popular({ limit: 5 }))
  assert.deepEqual(popEng.map(x => x.slug), ['100021'])
})

test('detail: chapter hanya milik bahasa itu + daftar bahasa tersedia dengan ID masing-masing', async () => {
  const d = await mangaplus.detail(String(OP.ind))
  assert.equal(d.language, 'ind')
  assert.equal(d.synopsis, 'Sinopsis ind')
  assert.deepEqual(d.chapters.map(c => c.slug), [String(OP.ind * 10 + 2), String(OP.ind * 10 + 1)])
  assert.ok(d.chapters.every(c => !c.title.includes('bahasa lain')))
  assert.deepEqual(d.languages, [
    { code: 'eng', slug: String(OP.eng) },
    { code: 'ind', slug: String(OP.ind) },
    { code: 'esp', slug: String(OP.esp) }
  ])
  const eng = await mangaplus.detail(String(OP.eng))
  assert.equal(eng.language, 'eng')
  assert.deepEqual(eng.chapters.map(c => c.slug), [String(OP.eng * 10 + 2), String(OP.eng * 10 + 1)])
})

test('detail: serial satu bahasa tidak punya pilihan bahasa lain', async () => {
  const d = await mangaplus.detail('100021')
  assert.deepEqual(d.languages, [{ code: 'eng', slug: '100021' }])
})
