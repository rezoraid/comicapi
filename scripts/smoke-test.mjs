// Jalankan: node smoke-test.mjs [provider] [kata-kunci]
// Contoh : node smoke-test.mjs            (semua provider)
//          node smoke-test.mjs manta "solo leveling"
import scrapers from '../src/scrapers/index.js'

const only = process.argv[2]
const query = process.argv[3] || 'solo'
const providers = scrapers.list().filter(p => !only || p.id === only)
let failed = 0

async function step(name, fn) {
  const t = Date.now()
  try {
    const out = await fn()
    console.log(`  ✅ ${name.padEnd(22)} ${String(Date.now() - t).padStart(5)}ms  ${out ?? ''}`)
    return true
  } catch (e) {
    failed++
    console.log(`  ❌ ${name.padEnd(22)} ${String(Date.now() - t).padStart(5)}ms  ${e.message}`)
    return false
  }
}

const need = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

for (const { id, name } of providers) {
  const p = scrapers.get(id)
  console.log(`\n[${id}] ${name}`)
  let first, ch

  await step('search', async () => {
    const r = await p.search(query, { limit: 10 })
    need(r.length, `hasil kosong untuk "${query}"`)
    need(r[0].slug && r[0].title, 'item tanpa slug/title')
    first = r[0]
    return `${r.length} item, contoh: ${r[0].title}`
  })
  await step('latest', async () => {
    const r = await p.latest({ page: 1 })
    need(r.length, 'kosong')
    return `${r.length} item`
  })
  await step('popular', async () => {
    const r = await p.popular({ limit: 10 })
    need(r.length, 'kosong')
    return `${r.length} item`
  })
  await step('browse', async () => {
    const r = await p.browse({ page: 1 })
    need(r.items.length, 'kosong')
    return `${r.items.length} item, ${r.pages} halaman`
  })
  await step('genres', async () => {
    const r = await p.genres()
    need(r.length, 'kosong')
    return `${r.length} genre`
  })

  if (!first) {
    console.log('  ⏭️  detail/chapter dilewati (search gagal)')
    continue
  }
  await step('detail', async () => {
    const d = await p.detail(first.slug)
    need(d.title, 'title kosong')
    need(d.chapters.length, 'daftar chapter kosong')
    ch = d.chapters[d.chapters.length - 1] // chapter pertama
    return `${d.title} | ${d.chapters.length} chapter | cover: ${d.cover ? 'ok' : 'KOSONG'}`
  })
  if (!ch) continue
  await step('chapter', async () => {
    const c = await p.chapter(first.slug, ch.slug)
    need(c.images.length, 'gambar kosong')
    ch.images = c.images
    return `ch ${ch.number}: ${c.images.length} gambar`
  })
  await step('download gambar', async () => {
    const res = await fetch(ch.images[0], { headers: p.imageHeaders, signal: AbortSignal.timeout(20000) })
    need(res.ok, `HTTP ${res.status}`)
    const type = res.headers.get('content-type') || ''
    need(type.startsWith('image/'), `bukan gambar (${type})`)
    return `${type}, ${(Number(res.headers.get('content-length')) / 1024).toFixed(0)}KB`
  })
}

console.log(failed ? `\n${failed} test GAGAL` : '\nSemua test lolos ✅')
process.exit(failed ? 1 : 0)
