import { badRequest, forbidden, notFound } from '../lib/errors.js'
import { rank, idParam, qstr, newId } from './util.js'
import { publicUser } from './users.js'
import { deleteDoc } from './comments.js'
import { reconcileXp } from './xp.js'
import { chaptersRead } from './stats.js'

const needMod = u => {
  if (rank(u) < 2) throw forbidden('Hanya MODERATOR atau OWNER yang boleh melakukan ini')
}

export async function listReports(ctx, actor, { status = 'open', page = 1, limit = 20 }) {
  needMod(actor)
  if (!['open', 'resolved', 'dismissed'].includes(status)) throw badRequest('"status" tidak valid')
  const rows = await ctx.c.reports.find({ status }, { sort: { _id: -1 }, skip: (page - 1) * limit, limit: limit + 1 }).toArray()
  const reports = rows.slice(0, limit)
  const comments = reports.length ? await ctx.c.comments.find({ _id: { $in: reports.map(r => r.commentId) } }).toArray() : []
  const userIds = [...new Set([...reports.map(r => r.reporterId), ...comments.map(c => c.userId)])]
  const users = userIds.length ? await ctx.c.users.find({ _id: { $in: userIds } }).toArray() : []
  const cById = new Map(comments.map(c => [c._id, c]))
  const uById = new Map(users.map(u => [u._id, u]))
  return {
    page,
    hasMore: rows.length > limit,
    items: reports.map(r => {
      const c = cById.get(r.commentId)
      return {
        id: r._id,
        reason: r.reason,
        note: r.note,
        status: r.status,
        createdAt: r.createdAt,
        reporter: uById.has(r.reporterId) ? publicUser(uById.get(r.reporterId)) : null,
        comment: c
          ? { id: c._id, body: c.body, deleted: c.deleted, targetKey: c.targetKey, reportCount: c.reportCount, user: uById.has(c.userId) ? publicUser(uById.get(c.userId)) : null }
          : null
      }
    })
  }
}

export async function resolveReport(ctx, actor, id, action) {
  needMod(actor)
  if (action !== 'delete' && action !== 'dismiss') throw badRequest('"action" harus delete atau dismiss')
  const report = await ctx.c.reports.findOne({ _id: idParam(id) })
  if (!report) throw notFound('Laporan tidak ditemukan')
  if (action === 'delete') {
    const c = await ctx.c.comments.findOne({ _id: report.commentId })
    if (c && !c.deleted) {
      const author = await ctx.c.users.findOne({ _id: c.userId })
      if (rank(actor) < 3 && rank(author) >= rank(actor)) throw forbidden('Kamu tidak boleh menghapus komentar pengguna dengan role ini')
      await deleteDoc(ctx, c, actor._id)
    }
  }
  const status = action === 'delete' ? 'resolved' : 'dismissed'
  await ctx.c.reports.updateMany({ commentId: report.commentId, status: 'open' }, { $set: { status, resolvedBy: actor._id, resolvedAt: ctx.now() } })
  return { ok: true, status }
}

export async function findUser(ctx, actor, query) {
  needMod(actor)
  const username = qstr(query, 'username', 20).toLowerCase()
  if (!username) throw badRequest('Parameter "username" wajib diisi')
  const u = await ctx.c.users.findOne({ username })
  if (!u) throw notFound('Pengguna tidak ditemukan')
  return { user: { ...publicUser(u), email: u.email, banned: !!u.banned } }
}

export async function setRole(ctx, actor, id, role) {
  if (rank(actor) < 3) throw forbidden('Hanya OWNER yang boleh mengubah role')
  const uid = idParam(id)
  if (uid === actor._id) throw forbidden('Tidak bisa mengubah role sendiri')
  if (!['MODERATOR', 'PREMIUM', 'USER'].includes(role)) throw badRequest('Role yang bisa diberikan: MODERATOR, PREMIUM, USER')
  const target = await ctx.c.users.findOne({ _id: uid })
  if (!target) throw notFound('Pengguna tidak ditemukan')
  if (target.role === 'OWNER') throw forbidden('Role OWNER tidak bisa diubah lewat API')
  await ctx.c.users.updateOne({ _id: uid }, { $set: { role, roleManual: true } })
  return { user: publicUser({ ...target, role }) }
}

export async function setBan(ctx, actor, id, banned) {
  needMod(actor)
  const uid = idParam(id)
  if (typeof banned !== 'boolean') throw badRequest('"banned" harus true atau false')
  if (uid === actor._id) throw forbidden('Tidak bisa memblokir diri sendiri')
  const target = await ctx.c.users.findOne({ _id: uid })
  if (!target) throw notFound('Pengguna tidak ditemukan')
  if (rank(target) >= rank(actor)) throw forbidden('Kamu tidak boleh memblokir pengguna dengan role ini')
  await ctx.c.users.updateOne({ _id: uid }, { $set: { banned } })
  return { ok: true, banned }
}

const needOwner = u => {
  if (rank(u) < 3) throw forbidden('Fitur ini khusus OWNER')
}

// Ringkasan akun untuk panel OWNER. Semua angka dihitung dari data server.
export async function userDetail(ctx, actor, id) {
  needOwner(actor)
  const u = await ctx.c.users.findOne({ _id: idParam(id) })
  if (!u) throw notFound('Pengguna tidak ditemukan')
  const commentCount = await ctx.c.comments.countDocuments({ userId: u._id, deleted: false })
  return {
    user: {
      ...publicUser(u, true),
      banned: !!u.banned,
      xp: u.xp || 0,
      commentCount,
      chaptersRead: await chaptersRead(ctx, u._id),
      lastLoginAt: u.lastLoginAt || 0,
      hasBanner: !!u.customBanner,
      hasAvatar: !!u.customPicture
    }
  }
}

const MAX_GRANT = 50_000

// Tambah/kurangi XP akun. Dicatat sebagai event 'admin' supaya level tetap konsisten dengan rekonsiliasi XP.
export async function grantXp(ctx, actor, id, amount) {
  needOwner(actor)
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > MAX_GRANT) throw badRequest(`"amount" harus bilangan bulat bukan nol, maksimal ±${MAX_GRANT}`)
  const uid = idParam(id)
  const target = await ctx.c.users.findOne({ _id: uid })
  if (!target) throw notFound('Pengguna tidak ditemukan')
  await ctx.c.xpEvents.insertOne({ _id: newId(), userId: uid, type: 'admin', refId: newId(), group: 'admin', fromUserId: actor._id, xp: amount, reversed: false, createdAt: ctx.now() })
  const synced = await reconcileXp(ctx, uid)
  return { user: publicUser({ ...target, xp: synced.xp, level: synced.level }, true) }
}

// Hapus foto/banner kustom yang melanggar aturan. MODERATOR boleh untuk akun di bawahnya, OWNER untuk semua.
export async function resetMedia(ctx, actor, id, input) {
  needMod(actor)
  const uid = idParam(id)
  const target = await ctx.c.users.findOne({ _id: uid })
  if (!target) throw notFound('Pengguna tidak ditemukan')
  if (uid !== actor._id && rank(actor) < 3 && rank(target) >= rank(actor)) throw forbidden('Kamu tidak boleh mengubah akun dengan role ini')
  const set = {}
  if (input?.banner === true) Object.assign(set, { customBanner: '', bannerAt: ctx.now() })
  if (input?.avatar === true) set.customPicture = ''
  if (!Object.keys(set).length) throw badRequest('Pilih "banner" dan/atau "avatar"')
  await ctx.c.users.updateOne({ _id: uid }, { $set: set })
  return { ok: true }
}
