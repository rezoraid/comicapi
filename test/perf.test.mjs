import test from 'node:test'
import assert from 'node:assert/strict'
import { gunzipSync } from 'node:zlib'
import { TtlCache } from '../src/lib/cache.js'
import { createTtlMap } from '../src/lib/ttl-map.js'
import { encode, etagMatches } from '../src/http/respond.js'
import { createRateLimiter } from '../src/http/middleware.js'
import { createProgressWriter } from '../src/community/progress-writer.js'
import { createCommunity } from '../src/community/index.js'
import { startCommunity } from '../src/community/lifecycle.js'
import { createGoogleVerifier } from '../src/community/google.js'
import { loginWithGoogle, authenticate, publicUser } from '../src/community/users.js'
import { saveProgress, trackReadingTime } from '../src/community/reading.js'
import { listActivity } from '../src/community/profile.js'
import { createComment, chapterCounts, listComments, removeComment } from '../src/community/comments.js'
import { setLike, likeStatus } from '../src/community/likes.js'
import { deleteAccount } from '../src/community/account.js'
import { loadConfig } from '../src/config.js'
import { quiet } from './helpers.mjs'
import { fakeDb } from './fake-mongo.mjs'

const sleep = ms => new Promise(r => setTimeout(r, ms))

/* ───────── cache: stale-while-revalidate, backoff, batas byte ───────── */

test('cache SWR: entri kedaluwarsa disajikan langsung (STALE) sementara refresh jalan di background', async () => {
  const c = new TtlCache({ staleMs: 60_000 })
  let calls = 0
  const loader = async () => ({ v: ++calls })
  assert.deepEqual((await c.remember('k', 40, loader)).value, { v: 1 })
  await sleep(50) // lewat TTL (40ms) tapi masih di jendela SWR (80ms)
  let release
  const slow = () => new Promise(r => (release = () => r({ v: 2 })))
  const t0 = Date.now()
  const r = await c.remember('k', 40, slow)
  assert.equal(r.state, 'STALE')
  assert.deepEqual(r.value, { v: 1 })
  assert.ok(Date.now() - t0 < 20, 'tidak menunggu loader lambat')
  // request lain selama refresh berjalan tidak memicu loader kedua
  let extra = 0
  await c.remember('k', 40, async () => (extra++, { v: 99 }))
  assert.equal(extra, 0)
  release()
  await sleep(5)
  const fresh = await c.remember('k', 40, loader)
  assert.deepEqual([fresh.state, fresh.value], ['HIT', { v: 2 }])
})

test('cache SWR: refresh background yang gagal ditahan (backoff) dan data lama tetap dilayani', async () => {
  const errors = []
  const c = new TtlCache({ staleMs: 60_000, retryMs: 60_000, onError: (k, e) => errors.push(e.message) })
  await c.remember('k', 40, async () => 'lama')
  await sleep(50)
  let calls = 0
  const boom = async () => (calls++, Promise.reject(new Error('sumber down')))
  assert.equal((await c.remember('k', 40, boom)).state, 'STALE')
  await sleep(5)
  assert.equal((await c.remember('k', 40, boom)).state, 'STALE')
  await sleep(5)
  assert.equal(calls, 1, 'tidak menghajar sumber yang sedang down tiap request')
  assert.deepEqual(errors, ['sumber down'])
})

test('cache: di luar jendela SWR, request menunggu data baru (MISS) dan refresh yang sama dipakai bersama', async () => {
  const c = new TtlCache({ staleMs: 60_000 })
  await c.remember('k', 5, async () => 'lama')
  await sleep(30) // jauh lewat 2×TTL
  let calls = 0
  const loader = async () => (await sleep(10), `baru${++calls}`)
  const [a, b] = await Promise.all([c.remember('k', 5, loader), c.remember('k', 5, loader)])
  assert.deepEqual([a.state, b.state, a.value, b.value, calls], ['MISS', 'MISS', 'baru1', 'baru1', 1])
})

test('cache: batas total byte menyingkirkan entri tertua dan menolak satu entri raksasa', () => {
  const big = n => ({ body: Buffer.alloc(n), gzipped: null })
  const c = new TtlCache({ max: 100, maxBytes: 1000, sizeOf: v => v.body.length })
  c.set('a', big(400), 1000)
  c.set('b', big(400), 1000)
  c.set('c', big(400), 1000) // total 1200 > 1000 → 'a' (tertua) keluar
  assert.deepEqual([...c.map.keys()], ['b', 'c'])
  assert.equal(c.bytes, 800)
  c.set('raksasa', big(5000), 1000)
  assert.equal(c.map.has('raksasa'), false)
  c.set('b', big(100), 1000) // timpa entri yang ada → byte dihitung ulang, bukan ditambah
  assert.equal(c.bytes, 500)
})

test('ttl-map: kedaluwarsa, hapus, dan batas jumlah', () => {
  let t = 0
  const m = createTtlMap({ ttlMs: 100, max: 2, now: () => t })
  m.set('a', 1)
  assert.equal(m.get('a'), 1)
  t = 101
  assert.equal(m.get('a'), undefined)
  m.set('x', 1); m.set('y', 2); m.set('z', 3)
  assert.equal(m.size, 2)
  m.delete('y')
  assert.equal(m.get('y'), undefined)
})

/* ───────── HTTP: gzip lazy, ETag, rate limiter ───────── */

test('encode: gzip hanya kalau diminta dan payload cukup besar', async () => {
  const big = { items: Array.from({ length: 200 }, (_, i) => ({ i, t: 'komik '.repeat(5) })) }
  const lazy = await encode(big, { gzip: false })
  assert.equal(lazy.gzipped, null)
  const eager = await encode(big, { level: 4 })
  assert.ok(eager.gzipped && eager.gzipped.length < eager.body.length)
  assert.deepEqual(JSON.parse(gunzipSync(eager.gzipped)), big)
  assert.equal(lazy.etag, eager.etag)
  assert.equal((await encode({ a: 1 })).gzipped, null)
})

test('If-None-Match: beberapa ETag, prefix W/, dan *', () => {
  assert.equal(etagMatches('"abc"', '"abc"'), true)
  assert.equal(etagMatches('W/"abc"', '"abc"'), true)
  assert.equal(etagMatches('"x", W/"abc" ,"y"', '"abc"'), true)
  assert.equal(etagMatches('*', '"abc"'), true)
  assert.equal(etagMatches('"zzz"', '"abc"'), false)
  assert.equal(etagMatches(undefined, '"abc"'), false)
})

test('rate limiter: jumlah kunci dibatasi (anti banjir IP palsu) tanpa merusak penghitungan', () => {
  const rl = createRateLimiter({ max: 2, windowMs: 60_000, maxKeys: 3 })
  for (let i = 0; i < 50; i++) rl.check(`ip-${i}`)
  const again = rl.check('ip-49')
  assert.equal(again.ok, true) // kunci terbaru masih tercatat
  assert.equal(rl.check('ip-49').ok, false) // pemeriksaan ke-3 melewati max=2
  rl.close()
})

test('config: LOG_REQUESTS dan batas cache', () => {
  assert.equal(loadConfig({}).logRequests, 'errors')
  assert.equal(loadConfig({ LOG_REQUESTS: 'false' }).logRequests, 'off')
  assert.equal(loadConfig({ LOG_REQUESTS: 'true' }).logRequests, 'all')
  assert.equal(loadConfig({}).cacheMaxMb, 96)
  assert.equal(loadConfig({ CACHE_MAX_MB: '16' }).cacheMaxMb, 16)
  assert.equal(loadConfig({}).redisTimeoutMs, 250)
  assert.equal(loadConfig({ REDIS_TIMEOUT_MS: '500' }).redisTimeoutMs, 500)
})

/* ───────── progress writer (tulis-belakangan) ───────── */

const spyColl = () => {
  const calls = []
  return {
    calls,
    fail: 0,
    async updateOne(filter, update, opts) {
      if (this.fail > 0) {
        this.fail--
        throw new Error('mongo putus')
      }
      calls.push({ filter, update, opts })
    }
  }
}

test('progress writer: update ke dokumen yang sama digabung jadi satu tulis', async () => {
  const coll = spyColl()
  const w = createProgressWriter(coll, { flushMs: 10_000, logger: quiet })
  await w.save('u:s:a', { chapter: '1', updatedAt: 1 }, { createdAt: 1, comicTitle: '', coverUrl: '' })
  await w.addSeconds('u:s:a', 30)
  await w.save('u:s:a', { chapter: '2', updatedAt: 2, comicTitle: 'Judul' }, { createdAt: 2, comicTitle: '' })
  await w.addSeconds('u:s:a', 15)
  assert.equal(coll.calls.length, 0)
  await w.flush()
  assert.equal(coll.calls.length, 1)
  const { update, opts } = coll.calls[0]
  assert.deepEqual(update.$set, { chapter: '2', updatedAt: 2, comicTitle: 'Judul' })
  // createdAt tertua menang, dan path yang ada di $set tidak boleh ikut $setOnInsert (Mongo menolak konflik)
  assert.deepEqual(update.$setOnInsert, { createdAt: 1, coverUrl: '' })
  assert.deepEqual(update.$inc, { readSeconds: 45 })
  assert.equal(opts.upsert, true)
  await w.close()
})

test('progress writer: tambah detik saja tidak boleh membuat dokumen (tanpa upsert)', async () => {
  const coll = spyColl()
  const w = createProgressWriter(coll, { flushMs: 10_000, logger: quiet })
  await w.addSeconds('u:s:a', 20)
  await w.flush()
  assert.equal(coll.calls[0].opts.upsert, false)
  assert.deepEqual(coll.calls[0].update, { $inc: { readSeconds: 20 } })
  await w.close()
})

test('progress writer: flush terjadwal, flushFor/drop per user, close menguras antrean', async () => {
  const coll = spyColl()
  const w = createProgressWriter(coll, { flushMs: 20, logger: quiet })
  await w.save('u1:s:a', { x: 1 })
  await sleep(60)
  assert.equal(coll.calls.length, 1, 'timer flush jalan sendiri')

  await w.save('u1:s:a', { x: 2 })
  await w.save('u2:s:a', { x: 3 })
  await w.flushFor('u3') // tidak ada milik u3 → tidak menguras apa pun
  assert.equal(w.pending, 2)
  await w.flushFor('u1')
  assert.equal(w.pending, 0)
  assert.equal(coll.calls.length, 3)

  await w.save('u9:s:a', { x: 1 })
  await w.drop('u9') // akun dihapus → antrean dibuang
  await w.flush()
  assert.equal(coll.calls.length, 3)

  const w2 = createProgressWriter(coll, { flushMs: 10_000, logger: quiet })
  await w2.save('u4:s:a', { x: 1 })
  await w2.close()
  assert.equal(coll.calls.length, 4)
})

test('progress writer: gagal tulis dicoba lagi, lalu menyerah setelah 3 kali', async () => {
  const coll = spyColl()
  const errors = []
  const w = createProgressWriter(coll, { flushMs: 10_000, logger: { error: m => errors.push(m) } })
  coll.fail = 1
  await w.save('u:s:a', { x: 1 })
  await w.flush()
  assert.equal(w.pending, 1, 'masuk antrean lagi')
  await w.flush()
  assert.equal(coll.calls.length, 1)
  coll.fail = 99
  await w.save('u:s:b', { x: 1 })
  for (let i = 0; i < 5; i++) await w.flush()
  assert.equal(w.pending, 0, 'menyerah, tidak menumpuk selamanya')
  assert.ok(errors.length >= 3)
  await w.close()
})

test('progress writer: flushMs=0 menulis langsung (perilaku lama)', async () => {
  const coll = spyColl()
  const w = createProgressWriter(coll, { flushMs: 0, logger: quiet })
  await w.save('u:s:a', { x: 1 })
  await w.addSeconds('u:s:a', 5)
  assert.equal(coll.calls.length, 2)
  assert.equal(w.pending, 0)
})

/* ───────── komunitas: query & cache ───────── */

const cfg = () =>
  loadConfig({ LOG_REQUESTS: 'false', MONGODB_URI: 'x', GOOGLE_CLIENT_ID: 'cid', AUTH_SECRET: 'x'.repeat(40) }).community
const hasSource = id => id === 'mock'
const open = limits => ({ login: { max: 1e6 }, readTime: { max: 1e6 }, like: { max: 1e6 }, write: { max: 1e6 }, commentBurst: { max: 1e6 }, commentHour: { max: 1e6 }, ...limits })

// Membungkus koleksi fake supaya setiap panggilan tercatat (nama koleksi → metode → jumlah).
function instrument(db) {
  const stats = { calls: {}, opts: [] }
  const wrapped = {
    collection(name) {
      const col = db.collection(name)
      return new Proxy(col, {
        get(target, prop) {
          const v = target[prop]
          if (typeof v !== 'function') return v
          return (...args) => {
            stats.calls[`${name}.${String(prop)}`] = (stats.calls[`${name}.${String(prop)}`] || 0) + 1
            stats.opts.push({ name, prop: String(prop), args })
            return v.apply(target, args)
          }
        }
      })
    }
  }
  return { db: wrapped, stats }
}

async function setup(over = {}) {
  const clock = { t: 1_700_000_000_000 }
  const inst = instrument(fakeDb())
  const cm = await createCommunity(cfg(), { db: inst.db, now: () => clock.t, logger: quiet, limits: open(), ...over })
  cm.google = { verify: async tok => JSON.parse(tok) }
  const login = async (sub, email = `${sub}@example.com`) => {
    const r = await loginWithGoogle(cm, JSON.stringify({ sub, email, name: sub, picture: '' }))
    return r.user.id
  }
  const user = async id => authenticate(cm, { headers: { authorization: `Bearer ${cm.tokens.sign(id)}` } })
  return { cm, clock, login, user, ...inst }
}

test('authenticate & daftar komentar tidak menarik foto profil base64 dari database', async () => {
  const { cm, login, user, stats } = await setup()
  const id = await login('av-a')
  stats.opts.length = 0
  await user(id)
  const read = stats.opts.find(o => o.name === 'users' && o.prop === 'findOne')
  assert.deepEqual(read.args[1], { projection: { customPicture: 0 } })

  const u = await user(id)
  await createComment(cm, u, { type: 'comic', source: 'mock', slug: 'x', body: 'komentar pertama yang bagus' }, hasSource)
  stats.opts.length = 0
  await listComments(cm, u, { type: 'comic', source: 'mock', slug: 'x', targetKey: 'mock:x' }, {})
  const usersReads = stats.opts.filter(o => o.name === 'users')
  assert.ok(usersReads.length >= 1)
  for (const r of usersReads) assert.deepEqual(r.args[1], { projection: { customPicture: 0 } })
  await cm.close()
})

test('foto profil: flag hasAvatar dipakai saat dokumen dibaca tanpa isi foto; dokumen lama di-backfill', async () => {
  assert.equal(publicUser({ _id: 'u1', hasAvatar: true, picture: 'g' }).picture, '/api/community/users/u1/avatar')
  assert.equal(publicUser({ _id: 'u1', hasAvatar: false, customPicture: 'data:x', picture: 'g' }).picture, 'g')
  assert.equal(publicUser({ _id: 'u1', customPicture: 'data:x', picture: 'g' }).picture, '/api/community/users/u1/avatar') // dokumen penuh, belum ber-flag
  assert.equal(publicUser({ _id: 'u1', picture: 'g' }).picture, 'g')

  const db = fakeDb()
  await db.collection('users').insertOne({ _id: 'legacy', googleSub: 's1', username: 'legacy', customPicture: 'data:image/png;base64,AAAA' })
  await db.collection('users').insertOne({ _id: 'kosong', googleSub: 's2', username: 'kosong', customPicture: '' })
  await db.collection('users').insertOne({ _id: 'polos', googleSub: 's3', username: 'polos' })
  const cm = await createCommunity(cfg(), { db, logger: quiet })
  const rows = Object.fromEntries((await db.collection('users').find({}).toArray()).map(u => [u._id, u.hasAvatar]))
  assert.deepEqual(rows, { legacy: true, kosong: undefined, polos: undefined })
  await cm.close()
})

test('progres baca: respons langsung, ditulis belakangan, dan riwayat sendiri tetap langsung terbaca', async () => {
  const { cm, login, user, stats, db } = await setup({ progressFlushMs: 5_000 })
  const id = await login('wb-a')
  const u = await user(id)
  const ch = { source: 'mock', slug: 'solo', chapter: '1', comicTitle: 'Solo Leveling', chapterTitle: 'Chapter 1', coverUrl: '' }
  stats.calls = {}
  await saveProgress(cm, u, ch, hasSource)
  await saveProgress(cm, u, { ...ch, chapter: '2', chapterTitle: 'Chapter 2' }, hasSource)
  assert.equal(stats.calls['reading_progress.updateOne'], undefined, 'belum menyentuh MongoDB')
  const act = await listActivity(cm, u, id, { tab: 'all', page: 1, limit: 10 })
  assert.equal(act.items.length, 1)
  assert.equal(act.items[0].chapter, '2')
  assert.equal(act.items[0].comicTitle, 'Solo Leveling')
  assert.equal(stats.calls['reading_progress.updateOne'], 1, 'dua simpan digabung jadi satu tulis')
  assert.equal((await db.collection('reading_progress').find({}).toArray()).length, 1)
  await cm.close()
})

test('close() menguras progres baca yang masih antre', async () => {
  const { cm, login, user, db } = await setup({ progressFlushMs: 60_000 })
  const id = await login('wb-b')
  await saveProgress(cm, await user(id), { source: 'mock', slug: 's', chapter: '9', comicTitle: 'T', chapterTitle: 'C', coverUrl: '' }, hasSource)
  assert.equal((await db.collection('reading_progress').find({}).toArray()).length, 0)
  await cm.close()
  assert.equal((await db.collection('reading_progress').find({}).toArray()).length, 1)
})

test('detik baca ikut antrean, tapi chapter tetap dihitung tepat waktu (ambang 60 dtk) dan hapus akun tidak meninggalkan progres yatim', async () => {
  const { cm, login, user, clock, db } = await setup({ progressFlushMs: 60_000 })
  const id = await login('wb-c')
  const ch = { source: 'mock', slug: 's', chapter: '1', comicTitle: 'T', chapterTitle: 'C', coverUrl: '' }
  await saveProgress(cm, await user(id), ch, hasSource)
  const first = await trackReadingTime(cm, await user(id), { ...ch, seconds: 60 }, hasSource)
  assert.equal(first.credited, 60)
  assert.equal(first.xpGained, 8) // 60 dtk = ambang → chapter terhitung, tidak menunggu flush antrean
  assert.equal(first.chaptersRead, 1)
  clock.t += 30_000
  const second = await trackReadingTime(cm, await user(id), { ...ch, seconds: 30 }, hasSource)
  assert.equal(second.xpGained, 0)
  assert.equal(second.chaptersRead, 1)
  await cm.progress.flush()
  assert.equal((await db.collection('reading_progress').find({}).toArray())[0].readSeconds, 90)

  await saveProgress(cm, await user(id), { ...ch, chapter: '2' }, hasSource) // masih antre
  await deleteAccount(cm, await user(id))
  await cm.progress.flush()
  for (const name of ['reading_progress', 'chapter_reads', 'users']) assert.equal((await db.collection(name).find({}).toArray()).length, 0, name)
  await cm.close()
})

test('aktivitas "all": jumlah chapter dibaca per komik dihitung dengan satu aggregate, bukan satu COUNT per baris', async () => {
  const { cm, login, user, clock, stats } = await setup({ progressFlushMs: 0 })
  const id = await login('act-a')
  const read = async (slug, chapter) => {
    const base = { source: 'mock', slug, chapter, comicTitle: slug, chapterTitle: `C${chapter}`, coverUrl: '' }
    await saveProgress(cm, await user(id), base, hasSource)
    await trackReadingTime(cm, await user(id), { ...base, seconds: 60 }, hasSource)
    clock.t += 70_000
    await trackReadingTime(cm, await user(id), { ...base, seconds: 60 }, hasSource)
    clock.t += 1_000
  }
  await read('komik-a', '1')
  await read('komik-a', '2')
  await read('komik-b', '1')
  await read('komik-c', '5')
  const before = { ...stats.calls }
  const act = await listActivity(cm, await user(id), id, { tab: 'all', page: 1, limit: 10 })
  const bySlug = Object.fromEntries(act.items.map(i => [i.slug, i.chaptersRead]))
  assert.deepEqual(bySlug, { 'komik-a': 2, 'komik-b': 1, 'komik-c': 1 })
  assert.equal(stats.calls['chapter_reads.aggregate'], 1)
  assert.equal((stats.calls['chapter_reads.countDocuments'] || 0) - (before['chapter_reads.countDocuments'] || 0), 0)
  await cm.close()
})

test('jumlah chapter dibaca di-cache singkat tapi langsung segar saat chapter baru terhitung', async () => {
  const { cm, login, user, clock, stats } = await setup({ progressFlushMs: 0 })
  const id = await login('cc-a')
  const base = { source: 'mock', slug: 's', chapter: '1' }
  const r0 = await trackReadingTime(cm, await user(id), { ...base, seconds: 30 }, hasSource)
  assert.equal(r0.chaptersRead, 0)
  const counts = () => stats.calls['chapter_reads.countDocuments'] || 0
  const n = counts()
  await trackReadingTime(cm, await user(id), { ...base, seconds: 1 }, hasSource)
  assert.equal(counts() - n <= 0, true, 'ping berikutnya memakai cache')
  clock.t += 40_000
  const r1 = await trackReadingTime(cm, await user(id), { ...base, seconds: 40 }, hasSource)
  assert.equal(r1.chaptersRead, 1, 'cache dibuang begitu chapter terhitung')
  await cm.close()
})

test('reconcile XP via aggregate: total benar, level ikut, dan tidak menarik event ke Node', async () => {
  const { cm, login, user, stats } = await setup({ progressFlushMs: 0 })
  const id = await login('xp-a')
  const u = await user(id)
  for (let i = 0; i < 3; i++) await createComment(cm, u, { type: 'comic', source: 'mock', slug: 'xp', body: `komentar nomor ${i} yang cukup panjang` }, hasSource)
  stats.calls = {}
  const { me } = await import('../src/community/users.js')
  const r = await me(cm, await user(id))
  assert.equal(r.user.xp, 15)
  assert.equal(stats.calls['xp_events.aggregate'], 1)
  assert.equal(stats.calls['xp_events.find'], undefined)
  // XP di dokumen user yang melenceng dipulihkan dari event
  await cm.c.users.updateOne({ _id: id }, { $set: { xp: 9999, level: 40 } })
  const healed = await me(cm, await user(id))
  assert.deepEqual([healed.user.xp, healed.user.level], [15, 1])
  await cm.close()
})

test('hitungan per chapter lewat aggregate ($group), di-cache, dan dibuang saat ada komentar baru/terhapus', async () => {
  const { cm, login, user, stats } = await setup({ progressFlushMs: 0 })
  const id = await login('cnt-a')
  const u = await user(id)
  const mk = async (chapter, body) =>
    (await createComment(cm, u, { type: 'chapter', source: 'mock', slug: 'cnt', chapter, body }, hasSource)).comment.id
  await mk('1', 'komentar satu di chapter satu')
  const dua = await mk('1', 'komentar dua di chapter satu')
  await mk('2', 'komentar di chapter dua')
  assert.deepEqual(await chapterCounts(cm, 'mock', 'cnt'), { counts: { 1: 2, 2: 1 } })
  await chapterCounts(cm, 'mock', 'cnt')
  assert.equal(stats.calls['comments.aggregate'], 1, 'panggilan kedua dari cache')
  await mk('2', 'komentar lagi di chapter dua')
  assert.deepEqual((await chapterCounts(cm, 'mock', 'cnt')).counts, { 1: 2, 2: 2 })
  await removeComment(cm, u, dua)
  assert.deepEqual((await chapterCounts(cm, 'mock', 'cnt')).counts, { 1: 1, 2: 2 })
  await cm.close()
})

test('total komentar & jumlah like di-cache tapi tetap akurat setelah penulisan di instance yang sama', async () => {
  const { cm, login, user, stats } = await setup({ progressFlushMs: 0 })
  const a = await user(await login('tot-a'))
  const target = { type: 'comic', source: 'mock', slug: 'tot', targetKey: 'mock:tot' }
  const total = async () => (await listComments(cm, a, target, {})).total
  assert.equal(await total(), 0)
  await total()
  assert.equal(stats.calls['comments.countDocuments'], 1)
  await createComment(cm, a, { type: 'comic', source: 'mock', slug: 'tot', body: 'komentar untuk uji total' }, hasSource)
  assert.equal(await total(), 1)

  const like = { type: 'comic', source: 'mock', slug: 'tot' }
  assert.deepEqual(await setLike(cm, a, like, hasSource, true), { liked: true, count: 1 })
  const b = await user(await (async () => (await login('tot-b')))())
  assert.deepEqual(await likeStatus(cm, b, like, hasSource), { liked: false, count: 1 })
  await setLike(cm, b, like, hasSource, true)
  assert.deepEqual(await likeStatus(cm, b, like, hasSource), { liked: true, count: 2 })
  assert.deepEqual(await setLike(cm, a, like, hasSource, false), { liked: false, count: 1 })
  await cm.close()
})

test('satu indeks yang gagal dibuat tidak mematikan komunitas', async () => {
  const db = fakeDb()
  const orig = db.collection('users').createIndex.bind(db.collection('users'))
  db.collection('users').createIndex = async (spec, opts) => {
    if (spec.username) throw new Error('E11000 data lama duplikat')
    return orig(spec, opts)
  }
  const errors = []
  const cm = await createCommunity(cfg(), { db, logger: { log() {}, error: m => errors.push(m) } })
  assert.ok(cm)
  assert.ok(errors.some(m => m.includes('username')))
  await cm.close()
})

/* ───────── Google JWKS & lifecycle ───────── */

test('JWKS: fetch bersamaan digabung, dan kunci lama tetap dipakai saat Google tidak terjangkau', async () => {
  const { generateKeyPairSync, createSign } = await import('node:crypto')
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  const clock = { t: Date.now() }
  const mint = (kid = 'k1') => {
    const sec = Math.floor(clock.t / 1000)
    const head = b64({ alg: 'RS256', kid })
    const body = b64({ iss: 'accounts.google.com', aud: 'cid', sub: 's', email: 'a@b.co', email_verified: true, iat: sec, exp: sec + 3600 })
    return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')}`
  }
  let calls = 0
  let down = false
  const fetchJwks = async () => {
    calls++
    await sleep(10)
    if (down) throw new Error('google down')
    return { keys: [jwk], maxAge: 3600 }
  }
  const g = createGoogleVerifier({ clientIds: ['cid'], fetchJwks, now: () => clock.t })
  await Promise.all([g.verify(mint()), g.verify(mint()), g.verify(mint())])
  assert.equal(calls, 1, 'tiga login serentak = satu fetch')

  clock.t += 3601 * 1000 // kunci kedaluwarsa, Google down
  down = true
  assert.equal((await g.verify(mint())).email, 'a@b.co')
  assert.equal(calls, 2)
  await g.verify(mint()) // dalam semenit berikutnya tidak mencoba fetch lagi
  assert.equal(calls, 2)
  // kid asing saat Google down tetap error 503 (bukan diam-diam ditolak sebagai token palsu)
  clock.t += 61_000
  await assert.rejects(g.verify(mint('kid-baru')), e => e.status === 503)
})

test('startCommunity: coba lagi dengan backoff sampai MongoDB tersambung, stop() menutup koneksi', async () => {
  let attempts = 0
  let closed = 0
  const logs = []
  const create = async () => {
    if (++attempts < 3) throw new Error('ECONNREFUSED')
    return { id: 'cm', close: async () => closed++ }
  }
  const s = startCommunity({}, { create, baseDelayMs: 5, maxDelayMs: 10, logger: { log: m => logs.push(m), error: m => logs.push(m) } })
  assert.equal(s.get(), null, 'belum tersambung → null (route balas 503)')
  await s.ready
  assert.equal(attempts, 3)
  assert.equal(s.get().id, 'cm')
  await s.stop()
  assert.equal(closed, 1)
  assert.equal(s.get(), null)
  assert.ok(logs.some(l => l.includes('ECONNREFUSED')))
})

test('startCommunity: env belum lengkap (null) tidak di-retry; stop() membangunkan loop yang sedang menunggu', async () => {
  let n = 0
  const s1 = startCommunity({}, { create: async () => (n++, null), baseDelayMs: 1, logger: quiet })
  await s1.ready
  assert.equal(n, 1)
  assert.equal(s1.get(), null)

  const s2 = startCommunity({}, { create: async () => Promise.reject(new Error('down')), baseDelayMs: 60_000, logger: quiet })
  await sleep(10)
  const t0 = Date.now()
  await s2.stop()
  assert.ok(Date.now() - t0 < 500)
})
