import test from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createCatalog } from '../src/catalog-sync.js'
import { createExternalMeta, pickMatch, toFields } from '../src/external-meta.js'
import { normalizeDetail, normalizeItem, normChapter, canonType } from '../src/normalize.js'
import { normTitle, parseWhen, recordFromDetail, fillItem, fillDetail, finalizeItem, finalizeDetail, sameWork, describe, DAY_MS } from '../src/completeness.js'
import { quiet, listen } from './helpers.mjs'
import { fakeDb } from './fake-mongo.mjs'

const NOW = Date.parse('2026-11-07T06:00:00Z')
const iso = ms => new Date(ms).toISOString()

test('normTitle: aksen, huruf besar, tanda baca diabaikan', () => {
  assert.equal(normTitle('Solo  Leveling!'), normTitle('solo-leveling'))
  assert.equal(normTitle('Café Épique'), 'cafeepique')
})

test('parseWhen: relatif Indonesia/Inggris, ISO, epoch', () => {
  assert.equal(parseWhen('3 jam yang lalu', NOW), NOW - 3 * 3_600_000)
  assert.equal(parseWhen('2 days ago', NOW), NOW - 2 * DAY_MS)
  assert.equal(parseWhen('kemarin', NOW), NOW - DAY_MS)
  assert.equal(parseWhen('2026-11-06T06:00:00Z', NOW), NOW - DAY_MS)
  assert.equal(parseWhen('1762500000', NOW), 1762500000 * 1000)
  assert.equal(parseWhen('bukan waktu', NOW), null)
})

test('normalisasi: Manta "comic" = webtoon; chapter yang hanya punya tanggal rilis tetap punya waktu update', () => {
  assert.equal(canonType('comic'), 'webtoon')
  assert.equal(canonType('', ['Romance', 'Manhwa']), 'manhwa')
  const c = normChapter({ slug: '1', number: '1', releaseDate: '2026-11-06T06:00:00.000Z' })
  assert.equal(c.timeAgo, '2026-11-06T06:00:00.000Z')
  assert.equal(normChapter({ slug: '1', number: '1', releaseDate: 1762495200000 }).timeAgo, '2025-11-07T06:00:00.000Z')
  assert.equal(normChapter({ slug: '1', timeAgo: '3 jam lalu', releaseDate: '2026-11-06' }).timeAgo, '3 jam lalu')
  assert.equal(normChapter({ slug: '1' }).timeAgo, '')
})

const detail = {
  title: 'Solo Leveling',
  slug: 'solo',
  cover: 'https://img/c.jpg',
  type: 'manhwa',
  status: 'completed',
  rating: 9.1,
  views: 5000,
  genres: ['Action', 'Fantasy'],
  author: 'Chugong',
  artist: 'DUBU',
  year: '2018',
  synopsis: 'Hunter terlemah.',
  alt: ['나 혼자만 레벨업'],
  totalChapters: 3,
  chapters: [
    { slug: 'c3', number: '3', title: 'Chapter 3', releaseDate: '2026-11-06T06:00:00.000Z' },
    { slug: 'c2', number: '2', releaseDate: '2019-02-01T00:00:00.000Z' },
    { slug: 'c1', number: '1', releaseDate: '2018-03-04T00:00:00.000Z' }
  ]
}

test('recordFromDetail: hanya data asli sumber + chapter terbaru + tahun chapter pertama', () => {
  const r = recordFromDetail({ ...detail, year: '' }, 'beta', NOW)
  assert.equal(r._id, 'beta|solo')
  assert.equal(r.year, '')
  assert.equal(r.firstYear, '2018')
  assert.equal(r.latest.number, '3')
  assert.equal(r.latest.releaseDate, '2026-11-06T06:00:00.000Z')
  assert.equal(r.srcViews, 5000)
})

test('fillItem: hanya mengisi yang kosong, tidak menimpa, dan tidak mengubah objek asli', () => {
  const rec = recordFromDetail(detail, 'beta', NOW)
  const item = Object.freeze({ title: 'Solo Leveling', slug: 'solo', cover: '', type: '', status: '', rating: 7.7, genres: [], author: '', chapters: [], chapterCount: null, source: 'beta' })
  const out = fillItem(item, rec)
  assert.notEqual(out, item)
  assert.equal(out.rating, 7.7)
  assert.equal(out.cover, 'https://img/c.jpg')
  assert.deepEqual(out.genres, ['Action', 'Fantasy'])
  assert.equal(out.author, 'Chugong')
  assert.equal(out.artist, 'DUBU')
  assert.equal(out.chapterCount, 3)
  assert.equal(out.chapters[0].number, '3')
  assert.equal(out.chapters[0].timeAgo, '2026-11-06T06:00:00.000Z')
  const full = { ...out }
  assert.equal(fillItem(full, rec), full)
})

test('fillItem: chapter terbaru dari daftar tanpa waktu dilengkapi dari rekaman', () => {
  const rec = recordFromDetail(detail, 'beta', NOW)
  const out = fillItem({ slug: 'solo', chapters: [{ slug: 'c3', number: '3', timeAgo: '' }] }, rec)
  assert.equal(out.chapters[0].timeAgo, '2026-11-06T06:00:00.000Z')
  const other = fillItem({ slug: 'solo', chapters: [{ slug: 'x', number: '99', timeAgo: '' }] }, rec)
  assert.equal(other.chapters[0].timeAgo, '')
})

test('sameWork: judul identik, jenis tidak boleh bertentangan', () => {
  const a = recordFromDetail(detail, 'beta', NOW)
  assert.equal(sameWork(a, { ...a, _id: 'alpha|x', type: 'webtoon' }), true)
  assert.equal(sameWork(a, { ...a, _id: 'alpha|x', type: 'manga' }), false)
  assert.equal(sameWork(a, a), false)
  const short = { ...a, nt: 'abc' }
  assert.equal(sameWork(short, { ...short, _id: 'z' }), false)
})

test('finalizeItem: nilai turunan dicatat di `derived`, views = sumber + Komikta', () => {
  const out = finalizeItem({ title: 'A', slug: 'a', type: '', status: '', author: '', artist: 'Budi', viewCount: 10, views: 5, chapters: [{ number: '1', timeAgo: iso(NOW - DAY_MS) }], source: 'manta' }, 'manta', NOW)
  assert.equal(out.type, 'webtoon')
  assert.equal(out.status, 'ongoing')
  assert.equal(out.author, 'Budi')
  assert.equal(out.viewCount, 15)
  assert.deepEqual(out.derived.sort(), ['author', 'status', 'type'])
  const old = finalizeItem({ title: 'A', slug: 'a', status: '', chapters: [{ number: '1', timeAgo: iso(NOW - 200 * DAY_MS) }] }, 'lumos', NOW)
  assert.equal(old.status, 'hiatus')
  const real = finalizeItem({ title: 'A', slug: 'a', type: 'manga', status: 'completed', author: 'X', artist: 'Y', chapters: [] }, 'lumos', NOW)
  assert.equal(real.derived, undefined)
  assert.equal(real.viewCount, 0)
})

test('finalizeDetail: sinopsis dibuat dari metadata bila kosong, tahun dari chapter pertama', () => {
  const rec = recordFromDetail({ ...detail, year: '', synopsis: '' }, 'beta', NOW)
  const filled = fillDetail({ ...detail, year: '', synopsis: '', status: 'completed' }, rec)
  assert.equal(filled.year, '2018')
  const out = finalizeDetail(filled, 'beta', NOW)
  assert.match(out.synopsis, /^Solo Leveling adalah manhwa bergenre Action dan Fantasy yang sudah tamat\./)
  assert.match(out.synopsis, /Karya Chugong, ilustrasi oleh DUBU\./)
  assert.match(out.synopsis, /Tersedia 3 chapter di beta, diperbarui terakhir 6 November 2026\./i)
  assert.ok(out.derived.includes('synopsis') && out.derived.includes('year'))
  assert.equal(finalizeDetail({ ...detail }, 'beta', NOW).synopsis, 'Hunter terlemah.')
  assert.ok(describe({ title: 'X', chapters: [] }, 'manta', NOW).startsWith('X adalah komik'))
})

const media = (over = {}) => ({
  id: 1, format: 'MANGA', status: 'RELEASING', countryOfOrigin: 'KR', averageScore: 87, popularity: 100, startDate: { year: 2019 },
  genres: ['Action', 'Romance'], description: 'Cerita.<br>Baris dua. (Source: Wiki)',
  title: { romaji: 'Solo Leveling', english: 'Solo Leveling', native: '나 혼자만 레벨업' }, synonyms: ['Only I Level Up'],
  staff: { edges: [{ role: 'Story', node: { name: { full: 'Chugong' } } }, { role: 'Art', node: { name: { full: 'DUBU' } } }] },
  ...over
})

test('AniList: kecocokan harus yakin (judul sama persis, asal negara tidak bertentangan)', () => {
  assert.equal(pickMatch([media()], { title: 'Solo-Leveling' }).id, 1)
  assert.equal(pickMatch([media()], { title: 'Only I Level Up' }).id, 1)
  assert.equal(pickMatch([media()], { title: 'Solo Leveling Ragnarok' }), null)
  assert.equal(pickMatch([media()], { title: 'Solo Leveling', type: 'manga' }), null)
  assert.equal(pickMatch([media()], { title: 'Solo Leveling', type: 'webtoon' }).id, 1)
  assert.equal(pickMatch([media({ format: 'NOVEL' })], { title: 'Solo Leveling' }), null)
  assert.equal(pickMatch([media({ id: 2, popularity: 5 }), media({ id: 3, popularity: 50 })], { title: 'Solo Leveling' }).id, 3)
})

test('AniList: kolom katalog dari satu media', () => {
  const f = toFields(media())
  assert.equal(f.rating, 8.7)
  assert.equal(f.year, '2019')
  assert.equal(f.status, 'ongoing')
  assert.equal(f.type, 'manhwa')
  assert.deepEqual(f.genres, ['Action', 'Romance'])
  assert.equal(f.author, 'Chugong')
  assert.equal(f.artist, 'DUBU')
  assert.equal(f.synopsis, 'Cerita.\nBaris dua.')
  assert.deepEqual(toFields(media({ averageScore: null, meanScore: null, staff: null, genres: [], description: '' })).rating, undefined)
})

const fakeFetch = (handler) => {
  const calls = []
  const fn = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body.variables.s)
    return handler(body.variables.s, calls.length)
  }
  fn.calls = calls
  return fn
}
const json = (data, status = 200, headers = {}) => ({ ok: status < 400, status, headers: { get: k => headers[k.toLowerCase()] }, json: async () => data })

test('AniList lookup: cocok, tidak cocok, dan 429 menjeda permintaan berikutnya', async () => {
  let t = NOW
  const f = fakeFetch((s, n) => (n === 3 ? json({}, 429, { 'retry-after': '30' }) : json({ data: { Page: { media: s === 'Solo Leveling' ? [media()] : [] } } })))
  const meta = createExternalMeta({ fetchImpl: f, now: () => t, sleep: async () => {}, logger: quiet })
  const hit = await meta.lookup({ title: 'Solo Leveling' })
  assert.equal(hit.ok, true)
  assert.equal(hit.data.rating, 8.7)
  const none = await meta.lookup({ title: 'Tidak Ada' })
  assert.deepEqual([none.ok, none.data], [true, null])
  assert.equal((await meta.lookup({ title: 'Kena Limit' })).ok, false)
  assert.equal((await meta.lookup({ title: 'Setelah Limit' })).ok, false)
  assert.equal(f.calls.length, 3)
  t += 31_000
  assert.equal((await meta.lookup({ title: 'Solo Leveling' })).ok, true)
  const off = createExternalMeta({ enabled: false, fetchImpl: f, logger: quiet })
  assert.equal((await off.lookup({ title: 'Solo Leveling' })).ok, false)
})

function makeProviders(log = { detail: [], fail: new Set() }) {
  const base = { imageHeaders: {}, imageHosts: ['x.local'], base: 'http://x.local' }
  const alpha = {
    ...base, id: 'alpha', name: 'Alpha', filters: { types: ['manhwa'] },
    async latest() { return [{ title: 'Solo Leveling', slug: 'solo' }, { title: 'Misteri', slug: 'misteri' }, { title: 'Rusak', slug: 'rusak' }] },
    async search() { return this.latest() },
    async browse({ page }) { return { items: await this.latest(), page, pages: 1, total: 3 } },
    async detail(slug) {
      log.detail.push(`alpha|${slug}`)
      if (log.fail.has(slug)) throw new Error('upstream rusak')
      if (slug === 'solo') return { title: 'Solo Leveling', slug, cover: 'https://x.local/a.jpg', type: 'comic', status: '', author: '', chapters: [{ slug: 'c9', number: '9', releaseDate: '2026-11-06T06:00:00Z' }, { slug: 'c1', number: '1', releaseDate: '2020-01-01T00:00:00Z' }], genres: [], synopsis: '' }
      return { title: 'Misteri', slug, cover: 'https://x.local/m.jpg', type: 'manhwa', status: 'ongoing', author: 'Ani', artist: 'Ani', genres: ['Mystery'], rating: 6.5, views: 120, chapters: [{ slug: 'm2', number: '2', timeAgo: '3 jam yang lalu' }], synopsis: 'Kasus aneh.' }
    },
    async chapter() { return { images: [] } }
  }
  const beta = {
    ...base, id: 'beta', name: 'Beta',
    async latest() { return [] },
    async search() { return [] },
    async browse() { return { items: [{ title: 'Solo Leveling', slug: 'solo-b' }], page: 1, pages: 1, total: 1 } },
    async detail(slug) {
      log.detail.push(`beta|${slug}`)
      return { title: 'Solo Leveling', slug, cover: 'https://x.local/b.jpg', type: 'manhwa', status: 'completed', rating: 9.1, genres: ['Action', 'Fantasy'], author: 'Chugong', artist: 'DUBU', year: '2018', synopsis: 'Hunter terlemah.', chapters: [{ slug: 'b9', number: '9', releaseDate: '2026-11-06T06:00:00Z' }] }
    },
    async chapter() { return { images: [] } }
  }
  const all = new Map([['alpha', alpha], ['beta', beta]])
  return {
    log,
    has: id => all.has(id),
    get: id => all.get(id),
    list: () => [...all.values()].map(p => ({ id: p.id, name: p.name, base: p.base, filters: p.filters || {}, features: ['search', 'latest', 'browse', 'detail', 'chapter'] })),
    findByImageHost: () => null,
    async searchAll(q, o) {
      const items = (await alpha.search(q, o)).map(x => ({ ...x, source: 'alpha' }))
      return { items, failed: [] }
    }
  }
}

const boot = async ({ external = null, db = null, ...opts } = {}) => {
  const registry = makeProviders()
  const community = db ? { c: { catalog: db } } : null
  const catalog = createCatalog({ registry, logger: quiet, external, crawl: false, collection: () => community?.c.catalog ?? null, crawlDelayMs: 0, ...opts })
  const app = createApp({ registry, config: loadConfig({ LOG_REQUESTS: 'false', RATE_LIMIT_MAX: '100000' }), logger: quiet, catalog })
  const srv = await listen(app.handler)
  const get = async path => (await fetch(`${srv.url}${path}`)).json()
  return { registry, catalog, app, get, close: () => { srv.server.close(); app.close(); catalog.close() } }
}

test('daftar yang bolong dilengkapi dari detail yang disinkronkan; yang rusak tidak menggagalkan respons', async () => {
  const t = await boot()
  try {
    t.registry.log.fail.add('rusak')
    const { data } = await t.get('/api/alpha/latest')
    const by = Object.fromEntries(data.items.map(i => [i.slug, i]))
    assert.equal(by.solo.cover, 'https://x.local/a.jpg')
    assert.equal(by.solo.type, 'webtoon')
    assert.equal(by.solo.chapters[0].number, '9')
    assert.equal(by.solo.chapters[0].timeAgo, '2026-11-06T06:00:00.000Z')
    assert.equal(by.solo.status, 'ongoing')
    assert.ok(by.solo.derived.includes('status'))
    assert.deepEqual(by.misteri.genres, ['Mystery'])
    assert.equal(by.misteri.author, 'Ani')
    assert.equal(by.misteri.rating, 6.5)
    assert.equal(by.misteri.viewCount, 120)
    assert.ok(Math.abs(Date.now() - 3 * 3_600_000 - Date.parse(by.misteri.chapters[0].timeAgo)) < 60_000)
    assert.equal(by.rusak.title, 'Rusak')
    assert.equal(by.rusak.status, 'ongoing')
    const before = t.registry.log.detail.length
    await t.get('/api/alpha/latest')
    assert.equal(t.registry.log.detail.length, before)
  } finally {
    t.close()
  }
})

test('komik yang sama di sumber lain melengkapi rating, author, artist, tahun, status', async () => {
  const t = await boot()
  try {
    await t.catalog.ensure('beta', 'solo-b', 'inline')
    const { data } = await t.get('/api/alpha/latest')
    const solo = data.items.find(i => i.slug === 'solo')
    assert.equal(solo.rating, 9.1)
    assert.equal(solo.author, 'Chugong')
    assert.equal(solo.artist, 'DUBU')
    assert.equal(solo.year, '2018')
    assert.equal(solo.status, 'completed')
    assert.deepEqual(solo.genres, ['Action', 'Fantasy'])
    assert.equal(solo.derived, undefined)
    const d = (await t.get('/api/alpha/comic/solo')).data
    assert.equal(d.synopsis, 'Hunter terlemah.')
    assert.equal(d.rating, 9.1)
  } finally {
    t.close()
  }
})

test('detail: kolom kosong dilengkapi metadata luar sekali, lalu tersimpan; match yang tidak ada tidak dicari ulang', async () => {
  let n = 0
  const external = {
    enabled: true,
    stats: () => ({}),
    async lookup({ title }) {
      n++
      return title === 'Solo Leveling' ? { ok: true, id: 7, data: { rating: 8.7, artist: 'DUBU', author: 'Chugong', year: '2019', status: 'ongoing', type: 'manhwa', genres: ['Action'], synopsis: 'Dari AniList.' } } : { ok: true, id: null, data: null }
    }
  }
  const t = await boot({ external })
  try {
    const d = (await t.get('/api/alpha/comic/solo')).data
    assert.equal(d.rating, 8.7)
    assert.equal(d.author, 'Chugong')
    assert.equal(d.type, 'manhwa')
    assert.equal(d.status, 'ongoing')
    assert.equal(d.synopsis, 'Dari AniList.')
    assert.equal(d.cover, 'https://x.local/a.jpg')
    await t.get('/api/alpha/comic/solo')
    assert.equal(n, 1)
    await t.get('/api/alpha/comic/misteri')
    await t.get('/api/alpha/comic/misteri')
    assert.equal(n, 2)
  } finally {
    t.close()
  }
})

test('rekaman disimpan ke MongoDB dan dibaca lagi setelah restart (memori kosong)', async () => {
  const db = fakeDb().collection('comic_catalog')
  const a = await boot({ db })
  await a.get('/api/alpha/latest')
  a.close()
  assert.ok(db.docs.some(d => d._id === 'alpha|misteri' && d.title === 'Misteri' && d.nt === 'misteri'))
  const b = await boot({ db })
  try {
    const before = b.registry.log.detail.length
    const { data } = await b.get('/api/alpha/latest')
    assert.equal(b.registry.log.detail.length, before)
    assert.equal(data.items.find(i => i.slug === 'misteri').author, 'Ani')
  } finally {
    b.close()
  }
})

test('item di luar batas inline diselesaikan di latar belakang', async () => {
  const t = await boot({ inlineMax: 1, inlineBudgetMs: 1000 })
  try {
    await t.get('/api/alpha/latest')
    for (let i = 0; i < 100 && t.catalog.status().records < 3; i++) await new Promise(r => setTimeout(r, 20))
    assert.equal(t.catalog.status().records, 3)
    const { data } = await t.get('/api/alpha/latest')
    assert.ok(data.items.every(i => i.cover))
  } finally {
    t.close()
  }
})

test('crawler menelusuri browse tiap sumber dan menyimpan kursor', async () => {
  const db = fakeDb().collection('comic_catalog')
  const t = await boot({ db })
  try {
    const st = await t.catalog.crawlOnce()
    assert.ok(st.synced >= 3, JSON.stringify(st))
    const keys = db.docs.map(d => d._id)
    assert.ok(keys.includes('alpha|solo') && keys.includes('beta|solo-b'))
    assert.ok(db.docs.some(d => d._id === '__cursor__'))
    const again = await t.catalog.crawlOnce()
    assert.equal(again.synced, 0)
    assert.ok(again.skipped >= 3)
    const status = t.catalog.status()
    assert.equal(status.bySource.beta.records, 1)
  } finally {
    t.close()
  }
})

test('normalizeItem membawa artist & year dan tidak merusak bentuk lama', () => {
  const it = normalizeItem({ title: 'A', slug: 'a', artist: '-', year: '2020' }, 'x')
  assert.equal(it.artist, '')
  assert.equal(it.year, '2020')
  assert.equal(normalizeDetail({ title: 'A', slug: 'a', chapters: [{ slug: '1', number: '1', releaseDate: '2026-11-06T06:00:00Z' }] }, 'x').chapters[0].timeAgo, '2026-11-06T06:00:00.000Z')
})
