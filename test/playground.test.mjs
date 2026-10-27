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

test('GET /playground: HTML, gzip, ETag/304, CSP', async () => {
  const r = await fetch(`${api.url}/playground`)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type'), /text\/html/)
  assert.equal(r.headers.get('content-encoding'), 'gzip')
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/)
  assert.match(await r.text(), /comic-api \/ playground/)
  const etag = r.headers.get('etag')
  assert.equal((await fetch(`${api.url}/playground`, { headers: { 'if-none-match': etag } })).status, 304)
})

test('PLAYGROUND=false mematikan halaman', async () => {
  const a = createApp({ registry, config: loadConfig({ PLAYGROUND: 'false', LOG_REQUESTS: 'false' }), logger: quiet })
  const s = await listen(a.handler)
  assert.equal((await fetch(`${s.url}/playground`)).status, 404)
  s.server.close()
  a.close()
})

test('playground: JS jalan end-to-end terhadap server (DOM di-stub)', async () => {
  const html = readFileSync(new URL('../src/public/playground.html', import.meta.url), 'utf8')
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1]

  const els = new Map()
  const el = sel => {
    if (!els.has(sel)) els.set(sel, { value: '', innerHTML: '', textContent: '', hidden: false, className: '', title: '', disabled: false, dataset: {}, classList: { toggle() {}, add() {} } })
    return els.get(sel)
  }
  const mem = new Map()
  const ctx = vm.createContext({
    document: { querySelector: el, querySelectorAll: () => [] },
    localStorage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) },
    location: { origin: api.url },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    fetch, URL, URLSearchParams, performance, setTimeout, clearTimeout, console, JSON, Promise, Object, String, Number, Math, Error, Array
  })
  vm.runInContext(js, ctx)

  for (let i = 0; i < 40 && !el('#src').innerHTML.includes('mock'); i++) await new Promise(r => setTimeout(r, 25))
  assert.match(el('#dot').className, /ok/)
  assert.match(el('#src').innerHTML, /mock/)
  assert.match(el('#form').innerHTML, /data-k="q"/)

  await el('#run').onclick()
  assert.match(el('#res').innerHTML, /Komik 0/)
  assert.match(el('#res').innerHTML, /class="st">200/)

  await el('#all').onclick()
  const out = el('#tests').innerHTML
  const steps = ['GET /health', 'GET /api/sources', 'GET /api/search (semua sumber)', 'validasi: tanpa q', 'validasi: sumber ngawur',
    'search', 'latest', 'popular', 'browse', 'genres', 'detail', 'chapter', 'gambar (proxy)']
  for (const step of steps) assert.ok(out.includes(`<td>${step}`), `langkah ${step} tidak ada`)
  assert.ok(!out.includes('FAIL</td>'), 'ada langkah gagal:\n' + out.replace(/<[^>]+>/g, ' '))
  assert.ok(!out.includes('SKIP</td>'), 'ada langkah dilewati')
  assert.equal((out.match(/PASS<\/td>/g) || []).length, steps.length)
  assert.match(out, /SEMUA LOLOS/)
  await new Promise(r => setTimeout(r, 150))
  assert.match(el('#loglist').innerHTML, /Belum ada error/)
  assert.equal(el('#logbadge').textContent, 'log 0')
})

test('playground: tes otomatis menandai FAIL kalau endpoint rusak', async () => {
  const broken = { ...registry, get: id => ({ ...registry.get(id), genres: async () => [] }) }
  const a = createApp({ registry: broken, config: loadConfig({ LOG_REQUESTS: 'false' }), logger: quiet })
  const s = await listen(a.handler)
  const html = readFileSync(new URL('../src/public/playground.html', import.meta.url), 'utf8')
  const els = new Map()
  const el = sel => (els.has(sel) || els.set(sel, { value: '', innerHTML: '', textContent: '', hidden: false, className: '', title: '', disabled: false, dataset: {} }), els.get(sel))
  const ctx = vm.createContext({
    document: { querySelector: el, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} },
    location: { origin: s.url },
    fetch, URL, URLSearchParams, performance, setTimeout, clearTimeout, console, JSON, Promise, Object, String, Number, Math, Error, Array
  })
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], ctx)
  for (let i = 0; i < 40 && !el('#src').innerHTML.includes('mock'); i++) await new Promise(r => setTimeout(r, 25))
  await el('#all').onclick()
  const out = el('#tests').innerHTML
  assert.match(out, /ADA YANG GAGAL/)
  assert.equal((out.match(/FAIL<\/td>/g) || []).length, 1)
  await new Promise(r => setTimeout(r, 150))
  const log = el('#loglist').innerHTML
  assert.match(log, /class="lk">TES</)
  assert.match(log, /mock › genres/)
  assert.equal(el('#logbadge').textContent, 'log 1')
  s.server.close()
  a.close()
})

test('playground: API key salah → pesan jelas', async () => {
  const a = createApp({ registry, config: loadConfig({ API_KEY: 'rahasia', LOG_REQUESTS: 'false' }), logger: quiet })
  const s = await listen(a.handler)
  const html = readFileSync(new URL('../src/public/playground.html', import.meta.url), 'utf8')
  const els = new Map()
  const el = sel => (els.has(sel) || els.set(sel, { value: '', innerHTML: '', textContent: '', hidden: false, className: '', dataset: {}, classList: { toggle() {} } }), els.get(sel))
  const ctx = vm.createContext({
    document: { querySelector: el, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} },
    location: { origin: s.url },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    fetch, URL, URLSearchParams, performance, setTimeout, clearTimeout, console, JSON, Promise, Object, String, Number, Math, Error, Array
  })
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], ctx)
  for (let i = 0; i < 40 && !el('#res').innerHTML; i++) await new Promise(r => setTimeout(r, 25))
  assert.match(el('#res').innerHTML, /API key/)
  await new Promise(r => setTimeout(r, 150))
  assert.match(el('#loglist').innerHTML, /HTTP 401/)
  assert.match(el('#loglist').innerHTML, /UNAUTHORIZED/)
  assert.match(el('#loglist').innerHTML, /API key/)
  s.server.close()
  a.close()
})

test('playground: server tidak terjangkau → log JARINGAN + saran', async () => {
  const html = readFileSync(new URL('../src/public/playground.html', import.meta.url), 'utf8')
  const els = new Map()
  const el = sel => (els.has(sel) || els.set(sel, { value: '', innerHTML: '', textContent: '', hidden: false, className: '', title: '', dataset: {}, classList: { toggle() {} } }), els.get(sel))
  const ctx = vm.createContext({
    document: { querySelector: el, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem() {} },
    location: { origin: 'http://127.0.0.1:1' },
    fetch, URL, URLSearchParams, performance, setTimeout, clearTimeout, console, JSON, Promise, Object, String, Number, Math, Error, Array
  })
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], ctx)
  await new Promise(r => setTimeout(r, 400))
  const log = el('#loglist').innerHTML
  assert.match(log, /class="lk">JARINGAN</)
  assert.match(log, /Server tidak terjangkau/)
  assert.match(el('#logbar').innerHTML, /data-act="lclear"/)
})
