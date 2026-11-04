import { badRequest, notFound, forbidden, conflict } from '../lib/errors.js'
import { newId, isDup, rank, hit, idParam, bodyText, bodyHash, SLUG, CHAPTER, DAY } from './util.js'
import { publicUser } from './users.js'
import { XP, LIKER_MIN_AGE_MS, awardXp, reverseXp, isQuality } from './xp.js'

export const REPORT_REASONS = ['spam', 'abuse', 'hate', 'spoiler', 'other']

export function resolveTarget(input, hasSource) {
  const { type, source, slug, chapter } = input
  if (type !== 'comic' && type !== 'chapter') throw badRequest('"type" harus comic atau chapter')
  if (typeof source !== 'string' || !hasSource(source)) throw badRequest('"source" tidak valid')
  if (typeof slug !== 'string' || !SLUG.test(slug)) throw badRequest('"slug" tidak valid')
  if (type === 'chapter' && (typeof chapter !== 'string' || !CHAPTER.test(chapter))) throw badRequest('"chapter" tidak valid')
  return { type, source, slug, chapter: type === 'chapter' ? chapter : null, targetKey: type === 'chapter' ? `${source}:${slug}:${chapter}` : `${source}:${slug}` }
}

const canDeleteComment = (viewer, comment, author) =>
  !!viewer && !comment.deleted && (viewer._id === comment.userId || rank(viewer) === 3 || (rank(viewer) === 2 && rank(author) < 2))

const hydrate = async (ctx, viewer, docs) => {
  const ids = new Set()
  docs.forEach(d => (ids.add(d.userId), d.replyToUserId && ids.add(d.replyToUserId)))
  const users = ids.size ? await ctx.c.users.find({ _id: { $in: [...ids] } }).toArray() : []
  const byId = new Map(users.map(u => [u._id, u]))
  const liked = new Set()
  if (viewer && docs.length) {
    const likes = await ctx.c.commentLikes.find({ userId: viewer._id, commentId: { $in: docs.map(d => d._id) } }).toArray()
    likes.forEach(l => liked.add(l.commentId))
  }
  return docs.map(d => {
    const author = byId.get(d.userId)
    return {
      id: d._id,
      type: d.type,
      source: d.source,
      slug: d.slug,
      chapter: d.chapter,
      parentId: d.parentId,
      replyTo: d.replyToUserId ? byId.get(d.replyToUserId)?.username || null : null,
      body: d.deleted ? '' : d.body,
      deleted: d.deleted,
      edited: !!d.edited,
      createdAt: d.createdAt,
      likeCount: d.likeCount,
      replyCount: d.replyCount,
      liked: liked.has(d._id),
      canEdit: !!viewer && !d.deleted && viewer._id === d.userId,
      canDelete: author ? canDeleteComment(viewer, d, author) : false,
      user: author ? publicUser(author) : { id: d.userId, username: 'terhapus', name: 'Pengguna', picture: '', role: 'USER', verified: false, level: 1 }
    }
  })
}

const page = async (ctx, viewer, filter, sort, pageNo, limit) => {
  const rows = await ctx.c.comments.find(filter, { sort, skip: (pageNo - 1) * limit, limit: limit + 1 }).toArray()
  return { items: await hydrate(ctx, viewer, rows.slice(0, limit)), hasMore: rows.length > limit, page: pageNo }
}

export async function listComments(ctx, viewer, target, { sort = 'newest', page: pageNo = 1, limit = 15 }) {
  const order = sort === 'top' ? { likeCount: -1, _id: -1 } : { _id: -1 }
  const [res, total] = await Promise.all([
    page(ctx, viewer, { targetKey: target.targetKey, parentId: null, listed: true }, order, pageNo, limit),
    ctx.c.comments.countDocuments({ targetKey: target.targetKey, deleted: false })
  ])
  return { ...res, total }
}

export async function listReplies(ctx, viewer, rootId, { page: pageNo = 1, limit = 15 }) {
  const root = await ctx.c.comments.findOne({ _id: idParam(rootId), parentId: null })
  if (!root) throw notFound('Komentar tidak ditemukan')
  return page(ctx, viewer, { parentId: root._id, deleted: false }, { _id: 1 }, pageNo, limit)
}

export async function createComment(ctx, user, input, hasSource) {
  hit(ctx.limits.commentBurst, user._id, 'Terlalu cepat mengirim komentar')
  hit(ctx.limits.commentHour, user._id, 'Batas komentar per jam tercapai')
  const body = bodyText(input.body, 'body', { max: 1000 })
  const now = ctx.now()
  let parent = null
  let root = null
  let target
  if (input.parentId !== undefined && input.parentId !== null) {
    parent = await ctx.c.comments.findOne({ _id: idParam(input.parentId, 'parentId') })
    if (!parent || parent.deleted) throw notFound('Komentar yang dibalas tidak ditemukan')
    root = parent.parentId ? await ctx.c.comments.findOne({ _id: parent.parentId }) : parent
    if (!root || root.deleted) throw notFound('Komentar yang dibalas tidak ditemukan')
    target = { type: root.type, source: root.source, slug: root.slug, chapter: root.chapter, targetKey: root.targetKey }
  } else target = resolveTarget(input, hasSource)
  const hash = bodyHash(body)
  const dup = await ctx.c.comments.findOne({ userId: user._id, bodyHash: hash, deleted: false, createdAt: { $gte: now - DAY } })
  if (dup) throw conflict('Komentar yang sama sudah kamu kirim', 'DUPLICATE_COMMENT')
  const doc = {
    _id: newId(),
    ...target,
    parentId: root ? root._id : null,
    replyToUserId: parent && parent.parentId ? parent.userId : null,
    userId: user._id,
    body,
    bodyHash: hash,
    likeCount: 0,
    replyCount: 0,
    reportCount: 0,
    edited: false,
    deleted: false,
    listed: true,
    createdAt: now
  }
  await ctx.c.comments.insertOne(doc)
  if (root) await ctx.c.comments.updateOne({ _id: root._id }, { $inc: { replyCount: 1 }, $set: { listed: true } })
  let xpGained = 0
  let xpReason = null
  if (!isQuality(body)) xpReason = 'LOW_QUALITY'
  else {
    xpGained = await awardXp(ctx, {
      userId: user._id,
      type: root ? 'reply' : 'comment',
      refId: doc._id,
      commentId: doc._id,
      amount: root ? XP.reply : XP.comment,
      group: 'post'
    })
    if (xpGained <= 0) xpReason = 'DAILY_CAP'
  }
  const fresh = await ctx.c.users.findOne({ _id: user._id })
  const [comment] = await hydrate(ctx, fresh, [doc])
  return { comment, xpGained, xpReason, user: publicUser(fresh, true) }
}

export async function editComment(ctx, user, id, input) {
  hit(ctx.limits.write, user._id, 'Terlalu banyak perubahan')
  const c = await ctx.c.comments.findOne({ _id: idParam(id) })
  if (!c || c.deleted) throw notFound('Komentar tidak ditemukan')
  if (c.userId !== user._id) throw forbidden('Kamu hanya bisa mengedit komentar sendiri')
  const body = bodyText(input.body, 'body', { max: 1000 })
  if (body !== c.body) {
    const hash = bodyHash(body)
    const dup = await ctx.c.comments.findOne({ userId: user._id, bodyHash: hash, deleted: false, createdAt: { $gte: ctx.now() - DAY } })
    if (dup && dup._id !== c._id) throw conflict('Komentar yang sama sudah kamu kirim', 'DUPLICATE_COMMENT')
    await ctx.c.comments.updateOne({ _id: c._id }, { $set: { body, bodyHash: hash, edited: true, editedAt: ctx.now() } })
    if (!isQuality(body)) await reverseXp(ctx, c._id, 'post')
  }
  const [comment] = await hydrate(ctx, user, [{ ...c, body, edited: body !== c.body ? true : c.edited }])
  return { comment }
}

export async function removeComment(ctx, actor, id) {
  hit(ctx.limits.write, actor._id, 'Terlalu banyak perubahan')
  const c = await ctx.c.comments.findOne({ _id: idParam(id) })
  if (!c) throw notFound('Komentar tidak ditemukan')
  if (c.deleted) return { ok: true }
  const author = await ctx.c.users.findOne({ _id: c.userId })
  if (!canDeleteComment(actor, c, author || { role: 'USER' })) throw forbidden('Kamu tidak boleh menghapus komentar ini')
  await deleteDoc(ctx, c, actor._id)
  return { ok: true }
}

export async function deleteDoc(ctx, c, byId) {
  const r = await ctx.c.comments.updateOne(
    { _id: c._id, deleted: false },
    { $set: { deleted: true, deletedAt: ctx.now(), deletedBy: byId, body: '', listed: c.parentId ? false : c.replyCount > 0 } }
  )
  if (r.modifiedCount !== 1) return
  if (c.parentId) {
    await ctx.c.comments.updateOne({ _id: c.parentId }, { $inc: { replyCount: -1 } })
    const root = await ctx.c.comments.findOne({ _id: c.parentId })
    if (root && root.deleted && root.replyCount <= 0) await ctx.c.comments.updateOne({ _id: root._id }, { $set: { listed: false } })
  }
  await reverseXp(ctx, c._id)
}

export async function likeComment(ctx, user, id, on) {
  hit(ctx.limits.like, user._id, 'Terlalu banyak like')
  const c = await ctx.c.comments.findOne({ _id: idParam(id), deleted: false })
  if (!c) throw notFound('Komentar tidak ditemukan')
  if (on) {
    try {
      await ctx.c.commentLikes.insertOne({ _id: newId(), commentId: c._id, userId: user._id, createdAt: ctx.now() })
      await ctx.c.comments.updateOne({ _id: c._id }, { $inc: { likeCount: 1 } })
      if (c.userId !== user._id && ctx.now() - user.createdAt >= LIKER_MIN_AGE_MS) {
        await awardXp(ctx, {
          userId: c.userId,
          type: 'like_received',
          refId: `${c._id}:${user._id}`,
          commentId: c._id,
          amount: XP.likeReceived,
          group: 'like',
          fromUserId: user._id
        })
      }
    } catch (e) {
      if (!isDup(e)) throw e
    }
  } else {
    const r = await ctx.c.commentLikes.deleteOne({ commentId: c._id, userId: user._id })
    if (r.deletedCount === 1) await ctx.c.comments.updateOne({ _id: c._id }, { $inc: { likeCount: -1 } })
  }
  const fresh = await ctx.c.comments.findOne({ _id: c._id })
  return { liked: on, likeCount: Math.max(0, fresh.likeCount) }
}

export async function reportComment(ctx, user, id, input) {
  hit(ctx.limits.report, user._id, 'Batas laporan tercapai')
  const c = await ctx.c.comments.findOne({ _id: idParam(id), deleted: false })
  if (!c) throw notFound('Komentar tidak ditemukan')
  if (c.userId === user._id) throw badRequest('Tidak bisa melaporkan komentar sendiri')
  if (!REPORT_REASONS.includes(input.reason)) throw badRequest(`"reason" harus salah satu: ${REPORT_REASONS.join(', ')}`)
  const note = bodyText(input.note, 'note', { min: 0, max: 300, optional: true })
  try {
    await ctx.c.reports.insertOne({ _id: newId(), commentId: c._id, reporterId: user._id, targetUserId: c.userId, reason: input.reason, note, status: 'open', createdAt: ctx.now() })
  } catch (e) {
    if (isDup(e)) throw conflict('Kamu sudah melaporkan komentar ini', 'ALREADY_REPORTED')
    throw e
  }
  await ctx.c.comments.updateOne({ _id: c._id }, { $inc: { reportCount: 1 } })
  return { ok: true }
}

export async function chapterCounts(ctx, source, slug) {
  const cache = (ctx.countCache ||= new Map())
  const key = `${source}:${slug}`
  const now = ctx.now()
  const hit = cache.get(key)
  if (hit && now - hit.t < 15_000) return hit.v
  const rows = await ctx.c.comments.find({ type: 'chapter', source, slug, deleted: false }, { projection: { chapter: 1 } }).toArray()
  const counts = {}
  for (const r of rows) counts[r.chapter] = (counts[r.chapter] || 0) + 1
  const v = { counts }
  cache.set(key, { t: now, v })
  if (cache.size > 500) cache.delete(cache.keys().next().value)
  return v
}
