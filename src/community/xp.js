import { newId, isDup, sum, DAY } from './util.js'

export const XP = { comment: 5, reply: 3, likeReceived: 2, chapterRead: 8 }
export const DAILY_CAP = { post: 50, like: 20, read: 80 }
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
  if (t.length < 6) return false
  if (new Set(t.toLowerCase()).size < 4) return false
  if (/(.)\1{5,}/u.test(t)) return false
  const words = t.toLowerCase().split(' ')
  return words.length < 3 || new Set(words).size > 1
}

/** Sinkron level dari field xp yang sudah ada. Bisa terima user cached agar hemat 1 query. */
export const syncLevel = async (ctx, userId, cached = null) => {
  const u = cached && cached._id === userId ? cached : await ctx.c.users.findOne({ _id: userId }, { projection: { xp: 1, level: 1 } })
  if (!u) return null
  const xp = Math.max(0, u.xp || 0)
  const level = levelFromXp(xp)
  if (xp !== (u.xp || 0) || level !== (u.level || 0)) {
    await ctx.c.users.updateOne({ _id: userId }, { $set: { xp, level } })
  }
  return { ...u, xp, level }
}

/**
 * Award XP dengan 1 aggregation untuk cap harian + insert + $inc.
 * Hindari double-fetch seluruh event seperti versi lama.
 */
export async function awardXp(ctx, { userId, type, refId, commentId, amount, group, fromUserId = null }) {
  const now = ctx.now()
  const since = now - DAY
  const cap = DAILY_CAP[group]
  if (!cap || amount <= 0) return 0

  // Satu aggregation: total XP group hari ini + jumlah pair dari fromUserId
  const [agg] = await ctx.c.xpEvents
    .aggregate([
      { $match: { userId, group, reversed: false, createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          total: { $sum: '$xp' },
          fromPair: {
            $sum: {
              $cond: [{ $and: [{ $ne: [fromUserId, null] }, { $eq: ['$fromUserId', fromUserId] }] }, 1, 0]
            }
          }
        }
      }
    ])
    .toArray()

  const used = agg?.total || 0
  const pairCount = agg?.fromPair || 0
  if (fromUserId && pairCount >= LIKE_PAIR_DAILY) return 0
  const grant = Math.min(amount, cap - used)
  if (grant <= 0) return 0

  const id = newId()
  try {
    await ctx.c.xpEvents.insertOne({
      _id: id,
      userId,
      type,
      refId,
      commentId,
      group,
      fromUserId,
      xp: grant,
      reversed: false,
      createdAt: now
    })
  } catch (e) {
    if (isDup(e)) return 0
    throw e
  }

  // Race: request paralel bisa melebihi cap. Cek ulang cepat; kalau overflow, potong.
  const [after] = await ctx.c.xpEvents
    .aggregate([
      { $match: { userId, group, reversed: false, createdAt: { $gte: since } } },
      {
        $group: {
          _id: null,
          total: { $sum: '$xp' },
          fromPair: {
            $sum: {
              $cond: [{ $and: [{ $ne: [fromUserId, null] }, { $eq: ['$fromUserId', fromUserId] }] }, 1, 0]
            }
          }
        }
      }
    ])
    .toArray()

  let final = grant
  const over = (after?.total || 0) - cap
  if (over > 0) final = Math.max(0, grant - over)
  if (fromUserId && (after?.fromPair || 0) > LIKE_PAIR_DAILY) final = 0

  if (final !== grant) {
    if (final <= 0) await ctx.c.xpEvents.deleteOne({ _id: id })
    else await ctx.c.xpEvents.updateOne({ _id: id }, { $set: { xp: final } })
  }
  if (final <= 0) return 0

  await ctx.c.users.updateOne({ _id: userId }, { $inc: { xp: final } })
  // Level dihitung lazy di syncLevel /me; hindari find+update ekstra di path like/comment.
  // Tetap sync di sini agar response yang butuh level tetap akurat.
  await syncLevel(ctx, userId)
  return final
}

export async function reverseXp(ctx, commentId, group = null) {
  const filter = { commentId, reversed: false, ...(group ? { group } : {}) }
  const events = await ctx.c.xpEvents.find(filter, { projection: { userId: 1, xp: 1 } }).toArray()
  if (!events.length) return

  const ids = events.map(e => e._id)
  const r = await ctx.c.xpEvents.updateMany({ _id: { $in: ids }, reversed: false }, { $set: { reversed: true } })
  if (r.modifiedCount === 0) return

  const byUser = new Map()
  for (const e of events) byUser.set(e.userId, (byUser.get(e.userId) || 0) + (e.xp || 0))

  await Promise.all(
    [...byUser.entries()].map(async ([userId, total]) => {
      await ctx.c.users.updateOne({ _id: userId }, { $inc: { xp: -total } })
      await syncLevel(ctx, userId)
    })
  )
}

/** Rekonsiliasi penuh: jumlah ulang semua event non-reversed. Mahal — panggil jarang. */
export async function reconcileXp(ctx, userId) {
  const [agg] = await ctx.c.xpEvents
    .aggregate([{ $match: { userId, reversed: false } }, { $group: { _id: null, total: { $sum: '$xp' } } }])
    .toArray()
  const total = Math.max(0, agg?.total || 0)
  const u = await ctx.c.users.findOne({ _id: userId }, { projection: { xp: 1, level: 1 } })
  if (!u) return null
  if ((u.xp || 0) !== total) await ctx.c.users.updateOne({ _id: userId }, { $set: { xp: total } })
  return syncLevel(ctx, userId, { ...u, xp: total })
}
