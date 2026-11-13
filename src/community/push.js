import { createHash } from 'node:crypto'
import { badRequest } from '../lib/errors.js'

const TOKEN = /^[\w:.\-]{20,4096}$/
const MAX_TOKENS = 20_000
const PARALLEL = 16

export const topicOf = (source, slug) => `c_${createHash('sha1').update(`${source}|${slug}`).digest('hex').slice(0, 24)}`

const cleanToken = (v, name) => {
  if (typeof v !== 'string' || !TOKEN.test(v)) throw badRequest(`"${name}" tidak valid`)
  return v
}

export async function registerToken(ctx, user, body) {
  const token = cleanToken(body?.token, 'token')
  const previous = body?.previous ? cleanToken(body.previous, 'previous') : ''
  const now = ctx.now()
  if (previous && previous !== token) await ctx.c.pushTokens.deleteOne({ _id: previous })
  await ctx.c.pushTokens.updateOne({ _id: token }, { $set: { userId: user?._id || '', updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true })
  return { ok: true }
}

export async function unregisterToken(ctx, body) {
  await ctx.c.pushTokens.deleteOne({ _id: cleanToken(body?.token, 'token') })
  return { ok: true }
}

const runPool = async (items, fn) => {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

export async function pushBroadcast(ctx, b) {
  if (!ctx.fcm?.enabled) return { sent: 0 }
  const rows = await ctx.c.pushTokens.find({}, { limit: MAX_TOKENS }).toArray()
  const data = { type: 'broadcast', id: b._id, title: b.title, body: b.body, source: b.source || '', slug: b.slug || '', createdAt: b.createdAt }
  let sent = 0
  await runPool(rows, async row => {
    const r = await ctx.fcm.send({ token: row._id }, data, { ttl: 3 * 86400 })
    if (r.ok) sent++
    else if (r.gone) await ctx.c.pushTokens.deleteOne({ _id: row._id }).catch(() => {})
  })
  return { sent }
}

export function createChapterAlerts({ fcm, logger = console, now = Date.now, maxPerPass = 30 }) {
  const seen = new Map()
  const primed = new Set()
  return {
    async observe(source, items) {
      if (!fcm?.enabled || !Array.isArray(items)) return 0
      const fresh = []
      for (const it of items) {
        const top = it?.chapters?.[0]
        const slug = it?.slug
        if (!slug || !top?.slug) continue
        const key = `${source}|${slug}`
        const prev = seen.get(key)
        seen.set(key, top.slug)
        if (primed.has(source) && prev !== undefined && prev !== top.slug) fresh.push({ it, top })
      }
      primed.add(source)
      if (seen.size > 20_000) seen.clear()
      let sent = 0
      for (const { it, top } of fresh.slice(0, maxPerPass)) {
        const r = await fcm.send({ topic: topicOf(source, it.slug) }, {
          type: 'chapter', id: `${source}:${it.slug}:${top.slug}`, source, slug: it.slug, title: it.title || it.slug,
          chapterSlug: top.slug, chapter: top.number || '', createdAt: now()
        }, { ttl: 86400 })
        if (r.ok) sent++
      }
      if (fresh.length) logger.log(`[push] ${source}: ${fresh.length} komik punya chapter baru, ${sent} terkirim`)
      return sent
    }
  }
}
