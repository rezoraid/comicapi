import { randomBytes, createHash } from 'node:crypto'
import { badRequest, tooMany } from '../lib/errors.js'

export const SLUG = /^[\w.~%-]{1,200}$/
export const CHAPTER = /^[\w.~%-]{1,50}$/
export const ID = /^[0-9a-f]{24}$/
export const ROLE_RANK = { USER: 1, PREMIUM: 1, MODERATOR: 2, OWNER: 3 }
export const DAY = 86_400_000

export const newId = () => Date.now().toString(16).padStart(12, '0') + randomBytes(6).toString('hex')
export const isDup = e => e?.code === 11000
export const rank = u => ROLE_RANK[u?.role] || 0
export const sum = (list, key) => list.reduce((a, x) => a + (x[key] || 0), 0)

export const idParam = (v, name = 'id') => {
  if (typeof v !== 'string' || !ID.test(v)) throw badRequest(`"${name}" tidak valid`)
  return v
}

export const cleanText = raw =>
  raw
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, '')
    .split('\n')
    .map(l => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const bodyText = (v, name, { min = 1, max = 1000, optional = false } = {}) => {
  if ((v === undefined || v === null) && optional) return ''
  if (typeof v !== 'string') throw badRequest(`"${name}" harus berupa teks`)
  const t = cleanText(v)
  if (t.length < min) throw badRequest(min === 1 ? `"${name}" tidak boleh kosong` : `"${name}" minimal ${min} karakter`)
  if (t.length > max) throw badRequest(`"${name}" maksimal ${max} karakter`)
  return t
}

export const bodyHash = t => createHash('sha256').update(t.toLowerCase().replace(/\s+/g, ' ')).digest('hex').slice(0, 32)

export const qstr = (q, name, max = 100) => {
  const v = (q.get(name) ?? '').trim()
  if (v.length > max) throw badRequest(`"${name}" terlalu panjang (maks ${max})`)
  return v
}

export const qint = (q, name, def, min, max) => {
  const raw = q.get(name)
  if (raw == null || raw === '') return def
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`"${name}" harus angka ${min}-${max}`)
  return n
}

export const hit = (limiter, key, msg) => {
  const r = limiter.check(key)
  if (!r.ok) throw tooMany(msg, r.retryAfter)
}
