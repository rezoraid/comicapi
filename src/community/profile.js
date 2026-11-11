import { notFound, badRequest } from '../lib/errors.js'
import { idParam, NO_BLOB } from './util.js'
import { publicUser, ensurePublicNo, monthsSince } from './users.js'
import { chaptersRead, chaptersReadByComics } from './stats.js'

const TABS = ['all', 'comments', 'likes']

const loadUser = async (ctx, id) => {
  const u = await ctx.c.users.findOne({ _id: idParam(id) }, NO_BLOB)
  if (!u) throw notFound('Pengguna tidak ditemukan')
  return ensurePublicNo(ctx, u)
}

export async function getProfile(ctx, viewer, id) {
  const u = await loadUser(ctx, id)
  const self = viewer?._id === u._id
  const [commentCount, read] = await Promise.all([ctx.c.comments.countDocuments({ userId: u._id, deleted: false }), chaptersRead(ctx, u._id)])
  return {
    user: {
      ...publicUser(u, false),
      commentCount,
      chaptersRead: read,
      monthsJoined: monthsSince(ctx, u.createdAt),
      joinedAt: u.createdAt || 0
    },
    self
  }
}

const titleLookup = async (ctx, rows) => {
  const keys = [...new Map(rows.map(r => [`${r.source}:${r.slug}`, { source: r.source, slug: r.slug }])).values()]
  const out = new Map()
  if (!keys.length) return out
  const or = keys.map(k => ({ source: k.source, slug: k.slug }))
  const [a, b] = await Promise.all([
    ctx.c.readingProgress.find({ $or: or, comicTitle: { $ne: '' } }, { limit: 100 }).toArray(),
    ctx.c.likes.find({ $or: or, comicTitle: { $ne: '' } }, { limit: 100 }).toArray()
  ])
  for (const r of [...a, ...b].filter(r => !badTitle(r))) {
    const k = `${r.source}:${r.slug}`
    const cur = out.get(k) || {}
    out.set(k, { comicTitle: cur.comicTitle || r.comicTitle, coverUrl: cur.coverUrl || r.coverUrl || '' })
  }
  return out
}

const badTitle = r => !r.comicTitle || r.comicTitle === r.chapterTitle || /^(chapter|ch\.?|bab|episode)\s*\d/i.test(r.comicTitle)

const pretty = slug => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

export async function listActivity(ctx, viewer, id, { tab, page, limit }) {
  if (!TABS.includes(tab)) throw badRequest('"tab" harus all, comments, atau likes')
  const u = await loadUser(ctx, id)
  if (tab === 'all') await ctx.progress.flushFor(u._id)
  const skip = (page - 1) * limit
  let rows
  if (tab === 'all') rows = await ctx.c.readingProgress.find({ userId: u._id }, { sort: { updatedAt: -1 }, skip, limit: limit + 1 }).toArray()
  else if (tab === 'likes') rows = await ctx.c.likes.find({ userId: u._id }, { sort: { createdAt: -1 }, skip, limit: limit + 1 }).toArray()
  else rows = await ctx.c.comments.find({ userId: u._id, deleted: false }, { sort: { _id: -1 }, skip, limit: limit + 1 }).toArray()
  const hasMore = rows.length > limit
  rows = rows.slice(0, limit)
  const [titles, reads] = await Promise.all([
    tab === 'comments' || rows.some(badTitle) ? titleLookup(ctx, rows) : new Map(),
    tab === 'all' ? chaptersReadByComics(ctx, u._id, rows) : new Map()
  ])
  const items = rows.map(r => {
    const t = titles.get(`${r.source}:${r.slug}`) || {}
    const base = {
      source: r.source,
      slug: r.slug,
      chapter: r.chapter || null,
      comicTitle: (!badTitle(r) && r.comicTitle) || t.comicTitle || pretty(r.slug),
      chapterTitle: r.chapterTitle || '',
      coverUrl: r.coverUrl || t.coverUrl || ''
    }
    if (tab === 'all') return { kind: 'history', ...base, at: r.updatedAt, chaptersRead: reads.get(`${r.source}:${r.slug}`) || 0 }
    if (tab === 'likes') return { kind: 'like', ...base, type: r.type, at: r.createdAt }
    return { kind: 'comment', ...base, type: r.type, id: r._id, body: r.body, isReply: !!r.parentId, likeCount: r.likeCount || 0, replyCount: r.replyCount || 0, at: r.createdAt }
  })
  return { items, hasMore, page }
}
