import { badRequest, forbidden, notFound } from '../lib/errors.js'
import { rank, idParam, qstr, qint, newId, DAY } from './util.js'
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
  ctx.invalidateUser?.(uid)
  return { user: publicUser({ ...target, role }) }
}

// Beri/cabut centang verified. Khusus OWNER; OWNER sendiri selalu terverifikasi dan tidak bisa diubah.
export async function setVerified(ctx, actor, id, verified) {
  needOwner(actor)
  if (typeof verified !== 'boolean') throw badRequest('"verified" harus true atau false')
  const uid = idParam(id)
  const target = await ctx.c.users.findOne({ _id: uid })
  if (!target) throw notFound('Pengguna tidak ditemukan')
  if (target.role === 'OWNER') throw forbidden('OWNER selalu terverifikasi')
  await ctx.c.users.updateOne({ _id: uid }, { $set: { verified } })
  ctx.invalidateUser?.(uid)
  return { user: publicUser({ ...target, verified }) }
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
  ctx.invalidateUser?.(uid)
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
      hasAvatar: !!(u.customPicture || u.hasCustomPicture)
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

// Hapus foto profil kustom yang melanggar aturan. MODERATOR boleh untuk akun di bawahnya, OWNER untuk semua.
export async function resetMedia(ctx, actor, id, input) {
  needMod(actor)
  const uid = idParam(id)
  const target = await ctx.c.users.findOne({ _id: uid })
  if (!target) throw notFound('Pengguna tidak ditemukan')
  if (uid !== actor._id && rank(actor) < 3 && rank(target) >= rank(actor)) throw forbidden('Kamu tidak boleh mengubah akun dengan role ini')
  const set = {}
  if (input?.avatar === true) {
    set.customPicture = ''
    set.hasCustomPicture = false
  }
  if (!Object.keys(set).length) throw badRequest('Pilih "avatar"')
  await ctx.c.users.updateOne({ _id: uid }, { $set: set })
  ctx.invalidateUser?.(uid)
  return { ok: true }
}

// ---- Panel OWNER: statistik, daftar pengguna, daftar komentar ----

const PAGE_SIZE = 20
const ROLES = ['OWNER', 'MODERATOR', 'PREMIUM', 'USER']
const escapeRe = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const like = t => ({ $regex: escapeRe(t), $options: 'i' })
const flag = (q, name) => ['1', 'true'].includes(qstr(q, name, 5).toLowerCase())

// Ringkasan angka untuk tab "Ringkasan". Semua dihitung dari data server.
export async function adminStats(ctx, actor) {
  needOwner(actor)
  const now = ctx.now()
  const [users, newUsers7d, active24h, banned, owners, moderators, premiums, comments, comments24h, openReports, chaptersReadTotal] = await Promise.all([
    ctx.c.users.countDocuments({}),
    ctx.c.users.countDocuments({ createdAt: { $gte: now - 7 * DAY } }),
    ctx.c.users.countDocuments({ lastLoginAt: { $gte: now - DAY } }),
    ctx.c.users.countDocuments({ banned: true }),
    ctx.c.users.countDocuments({ role: 'OWNER' }),
    ctx.c.users.countDocuments({ role: 'MODERATOR' }),
    ctx.c.users.countDocuments({ role: 'PREMIUM' }),
    ctx.c.comments.countDocuments({ deleted: false }),
    ctx.c.comments.countDocuments({ deleted: false, createdAt: { $gte: now - DAY } }),
    ctx.c.reports.countDocuments({ status: 'open' }),
    ctx.c.chapterReads.countDocuments({ counted: true })
  ])
  return { users, newUsers7d, active24h, banned, owners, moderators, premiums, comments, comments24h, openReports, chaptersRead: chaptersReadTotal }
}

// Daftar pengguna: cari (username/nama/email), filter role atau diblokir, terbaru dulu.
export async function listUsers(ctx, actor, query) {
  needOwner(actor)
  const page = qint(query, 'page', 1, 1, 500)
  const q = qstr(query, 'q', 60)
  const role = qstr(query, 'role', 12).toUpperCase()
  const filter = {}
  if (role) {
    if (!ROLES.includes(role)) throw badRequest('"role" harus OWNER, MODERATOR, PREMIUM, atau USER')
    filter.role = role
  }
  if (flag(query, 'banned')) filter.banned = true
  const search = q ? [{ username: like(q) }, { name: like(q) }, { email: like(q) }] : [{}]
  // verified=1: OWNER selalu dihitung terverifikasi. Satu $or saja supaya tetap sederhana.
  if (flag(query, 'verified')) filter.$or = search.flatMap(s => [{ ...s, verified: true }, { ...s, role: 'OWNER' }])
  else if (q) filter.$or = search
  const [rows, total] = await Promise.all([
    ctx.c.users
      .find(filter, {
        projection: { customPicture: 0 },
        sort: { createdAt: -1, _id: -1 },
        skip: (page - 1) * PAGE_SIZE,
        limit: PAGE_SIZE + 1
      })
      .toArray(),
    ctx.c.users.countDocuments(filter)
  ])
  return {
    page,
    total,
    hasMore: rows.length > PAGE_SIZE,
    items: rows.slice(0, PAGE_SIZE).map(u => ({ ...publicUser(u, true), banned: !!u.banned, hasAvatar: !!u.customPicture, lastLoginAt: u.lastLoginAt || 0 }))
  }
}

// Semua komentar (termasuk yang sudah dihapus), terbaru dulu. Cari isi komentar atau pembuatnya; filter hanya yang dilaporkan.
export async function listAdminComments(ctx, actor, query) {
  needOwner(actor)
  const page = qint(query, 'page', 1, 1, 500)
  const q = qstr(query, 'q', 60)
  const filter = {}
  if (flag(query, 'reported')) filter.reportCount = { $gt: 0 }
  if (q) {
    const authors = await ctx.c.users.find({ $or: [{ username: like(q) }, { name: like(q) }] }, { limit: 50 }).toArray()
    filter.$or = [{ body: like(q) }, ...(authors.length ? [{ userId: { $in: authors.map(a => a._id) } }] : [])]
  }
  const [rows, total] = await Promise.all([
    ctx.c.comments.find(filter, { sort: { _id: -1 }, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1 }).toArray(),
    ctx.c.comments.countDocuments(filter)
  ])
  const items = rows.slice(0, PAGE_SIZE)
  const ids = [...new Set(items.map(c => c.userId))]
  const users = ids.length ? await ctx.c.users.find({ _id: { $in: ids } }).toArray() : []
  const byId = new Map(users.map(u => [u._id, u]))
  return {
    page,
    total,
    hasMore: rows.length > PAGE_SIZE,
    items: items.map(c => ({
      id: c._id,
      body: c.body,
      deleted: !!c.deleted,
      targetKey: c.targetKey,
      createdAt: c.createdAt,
      likeCount: c.likeCount || 0,
      replyCount: c.replyCount || 0,
      reportCount: c.reportCount || 0,
      user: byId.has(c.userId) ? publicUser(byId.get(c.userId)) : null
    }))
  }
}
