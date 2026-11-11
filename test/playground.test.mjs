import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { quiet, listen, makeRegistry, PNG } from './helpers.mjs'

let img, api, app, registry

before(async () => {
  img = await listen((req, res) => {
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': PNG.length })
    res.end(PNG)
  })
  registry = makeRegistry(img.port)
  app = createApp({ registry, config: loadConfig({ LOG_REQUESTS: 'false' }), logger: quiet })
  api = await listen(app.handler)
})
after(() => {
  api.server.close()
  img.server.close()
  app.close()
})

const serve = async (t, reg, env = {}) => {
  const a = createApp({ registry: reg, config: loadConfig({ LOG_REQUESTS: 'false', ...env }), logger: quiet })
  const s = await listen(a.handler)
  t.after(() => {
    s.server.close()
    a.close()
  })
  return s
}

const diag = async (path, base = api.url) => (await (await fetch(`${base}/api/mock/diagnose/${path}`)).json()).data

test('GET /playground: HTML, gzip, ETag/304, CSP', async () => {
  const r = await fetch(`${api.url}/playground`)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /text\/html/)
  assert.equal(r.headers.get('content-encoding'), 'gzip')
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.match(await r.text(), /comic-api/)
  const etag = r.headers.get('etag')
  assert.equal((await fetch(`${api.url}/playground`, { headers: { 'if-none-match': etag } })).status, 304)
})

test('PLAYGROUND=false mematikan halaman dan endpoint diagnosa', async t => {
  const s = await serve(t, registry, { PLAYGROUND: 'false' })
  assert.equal((await fetch(`${s.url}/playground`)).status, 404)
  assert.equal((await fetch(`${s.url}/api/mock/diagnose/search`)).status, 404)
})

test('diagnosa: rantai langkah lolos dan membawa slug/chapter/gambar ke langkah berikutnya', async () => {
  const search = await diag('search?q=solo')
  assert.equal(search.status, 'warn')
  assert.match(search.issues[0].text, /cover/)
  assert.equal(search.next.slug, 'komik-0')
  const detail = await diag('detail?slug=komik-0')
  assert.equal(detail.next.chapter, '1')
  const chapter = await diag('chapter?slug=komik-0&chapter=1')
  assert.equal(chapter.status, 'pass')
  assert.equal(chapter.next.image, `http://127.0.0.1:${img.port}/img/1.png`)
  const image = await diag(`image?url=${encodeURIComponent(chapter.next.image)}`)
  assert.equal(image.status, 'pass')
  assert.match(image.note, /image\/png/)
})

test('diagnosa: gambar dari host yang tidak terdaftar ditolak tanpa diunduh', async () => {
  const r = await diag(`image?url=${encodeURIComponent('https://evil.example/x.png')}`)
  assert.equal(r.status, 'fail')
  assert.match(r.issues[0].text, /imageHosts/)
})

test('diagnosa: error scraper dijelaskan jenis, pesan, dan sarannya', async t => {
  const broken = makeRegistry(img.port)
  broken.provider.latest = async () => { throw Object.assign(new Error('HTTP 403'), { status: 403 }) }
  broken.provider.browse = async () => ({ items: [], pages: 1 })
  broken.provider.genres = async () => 'bukan array'
  broken.provider.popular = undefined
  const s = await serve(t, broken)
  const latest = await diag('latest', s.url)
  assert.equal(latest.status, 'fail')
  assert.equal(latest.error.kind, 'HTTP 403')
  assert.match(latest.error.hint, /relay/)
  assert.equal((await diag('browse', s.url)).status, 'fail')
  assert.equal((await diag('genres', s.url)).status, 'fail')
  const popular = await diag('popular', s.url)
  assert.equal(popular.status, 'skip')
  assert.match(popular.note, /popular\(\)/)
})

test('diagnosa: langkah tidak dikenal 400, parameter wajib dilaporkan sebagai gagal', async () => {
  assert.equal((await fetch(`${api.url}/api/mock/diagnose/ngawur`)).status, 400)
  assert.equal((await fetch(`${api.url}/api/ngawur/diagnose/search`)).status, 404)
  const r = await diag('detail')
  assert.equal(r.status, 'fail')
  assert.match(r.error.message, /slug/)
})

const boot = origin => {
  const html = readFileSync(new URL('../src/public/playground.html', import.meta.url), 'utf8')
  const els = new Map()
  const el = sel => {
    if (!els.has(sel)) els.set(sel, { value: '', innerHTML: '', textContent: '', disabled: false, dataset: {}, classList: { toggle() {}, add() {}, remove() {} } })
    return els.get(sel)
  }
  const mem = new Map()
  const ctx = vm.createContext({
    document: { querySelector: el, querySelectorAll: () => [] },
    localStorage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) },
    location: { origin },
    fetch, URL, URLSearchParams, performance, setTimeout, clearTimeout, console, JSON, Promise, Object, String, Number, Math, Error, Array
  })
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], ctx)
  return el
}

const ready = async (el, text = 'mock') => {
  for (let i = 0; i < 40 && !el('#chips').innerHTML.includes(text); i++) await new Promise(r => setTimeout(r, 25))
}

test('playground: UI mendeteksi scraper, menjalankan diagnosa, dan menampilkan hasil per langkah', async () => {
  const el = boot(api.url)
  await ready(el)
  assert.match(el('#dot').className, /ok/)
  assert.match(el('#chips').innerHTML, /mock/)
  await el('#diag').onclick()
  const out = el('#detail').innerHTML
  for (const step of ['search', 'latest', 'popular', 'browse', 'genres', 'detail', 'chapter', 'image']) assert.ok(out.includes(`<small>${step}</small>`), `langkah ${step} tidak tampil`)
  assert.doesNotMatch(out, /class="row fail"/)
  assert.match(out, /Jalan, ada peringatan|Siap dipakai/)
  assert.equal(el('#copy').disabled, false)
})

test('playground: UI menampilkan lokasi dan saran saat scraper error', async t => {
  const broken = makeRegistry(img.port)
  broken.provider.detail = async () => { throw Object.assign(new Error('HTTP 403'), { status: 403 }) }
  const s = await serve(t, broken)
  const el = boot(s.url)
  await ready(el)
  await el('#diag').onclick()
  const out = el('#detail').innerHTML
  assert.match(out, /class="row fail"/)
  assert.match(out, /HTTP 403/)
  assert.match(out, /Saran:/)
  assert.match(out, /dilewati: belum ada &quot;chapter&quot;/)
  assert.match(out, /Ada yang gagal/)
})

test('playground: API key salah → pesan jelas', async t => {
  const s = await serve(t, registry, { API_KEY: 'rahasia' })
  const el = boot(s.url)
  for (let i = 0; i < 40 && !el('#notice').innerHTML; i++) await new Promise(r => setTimeout(r, 25))
  assert.match(el('#notice').innerHTML, /API key/)
})

test('playground: server tidak terjangkau → status offline', async () => {
  const el = boot('http://127.0.0.1:1')
  for (let i = 0; i < 40 && el('#health').textContent === ''; i++) await new Promise(r => setTimeout(r, 25))
  assert.match(el('#dot').className, /bad/)
  assert.equal(el('#health').textContent, 'offline')
})
