import { randomInt } from 'node:crypto'
import { badRequest, conflict, forbidden, unauthorized, notFound } from '../lib/errors.js'
import { newId, isDup, rank, DAY, idParam } from './util.js'
import { progress, reconcileXp } from './xp.js'

const USERNAME = /^[a-z][a-z0-9_]{2,19}$/
const RESERVED = new Set(['admin', 'administrator', 'owner', 'dev', 'developer', 'komikta', 'system', 'moderator', 'mod', 'support', 'staff', 'root', 'null', 'undefined'])
const USERNAME_COOLDOWN = 7 * DAY

const cleanName = n => (typeof n === 'string' ? n.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '')
const cleanPicture = p => {
  try {
    const u = new URL(p)
    return u.protocol === 'https:' && u.hostname.endsWith('googleusercontent.com') && p.length <= 500 ? p : ''
  } catch {
    return ''
  }
}

export const publicUser = (u, self = false) => ({
  id: u._id,
  username: u.username,
  name: u.name,
  picture: u.customPicture ? `/api/community/users/${u._id}/avatar` : u.picture,
  role: u.role,
  publicHistory: u.publicHistory === true,
  level: progress(u.xp || 0).level,
  ...(self ? { email: u.email, ...progress(u.xp || 0), usernameChangeableAt: u.usernameChangedAt ? u.usernameChangedAt + USERNAME_COOLDOWN : 0, joinedAt: u.createdAt || 0 } : {})
})

const baseUsername = (email, name) => {
  let b = (email.split('@')[0] || name || 'user').toLowerCase().replace(/[^a-z0-9_]/g, '')
  if (!/^[a-z]/.test(b)) b = `u${b}`
  b = b.slice(0, 14)
  while (b.length < 3) b += randomInt(0, 10)
  return RESERVED.has(b) ? `${b}${randomInt(100, 1000)}` : b
}

export const resolveRole = (cfg, email, current = 'USER', manual = false) => {
  if (cfg.ownerEmails.includes(email)) return 'OWNER'
  if (current === 'OWNER') return 'USER'
  if (!manual && current === 'USER' && cfg.moderatorEmails.includes(email)) return 'MODERATOR'
  return current
}

export async function loginWithGoogle(ctx, idToken) {
  const g = await ctx.google.verify(idToken)
  const now = ctx.now()
  let user = await ctx.c.users.findOne({ googleSub: g.sub })
  if (!user) {
    const base = baseUsername(g.email, g.name)
    for (let i = 0; i < 8 && !user; i++) {
      const doc = {
        _id: newId(),
        googleSub: g.sub,
        email: g.email,
        name: cleanName(g.name) || base,
        picture: cleanPicture(g.picture),
        username: i === 0 ? base : `${base.slice(0, 15)}${randomInt(100, 10000)}`,
        role: resolveRole(ctx.cfg, g.email),
        roleManual: false,
        xp: 0,
        level: 1,
        banned: false,
        publicHistory: false,
        usernameChangedAt: 0,
        createdAt: now,
        lastLoginAt: now
      }
      try {
        await ctx.c.users.insertOne(doc)
        user = doc
      } catch (e) {
        if (!isDup(e)) throw e
        user = await ctx.c.users.findOne({ googleSub: g.sub })
      }
    }
    if (!user) throw conflict('Gagal membuat akun, coba lagi', 'USERNAME_TAKEN')
  } else {
    const role = resolveRole(ctx.cfg, g.email, user.role, user.roleManual)
    const set = { email: g.email, name: cleanName(g.name) || user.name, picture: cleanPicture(g.picture), lastLoginAt: now, role }
    await ctx.c.users.updateOne({ _id: user._id }, { $set: set })
    user = { ...user, ...set }
  }
  if (user.banned) throw forbidden('Akun ini diblokir')
  return { token: ctx.tokens.sign(user._id), user: publicUser(user, true) }
}

export async function authenticate(ctx, req, { optional = false } = {}) {
  const h = String(req.headers.authorization || '')
  const token = /^Bearer (\S+)$/i.exec(h)?.[1]
  if (!token) {
    if (optional) return null
    throw unauthorized('Masuk dulu untuk melanjutkan')
  }
  const p = ctx.tokens.verify(token)
  if (!p) {
    if (optional) return null
    throw unauthorized('Sesi tidak valid atau kedaluwarsa, masuk lagi')
  }
  const user = await ctx.c.users.findOne({ _id: p.sub })
  if (!user) {
    if (optional) return null
    throw unauthorized('Akun tidak ditemukan')
  }
  if (user.banned) throw forbidden('Akun ini diblokir')
  user.tokenExp = p.exp
  return user
}

export const me = async (ctx, user) => {
  const synced = await reconcileXp(ctx, user._id)
  if (synced) user = { ...user, xp: synced.xp, level: synced.level }
  const left = user.tokenExp * 1000 - ctx.now()
  const commentCount = await ctx.c.comments.countDocuments({ userId: user._id, deleted: false })
  return { user: { ...publicUser(user, true), commentCount }, ...(left < ctx.tokens.ttlMs / 2 ? { token: ctx.tokens.sign(user._id) } : {}) }
}

export async function updateProfile(ctx, user, body) {
  const next = body.username
  if (typeof next !== 'string') throw badRequest('"username" harus berupa teks')
  const username = next.trim().toLowerCase()
  if (!USERNAME.test(username)) throw badRequest('Username 3-20 karakter: huruf kecil, angka, underscore, diawali huruf')
  if (username === user.username) return { user: publicUser(user, true) }
  if (RESERVED.has(username) && rank(user) < 2) throw badRequest('Username ini tidak tersedia')
  const wait = (user.usernameChangedAt || 0) + USERNAME_COOLDOWN - ctx.now()
  if (wait > 0) throw badRequest(`Username baru bisa diganti lagi ${Math.ceil(wait / DAY)} hari lagi`)
  const changedAt = ctx.now()
  try {
    await ctx.c.users.updateOne({ _id: user._id }, { $set: { username, usernameChangedAt: changedAt } })
  } catch (e) {
    if (isDup(e)) throw conflict('Username sudah dipakai', 'USERNAME_TAKEN')
    throw e
  }
  return { user: publicUser({ ...user, username, usernameChangedAt: changedAt }, true) }
}

export async function updateAvatar(ctx, user, body) {
  const data = body?.image
  if (typeof data !== 'string' || data.length > 400_000 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(data)) {
    throw badRequest('Foto harus berupa JPG, PNG, atau WebP dan berukuran kecil (maksimal sekitar 280 KB)')
  }
  const mime = data.slice(5, data.indexOf(';'))
  const raw = Buffer.from(data.slice(data.indexOf(',') + 1), 'base64')
  if (!raw.length || raw.length > 280_000) throw badRequest('Ukuran foto terlalu besar')
  // Verify the declared format against basic file signatures to reject arbitrary payloads.
  const valid = mime === 'image/jpeg' ? raw[0] === 0xff && raw[1] === 0xd8
    : mime === 'image/png' ? raw.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : raw.subarray(0, 4).toString('ascii') === 'RIFF' && raw.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!valid) throw badRequest('Format file foto tidak valid')
  await ctx.c.users.updateOne({ _id: user._id }, { $set: { customPicture: data } })
  return { user: publicUser({ ...user, customPicture: data }, true) }
}

export async function getUser(ctx, id) {
  const u = await ctx.c.users.findOne({ _id: idParam(id) })
  if (!u) throw notFound('Pengguna tidak ditemukan')
  return { user: publicUser(u) }
}
