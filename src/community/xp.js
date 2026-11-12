import { newId, isDup, sum, DAY, NO_BLOB } from './util.js'

export const XP = { comment: 5, reply: 3, likeReceived: 2, chapterRead: 8 }
const DAILY_CAP = { post: 50, like: 20, read: 80 }
const MAX_LEVEL = 100
const LIKE_PAIR_DAILY = 3
export const LIKER_MIN_AGE_MS = 3_600_000

export const xpForLevel = level => 25 * level * (level - 1)
export const levelFromXp = xp => Math.min(MAX_LEVEL, Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 25)) / 2)))
export const progress = xp => {
  const level = levelFromXp(xp)
  return { level, xp, xpCurrentLevel: xpForLevel(level), xpNextLevel: level >= MAX_LEVEL ? xpForLevel(level) : xpForLevel(level + 1) }
}

export const isQuality = text => {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length < 6) return false
  if (new Set(t.toLowerCase()).size < 4) return false
  if (/(.)\1{5,}/u.test(t)) return false
  const words = t.toLowerCase().split(' ')
  return words.length < 3 || new Set(words).size > 1
}

const fixLevel = async (ctx, u) => {
  if (!u) return null
  const xp = Math.max(0, u.xp || 0)
  const level = levelFromXp(xp)
  if (xp !== u.xp || level !== u.level) await ctx.c.users.updateOne({ _id: u._id }, { $set: { xp, level } })
  return { ...u, xp, level }
}

const incXp = async (ctx, userId, delta) =>
  fixLevel(ctx, await ctx.c.users.findOneAndUpdate({ _id: userId }, { $inc: { xp: delta } }, { returnDocument: 'after', projection: { customPicture: 0 } }))

export async function awardXp(ctx, { userId, type, refId, commentId, amount, group, fromUserId = null }) {
  const now = ctx.now()
  const since = now - DAY
  const cap = DAILY_CAP[group]
  const recent = await ctx.c.xpEvents.find({ userId, group, reversed: false, createdAt: { $gte: since } }, { projection: { xp: 1, fromUserId: 1 } }).toArray()
  const grant = Math.min(amount, cap - sum(recent, 'xp'))
  if (grant <= 0) return 0
  if (fromUserId && recent.filter(e => e.fromUserId === fromUserId).length >= LIKE_PAIR_DAILY) return 0
  const id = newId()
  try {
    await ctx.c.xpEvents.insertOne({ _id: id, userId, type, refId, commentId, group, fromUserId, xp: grant, reversed: false, createdAt: now })
  } catch (e) {
    if (isDup(e)) return 0
    throw e
  }
  const rows = await ctx.c.xpEvents.find({ userId, group, reversed: false, createdAt: { $gte: since } }, { projection: { xp: 1, fromUserId: 1 } }).toArray()
  let final = Math.max(0, Math.min(grant, grant - (sum(rows, 'xp') - cap)))
  if (fromUserId && rows.filter(e => e.fromUserId === fromUserId).length > LIKE_PAIR_DAILY) final = 0
  if (final !== grant) {
    if (final <= 0) await ctx.c.xpEvents.deleteOne({ _id: id })
    else await ctx.c.xpEvents.updateOne({ _id: id }, { $set: { xp: final } })
  }
  if (final <= 0) return 0
  await incXp(ctx, userId, final)
  return final
}

export async function reverseXp(ctx, commentId, group = null) {
  const events = await ctx.c.xpEvents.find({ commentId, reversed: false, ...(group ? { group } : {}) }).toArray()
  const byUser = new Map()
  for (const e of events) {
    const r = await ctx.c.xpEvents.updateOne({ _id: e._id, reversed: false }, { $set: { reversed: true } })
    if (r.modifiedCount === 1) byUser.set(e.userId, (byUser.get(e.userId) || 0) + e.xp)
  }
  for (const [userId, total] of byUser) {
    await incXp(ctx, userId, -total)
  }
}

export async function reconcileXp(ctx, userId) {
  const [rows, u] = await Promise.all([
    ctx.c.xpEvents.aggregate([{ $match: { userId, reversed: false } }, { $group: { _id: null, total: { $sum: '$xp' } } }]).toArray(),
    ctx.c.users.findOne({ _id: userId }, NO_BLOB)
  ])
  if (!u) return null
  const xp = Math.max(0, rows[0]?.total || 0)
  const level = levelFromXp(xp)
  if (xp !== u.xp || level !== u.level) await ctx.c.users.updateOne({ _id: userId }, { $set: { xp, level } })
  return { ...u, xp, level }
}
