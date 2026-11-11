import { normalizeList, normalizeDetail, normalizeBrowse } from './normalize.js'
import { badRequest } from './lib/errors.js'
import { withTimeout } from './lib/timeout.js'

const STEP_TIMEOUT_MS = 20_000
const fail = text => ({ level: 'fail', text })
const warn = text => ({ level: 'warn', text })

const whereOf = err => {
  const frames = String(err?.stack || '').split('\n').map(l => l.match(/^.*\/src\/([\w/.-]+\.js):(\d+)/)).filter(Boolean)
  const own = frames.find(m => !/^(lib\/|diagnose\.js|scrapers\/utils\.js)/.test(m[1]))
  const at = own || frames.find(m => m[1] === 'scrapers/utils.js')
  return at ? `${at[1]}:${at[2]}` : ''
}

const HINTS = {
  'HTTP 403': 'Situs sumber menolak IP server (diblokir). Coba relay, lihat README bagian HTTP 403.',
  'HTTP 429': 'Kena rate limit dari situs sumber. Kurangi request atau pakai relay.',
  'HTTP 404': 'URL tidak ditemukan di situs sumber. Cek path endpoint di scraper atau slug yang dipakai.',
  'HTTP 5xx': 'Situs sumber sedang error. Coba lagi nanti.',
  TIMEOUT: 'Situs sumber terlalu lama merespons.',
  JARINGAN: 'Domain tidak bisa dijangkau. Cek BASE/API URL di scraper.',
  KODE: 'Bug di kode scraper, biasanya selector atau nama field berubah. Lihat lokasi file:baris.'
}

const describe = err => {
  const code = err?.cause?.code || err?.cause?.errors?.[0]?.code
  const message = (String(err?.message || err).split('\n')[0] + (code ? ` (${code})` : '')).slice(0, 300)
  const http = message.match(/^HTTP (\d{3})/)?.[1]
  const kind = http
    ? `HTTP ${http}`
    : ['TimeoutError', 'AbortError'].includes(err?.name) || err?.status === 504
      ? 'TIMEOUT'
      : code || err?.message === 'fetch failed'
        ? 'JARINGAN'
        : /^(Type|Reference|Syntax|Range)Error$/.test(err?.name)
          ? 'KODE'
          : 'ERROR'
  const hint = HINTS[kind] || (http >= 500 ? HINTS['HTTP 5xx'] : '')
  return { kind, message, where: whereOf(err), hint }
}

const itemIssues = items => {
  if (!Array.isArray(items)) return [fail('hasil harus berupa array')]
  if (!items.length) return [fail('hasil kosong (0 item)')]
  const head = items.slice(0, 10)
  const count = key => head.filter(i => !i?.[key]).length
  return [
    count('title') && fail(`${count('title')} item tanpa "title"`),
    count('slug') && fail(`${count('slug')} item tanpa "slug"`),
    count('cover') && warn(`${count('cover')} dari ${head.length} item tanpa "cover"`)
  ].filter(Boolean)
}

const listResult = (p, items) => {
  const issues = itemIssues(items)
  const ok = Array.isArray(items) && items.length > 0
  if (ok) normalizeList(items, p.id)
  return {
    note: ok ? `${items.length} item` : '',
    issues,
    sample: ok ? items.slice(0, 3).map(i => ({ title: i?.title, slug: i?.slug, cover: i?.cover })) : null,
    next: { slug: ok ? items.find(i => i?.slug)?.slug : '' }
  }
}

const need = (value, name) => {
  if (!value) throw badRequest(`Parameter "${name}" wajib diisi`)
  return value
}

const allowedHost = (p, host) => (p.imageHosts || []).some(x => host === x || host.endsWith('.' + x))

const STEPS = {
  search: { method: 'search', run: async (p, q) => listResult(p, await p.search(q.q || 'solo', { limit: 5 })) },
  latest: { method: 'latest', run: async p => listResult(p, await p.latest({ page: 1 })) },
  popular: { method: 'popular', run: async p => listResult(p, await p.popular({ period: '', limit: 5 })) },
  browse: {
    method: 'browse',
    run: async p => {
      const res = await p.browse({ q: '', genre: [], type: '', status: '', sort: '', minChapters: '', page: 1 })
      const items = Array.isArray(res) ? res : res?.items
      const out = listResult(p, items)
      if (!Array.isArray(res) && !res?.pages) out.issues.push(warn('tidak ada info "pages" untuk paginasi'))
      normalizeBrowse(res, p.id)
      return out
    }
  },
  genres: {
    method: 'genres',
    run: async p => {
      const items = await p.genres()
      if (!Array.isArray(items)) return { issues: [fail('hasil harus berupa array')] }
      return { note: `${items.length} genre`, issues: items.length ? [] : [warn('daftar genre kosong')], sample: items.slice(0, 8) }
    }
  },
  detail: {
    method: 'detail',
    run: async (p, q) => {
      const d = await p.detail(need(q.slug, 'slug'))
      normalizeDetail(d, p.id)
      const chapters = Array.isArray(d?.chapters) ? d.chapters : []
      const issues = [
        !d?.title && fail('tanpa "title"'),
        !chapters.length && fail('daftar "chapters" kosong'),
        chapters.length && !chapters[0]?.slug && fail('chapter pertama tanpa "slug"'),
        chapters.length && !chapters[0]?.number && warn('chapter pertama tanpa "number"'),
        !d?.cover && warn('tanpa "cover"'),
        !d?.synopsis && warn('tanpa "synopsis"'),
        !d?.genres?.length && warn('tanpa "genres"')
      ].filter(Boolean)
      return { note: `${d?.title || '?'} · ${chapters.length} chapter`, issues, sample: { title: d?.title, cover: d?.cover, chapters: chapters.length }, next: { chapter: chapters[0]?.slug } }
    }
  },
  chapter: {
    method: 'chapter',
    run: async (p, q) => {
      const c = await p.chapter(need(q.slug, 'slug'), need(q.chapter, 'chapter'))
      const images = Array.isArray(c?.images) ? c.images : []
      const invalid = images.filter(u => typeof u !== 'string' || !/^https?:\/\//i.test(u))
      const issues = [
        !images.length && fail('daftar "images" kosong'),
        invalid.length && fail(`${invalid.length} URL gambar tidak valid (harus http/https)`),
        !c?.prev && !c?.next && warn('tanpa "prev" dan "next"')
      ].filter(Boolean)
      return { note: `${images.length} gambar`, issues, sample: { images: images.length, first: images[0], prev: c?.prev ?? null, next: c?.next ?? null }, next: { image: images[0] } }
    }
  },
  image: {
    run: async (p, q) => {
      const url = need(q.url, 'url')
      let host
      try {
        host = new URL(url).hostname.toLowerCase()
      } catch {
        throw badRequest('URL gambar tidak valid')
      }
      if (!allowedHost(p, host)) return { issues: [fail(`host "${host}" tidak ada di imageHosts scraper, image proxy akan menolaknya (pakai trackHost)`)] }
      const res = await fetch(url, { headers: p.imageHeaders || {}, signal: AbortSignal.timeout(12_000) })
      res.body?.cancel().catch(() => {})
      const type = res.headers.get('content-type') || ''
      const issues = [!res.ok && fail(`sumber membalas HTTP ${res.status}, cek imageHeaders (referer/user-agent)`), res.ok && !type.startsWith('image/') && fail(`respons bukan gambar (${type || 'tanpa content-type'})`)].filter(Boolean)
      return { note: `${res.status} ${type}`, issues, sample: { type, bytes: Number(res.headers.get('content-length')) || null } }
    }
  }
}

export async function diagnose(p, step, query = {}) {
  const def = STEPS[step]
  if (!def) throw badRequest(`Langkah tidak dikenal. Pilihan: ${Object.keys(STEPS).join(', ')}`)
  const out = { step, status: 'pass', ms: 0, note: '', issues: [], sample: null, next: {}, error: null }
  const started = performance.now()
  if (def.method && typeof p[def.method] !== 'function') {
    return { ...out, status: 'skip', note: `scraper belum punya method ${def.method}() — endpoint ini menjawab 501` }
  }
  try {
    Object.assign(out, await withTimeout(Promise.resolve(def.run(p, query)), STEP_TIMEOUT_MS))
  } catch (err) {
    out.error = describe(err)
  }
  out.ms = Math.round(performance.now() - started)
  out.status = out.error || out.issues.some(i => i.level === 'fail') ? 'fail' : out.issues.length ? 'warn' : 'pass'
  return out
}

export const DIAGNOSE_STEPS = Object.keys(STEPS)
