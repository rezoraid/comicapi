import { normalizeDetail } from './normalize.js'
import { recordFromDetail, normTitle, hasGaps, mergeInto, fillItem, fillDetail, finalizeItem, finalizeDetail, sameWork, missingOf } from './completeness.js'

const key = (source, slug) => `${source}|${slug}`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const itemsOf = data => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null)
const withItems = (data, items) => (Array.isArray(data) ? items : { ...data, items })
const MIN = 60_000
const HOUR = 60 * MIN

function within(promise, ms) {
  let t
  return Promise.race([Promise.resolve(promise).catch(() => {}), new Promise(r => (t = setTimeout(r, ms)))]).finally(() => clearTimeout(t))
}

function gate(max) {
  let active = 0
  const waiting = []
  const next = () => {
    if (active >= max || !waiting.length) return
    active++
    const { fn, resolve, reject } = waiting.shift()
    fn().then(resolve, reject).finally(() => {
      active--
      next()
    })
  }
  return fn => new Promise((resolve, reject) => {
    waiting.push({ fn, resolve, reject })
    next()
  })
}

export function createCatalog({ registry, collection = () => null, external = null, logger = console, now = Date.now, ...opts } = {}) {
  const cfg = {
    staleMs: 12 * HOUR,
    crawlStaleMs: 72 * HOUR,
    retryMs: 10 * MIN,
    missMs: 6 * HOUR,
    extRetryMs: 14 * 24 * HOUR,
    l1Max: 20_000,
    inlineMax: 12,
    inlineBudgetMs: 3000,
    inlineConcurrency: 6,
    bgConcurrency: 2,
    queueMax: 5000,
    crawl: true,
    crawlPagesPerCycle: 8,
    crawlDelayMs: 400,
    crawlIntervalMs: 20 * MIN,
    crawlFirstDelayMs: 20_000,
    ...opts
  }
  const mem = new Map()
  const byTitle = new Map()
  const inflight = new Map()
  const extInflight = new Map()
  const failedUntil = new Map()
  const absent = new Set()
  const sibLoaded = new Set()
  const queued = new Set()
  const queue = []
  const inlineGate = gate(cfg.inlineConcurrency)
  const bgGate = gate(cfg.bgConcurrency)
  let pumping = 0
  let crawling = false
  let lastCrawl = null
  let timers = []
  const cursors = {}
  let cursorsLoaded = false
  const isFailed = k => (failedUntil.get(k) || 0) > now()
  const isFresh = (r, ms = cfg.staleMs) => !!r && now() - (r.syncedAt || 0) < ms
  function remember(rec) {
    const old = mem.get(rec._id)
    mem.delete(rec._id)
    mem.set(rec._id, rec)
    if (old?.nt && old.nt !== rec.nt) byTitle.get(old.nt)?.delete(rec._id)
    if (rec.nt) {
      let s = byTitle.get(rec.nt)
      if (!s) byTitle.set(rec.nt, (s = new Set()))
      s.add(rec._id)
    }
    absent.delete(rec._id)
    while (mem.size > cfg.l1Max) {
      const [k, r] = mem.entries().next().value
      mem.delete(k)
      byTitle.get(r.nt)?.delete(k)
    }
  }
  const peek = k => {
    const r = mem.get(k)
    if (r) {
      mem.delete(k)
      mem.set(k, r)
    }
    return r
  }
  async function persist(rec) {
    const col = collection()
    if (!col) return
    const { _id, ...rest } = rec
    try {
      await col.updateOne({ _id }, { $set: rest }, { upsert: true })
    } catch (err) {
      logger.error?.(`[catalog] simpan ${_id} gagal → ${err?.message || err}`)
    }
  }
  async function load(keys) {
    const col = collection()
    const miss = keys.filter(k => !mem.has(k) && !absent.has(k))
    if (!col || !miss.length) return
    try {
      const rows = await col.find({ _id: { $in: miss } }).toArray()
      rows.forEach(remember)
      for (const k of miss) if (!mem.has(k)) absent.add(k)
      if (absent.size > 50_000) absent.clear()
    } catch (err) {
      logger.error?.(`[catalog] baca gagal → ${err?.message || err}`)
    }
  }
  async function loadSiblings(nts) {
    const col = collection()
    const todo = [...new Set(nts)].filter(nt => nt && nt.length >= 4 && !sibLoaded.has(nt))
    if (!col || !todo.length) return
    todo.forEach(nt => sibLoaded.add(nt))
    if (sibLoaded.size > 50_000) sibLoaded.clear()
    try {
      const rows = await col.find({ nt: { $in: todo } }).toArray()
      rows.forEach(r => {
        if (!mem.has(r._id)) remember(r)
      })
    } catch (err) {
      logger.error?.(`[catalog] baca sibling gagal → ${err?.message || err}`)
    }
  }
  function siblingsOf(self) {
    if (!self?.nt || self.nt.length < 4) return []
    const out = []
    for (const k of byTitle.get(self.nt) || []) {
      const r = mem.get(k)
      if (r && sameWork(self, r)) out.push(r)
    }
    return out
  }
  function applyExt(rec) {
    const data = rec.ext?.data
    if (!data) return
    const filled = mergeInto(rec, data)
    if (rec.type === 'webtoon' && data.type) {
      rec.type = data.type
      filled.push('type')
    }
    rec.extFilled = filled
  }
  function ingest(detail, source) {
    if (!detail?.slug || !detail.title) return null
    const rec = recordFromDetail(detail, source, now())
    const prev = mem.get(rec._id)
    if (prev?.ext) {
      rec.ext = prev.ext
      applyExt(rec)
    }
    remember(rec)
    failedUntil.delete(rec._id)
    void persist(rec)
    return rec
  }
  async function fetchRecord(source, slug) {
    const p = registry.get(source)
    if (typeof p?.detail !== 'function') return null
    const d = normalizeDetail(await p.detail(slug), p.id)
    return ingest({ ...d, slug }, p.id)
  }
  function sync(source, slug, priority = 'bg') {
    const k = key(source, slug)
    if (inflight.has(k)) return inflight.get(k)
    const run = priority === 'inline' ? inlineGate : bgGate
    const p = run(async () => {
      try {
        return await fetchRecord(source, slug)
      } catch (err) {
        failedUntil.set(k, now() + (err?.status === 404 ? cfg.missMs : cfg.retryMs))
        if (!(err?.status >= 400 && err.status < 500)) logger.error?.(`[catalog] sinkron ${k} gagal → ${err?.message || err}`)
        return null
      }
    }).finally(() => inflight.delete(k))
    inflight.set(k, p)
    return p
  }
  function enrichExternal(k) {
    if (extInflight.has(k)) return extInflight.get(k)
    const rec = mem.get(k)
    if (!rec || !external?.enabled || !hasGaps(rec)) return Promise.resolve(rec)
    if (rec.ext && (rec.ext.data || now() - rec.ext.at < cfg.extRetryMs)) return Promise.resolve(rec)
    const p = (async () => {
      const r = await external.lookup({ title: rec.title, alt: rec.alt, type: rec.type })
      const cur = mem.get(k) || rec
      if (!r.ok) return cur
      cur.ext = { at: now(), id: r.id ?? null, data: r.data || null }
      applyExt(cur)
      remember(cur)
      await persist(cur)
      return cur
    })()
      .catch(() => mem.get(k))
      .finally(() => extInflight.delete(k))
    extInflight.set(k, p)
    return p
  }
  async function ensure(source, slug, priority = 'bg') {
    const k = key(source, slug)
    const rec = peek(k)
    if ((!rec || !isFresh(rec)) && !isFailed(k)) await sync(source, slug, priority)
    await enrichExternal(k)
    return peek(k) || null
  }
  function schedule(source, slug) {
    const k = key(source, slug)
    if (queued.has(k) || inflight.has(k) || isFailed(k) || queue.length >= cfg.queueMax) return
    queued.add(k)
    queue.push([source, slug])
    pump()
  }
  function pump() {
    while (pumping < cfg.bgConcurrency && queue.length) {
      const [source, slug] = queue.shift()
      queued.delete(key(source, slug))
      pumping++
      ensure(source, slug, 'bg')
        .catch(() => {})
        .then(() => sleep(cfg.crawlDelayMs))
        .finally(() => {
          pumping--
          pump()
        })
    }
  }
  async function fillList(data, defaultSource = '') {
    const items = itemsOf(data)
    if (!items?.length) return data
    const pairs = items.map(it => (it?.slug ? [it.source || defaultSource, it.slug] : null))
    const keys = pairs.map(p => p && key(p[0], p[1]))
    await load(keys.filter(Boolean))
    const missing = []
    const stale = []
    keys.forEach((k, i) => {
      if (!k) return
      const r = mem.get(k)
      if (!r) {
        if (!isFailed(k)) missing.push(i)
      } else if (!isFresh(r)) stale.push(i)
    })
    if (missing.length) {
      const first = missing.slice(0, cfg.inlineMax)
      await within(Promise.allSettled(first.map(i => ensure(pairs[i][0], pairs[i][1], 'inline'))), cfg.inlineBudgetMs)
      missing.slice(cfg.inlineMax).forEach(i => schedule(pairs[i][0], pairs[i][1]))
    }
    stale.forEach(i => schedule(pairs[i][0], pairs[i][1]))
    const nts = items.map((it, i) => (keys[i] ? mem.get(keys[i])?.nt || normTitle(it.title) : ''))
    await loadSiblings(nts)
    return withItems(
      data,
      items.map((it, i) => {
        if (!keys[i]) return it
        const rec = mem.get(keys[i])
        const self = rec || { _id: keys[i], nt: nts[i], type: it.type }
        return fillItem(it, rec, siblingsOf(self))
      })
    )
  }
  async function fillOne(data, source, slug) {
    if (!data || typeof data !== 'object') return data
    const k = key(source, slug)
    await load([k])
    let rec = mem.get(k)
    if (!rec) rec = ingest({ ...data, slug }, source)
    if (rec && hasGaps(rec) && !rec.ext) await within(enrichExternal(k), 2500)
    rec = mem.get(k) || rec
    await loadSiblings([rec?.nt])
    return fillDetail(data, rec, siblingsOf(rec))
  }
  const finalize = (kind, data, source = '') => {
    if (kind === 'detail') return finalizeDetail(data, source, now())
    const items = itemsOf(data)
    return items ? withItems(data, items.map(it => finalizeItem(it, source, now()))) : data
  }
  async function loadCursors() {
    if (cursorsLoaded) return
    const col = collection()
    if (!col) return
    try {
      const row = await col.findOne({ _id: '__cursor__' })
      Object.assign(cursors, row?.pages || {})
      cursorsLoaded = true
    } catch {}
  }
  async function saveCursors() {
    const col = collection()
    if (!col) return
    try {
      await col.updateOne({ _id: '__cursor__' }, { $set: { pages: { ...cursors }, updatedAt: now() } }, { upsert: true })
    } catch {}
  }
  async function crawlOnce({ source = '', pages = cfg.crawlPagesPerCycle } = {}) {
    if (crawling) return lastCrawl
    crawling = true
    const st = { startedAt: now(), seen: 0, synced: 0, failed: 0, skipped: 0 }
    try {
      await loadCursors()
      for (const info of registry.list()) {
        if (source && info.id !== source) continue
        const p = registry.get(info.id)
        if (typeof p?.browse !== 'function' && typeof p?.latest !== 'function') continue
        for (const type of ['', ...(info.filters?.types || [])]) {
          const slot = `${info.id}:${type}`
          const start = cursors[slot] || 1
          const visit = [...new Set([1, 2, ...Array.from({ length: pages }, (_, i) => start + i)])]
          let last = start
          let wrapped = false
          for (const page of visit) {
            let res
            try {
              res = typeof p.browse === 'function' ? await p.browse({ q: '', type, page }) : await p.latest({ page })
            } catch {
              break
            }
            const items = (Array.isArray(res) ? res : res?.items || []).filter(it => it?.slug)
            if (!items.length) {
              if (page >= start) wrapped = true
              break
            }
            await load(items.map(it => key(info.id, it.slug)))
            for (const it of items) {
              st.seen++
              const k = key(info.id, it.slug)
              if (isFresh(mem.get(k), cfg.crawlStaleMs) || isFailed(k)) {
                st.skipped++
                continue
              }
              ;(await ensure(info.id, it.slug, 'bg')) ? st.synced++ : st.failed++
              await sleep(cfg.crawlDelayMs)
            }
            if (page >= start) last = page
            if (!Array.isArray(res) && res?.pages && page >= res.pages) {
              wrapped = true
              break
            }
            await sleep(cfg.crawlDelayMs)
          }
          cursors[slot] = wrapped ? 1 : last + 1
        }
      }
      await saveCursors()
    } catch (err) {
      logger.error?.(`[catalog] crawl gagal → ${err?.message || err}`)
    } finally {
      crawling = false
      lastCrawl = { ...st, finishedAt: now() }
    }
    return lastCrawl
  }
  function startCrawler() {
    if (!cfg.crawl || timers.length) return
    const tick = () => {
      if (collection()) crawlOnce().catch(() => {})
    }
    const first = setTimeout(tick, cfg.crawlFirstDelayMs)
    const every = setInterval(tick, cfg.crawlIntervalMs)
    first.unref?.()
    every.unref?.()
    timers = [first, every]
  }
  function close() {
    timers.forEach(t => {
      clearTimeout(t)
      clearInterval(t)
    })
    timers = []
  }
  async function refresh(source, slug) {
    const k = key(source, slug)
    failedUntil.delete(k)
    const prev = mem.get(k)
    if (prev?.ext && !prev.ext.data) delete prev.ext
    const rec = await sync(source, slug, 'inline')
    if (!rec) return null
    await enrichExternal(k)
    return summary(mem.get(k))
  }
  const summary = r => (r ? { source: r.source, slug: r.slug, title: r.title, syncedAt: r.syncedAt, missing: missingOf(r), filledFromExternal: r.extFilled || [] } : null)
  function status() {
    const bySource = {}
    for (const r of mem.values()) {
      const s = (bySource[r.source] ||= { records: 0, complete: 0, missing: {} })
      s.records++
      const m = missingOf(r)
      if (!m.length) s.complete++
      for (const f of m) s.missing[f] = (s.missing[f] || 0) + 1
    }
    return {
      records: mem.size,
      queued: queue.length,
      syncing: inflight.size,
      failedRecently: [...failedUntil.values()].filter(t => t > now()).length,
      bySource,
      crawl: { enabled: cfg.crawl, running: crawling, cursors: { ...cursors }, last: lastCrawl },
      external: external ? { enabled: !!external.enabled, ...external.stats() } : { enabled: false }
    }
  }
  return { fillList, fillOne, finalize, ingest, ensure, refresh, crawlOnce, startCrawler, close, status }
}
