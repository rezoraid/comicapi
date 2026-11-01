import { newId, isDup, sum, DAY } from './util.js'

export const XP = { comment: 5, reply: 3, likeReceived: 2 }
export const DAILY_CAP = { post: 50, like: 20 }
export const MAX_LEVEL = 100
export const LIKE_PAIR_DAILY = 3
export const LIKER_MIN_AGE_MS = 3_600_000

export const xpForLevel = level => 25 * level * (level - 1)
export const levelFromXp = xp => Math.min(MAX_LEVEL, Math.max(1, Math.floor((1 + Math.sqrt(1 + (4 * Math.max(0, xp)) / 25)) / 2)))
export const progress = xp => {
  const level = levelFromXp(xp)
  return { level, xp, xpCurrentLevel: xpForLevel(level), xpNextLevel: level >= MAX_LEVEL ? xpForLevel(level) : xpForLevel(level + 1) }
}

export const isQuality = text => {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length < 8 || t.split(' ').length < 2) return false
  if (new Set(t.toLowerCase()).size < 5) return false
  return !/(.)\1{5,}/u.test(t)
}

const syncLevel = async (ctx, userId) => {
  const u = await ctx.c.users.findOne({ _id: userId })
  if (!u) return null
  const xp = Math.max(0, u.xp || 0)
  const level = levelFromXp(xp)
  if (xp !== u.xp || level !== u.level) await ctx.c.users.updateOne({ _id: userId }, { $set: { xp, level } })
  return { ...u, xp, level }
}

export async function awardXp(ctx, { userId, type, refId, commentId, amount, group, fromUserId = null }) {
  const now = ctx.now()
  const since = now - DAY
  const recent = await ctx.c.xpEvents.find({ userId, group, reversed: false, createdAt: { $gte: since } }).toArray()
  const grant = Math.min(amount, DAILY_CAP[group] - sum(recent, 'xp'))
  if (grant <= 0) return 0
  if (fromUserId && recent.filter(e => e.fromUserId === fromUserId).length >= LIKE_PAIR_DAILY) return 0
  try {
    await ctx.c.xpEvents.insertOne({ _id: newId(), userId, type, refId, commentId, group, fromUserId, xp: grant, reversed: false, createdAt: now })
  } catch (e) {
    if (isDup(e)) return 0
    throw e
  }
  await ctx.c.users.updateOne({ _id: userId }, { $inc: { xp: grant } })
  await syncLevel(ctx, userId)
  return grant
}

export async function reverseXp(ctx, commentId) {
  const events = await ctx.c.xpEvents.find({ commentId, reversed: false }).toArray()
  const byUser = new Map()
  for (const e of events) {
    const r = await ctx.c.xpEvents.updateOne({ _id: e._id, reversed: false }, { $set: { reversed: true } })
    if (r.modifiedCount === 1) byUser.set(e.userId, (byUser.get(e.userId) || 0) + e.xp)
  }
  for (const [userId, total] of byUser) {
    await ctx.c.users.updateOne({ _id: userId }, { $inc: { xp: -total } })
    await syncLevel(ctx, userId)
  }
}
