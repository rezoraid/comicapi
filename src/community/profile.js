import { notFound, badRequest } from '../lib/errors.js'
import { idParam } from './util.js'
import { publicUser, ensurePublicNo, monthsSince } from './users.js'
import { chaptersRead } from './stats.js'
import { USER_LIGHT } from './db.js'

const TABS = ['all', 'comments', 'likes']

const loadUser = async (ctx, id) => {
  const u = await ctx.c.users.findOne({ _id: idParam(id) }, { projection: USER_LIGHT })
  if (!u) throw notFound('Pengguna tidak ditemukan')
  return ensurePublicNo(ctx, u)
}

// Statistik profil: semua angka dihitung dari data tersimpan, tidak ada nilai statis.
export async function getProfile(ctx, viewer, id) {
  const u = await loadUser(ctx, id)
  const self = viewer?._id === u._id
  const [commentCount, chapters] = await Promise.all([
    ctx.c.comments.countDocuments({ userId: u._id, deleted: false }),
    chaptersRead(ctx, u._id)
  ])
  return {
    user: {
      ...publicUser(u, false),
      commentCount,
      chaptersRead: chapters,
      monthsJoined: monthsSince(ctx, u.createdAt),
      joinedAt: u.createdAt || 0
    },
    self
  }
}

// Judul komik untuk komentar lama yang tidak menyimpan judul: ambil dari riwayat/like siapa pun.
const titleLookup = async (ctx, rows) => {
  const keys = [...new Map(rows.map(r => [`${r.source}:${r.slug}`, { source: r.source, slug: r.slug }])).values()]
  const out = new Map()
  if (!keys.length) return out
  const or = keys.map(k => ({ source: k.source, slug: k.slug }))
  const [a, b] = await Promise.all([
    ctx.c.readingProgress.find({ $or: or, comicTitle: { $ne: '' } }, { projection: { source: 1, slug: 1, comicTitle: 1, coverUrl: 1, chapterTitle: 1 }, limit: 100 }).toArray(),
    ctx.c.likes.find({ $or: or, comicTitle: { $ne: '' } }, { projection: { source: 1, slug: 1, comicTitle: 1, coverUrl: 1, chapterTitle: 1 }, limit: 100 }).toArray()
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

/** Satu aggregation menggantikan N countDocuments per comic di tab history. */
async function batchChaptersReadByComic(ctx, userId, rows) {
  if (!rows.length) return new Map()
  const pairs = [...new Map(rows.map(r => [`${r.source}:${r.slug}`, { source: r.source, slug: r.slug }])).values()]
  const agg = await ctx.c.chapterReads
    .aggregate([
      { $match: { userId, counted: true, $or: pairs } },
      { $group: { _id: { source: '$source', slug: '$slug' }, n: { $sum: 1 } } }
    ])
    .toArray()
  return new Map(agg.map(r => [`${r._id.source}:${r._id.slug}`, r.n]))
}

export async function listActivity(ctx, viewer, id, { tab, page, limit }) {
  if (!TABS.includes(tab)) throw badRequest('"tab" harus all, comments, atau likes')
  const u = await loadUser(ctx, id)
  const skip = (page - 1) * limit
  let rows
  if (tab === 'all') rows = await ctx.c.readingProgress.find({ userId: u._id }, { sort: { updatedAt: -1 }, skip, limit: limit + 1 }).toArray()
  else if (tab === 'likes') rows = await ctx.c.likes.find({ userId: u._id }, { sort: { createdAt: -1 }, skip, limit: limit + 1 }).toArray()
  else rows = await ctx.c.comments.find({ userId: u._id, deleted: false }, { sort: { _id: -1 }, skip, limit: limit + 1 }).toArray()
  const hasMore = rows.length > limit
  rows = rows.slice(0, limit)
  const [titles, reads] = await Promise.all([
    tab === 'comments' || rows.some(badTitle) ? titleLookup(ctx, rows) : Promise.resolve(new Map()),
    tab === 'all' ? batchChaptersReadByComic(ctx, u._id, rows) : Promise.resolve(new Map())
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
