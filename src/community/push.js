import { badRequest, forbidden } from '../lib/errors.js'
import { newId, isDup, rank, DAY } from './util.js'

const TOKEN = /^[\w:.-]{20,1024}$/
const BATCH = 500
const STALE_MS = 60 * DAY
const TTL_MS = 3 * DAY
const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'])

const parseAccount = raw => {
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')
  const acc = JSON.parse(text)
  if (typeof acc.private_key === 'string') acc.private_key = acc.private_key.replace(/\\n/g, '\n')
  return acc
}

export async function createMessaging(cfg, logger = console) {
  const fb = cfg.firebase || {}
  if (!fb.serviceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    logger.log('FCM nonaktif: FIREBASE_SERVICE_ACCOUNT belum diisi (HP tetap menerima pengumuman lewat polling)')
    return null
  }
  try {
    const { initializeApp, cert, applicationDefault, getApps, getApp } = await import('firebase-admin/app')
    const { getMessaging } = await import('firebase-admin/messaging')
    const acc = fb.serviceAccount ? parseAccount(fb.serviceAccount) : null
    if (acc?.project_id && fb.projectId && acc.project_id !== fb.projectId) logger.error(`FCM: project_id service account (${acc.project_id}) berbeda dari FIREBASE_PROJECT_ID (${fb.projectId})`)
    const name = 'komikta-fcm'
    const app = getApps().some(a => a.name === name) ? getApp(name) : initializeApp({ credential: acc ? cert(acc) : applicationDefault(), projectId: acc?.project_id || fb.projectId }, name)
    logger.log(`FCM aktif (project ${acc?.project_id || fb.projectId})`)
    return getMessaging(app)
  } catch (err) {
    logger.error(`FCM gagal diinisialisasi: ${err?.message || err}`)
    return null
  }
}

const dataOf = b => ({ type: 'broadcast', id: b._id, title: b.title, body: b.body, source: b.source || '', slug: b.slug || '', createdAt: String(b.createdAt) })

export function createPush({ c, messaging = null, now = Date.now, logger = console }) {
  const pending = new Set()
  const upsert = async (token, set) => {
    const op = { $set: set, $setOnInsert: { _id: newId(), createdAt: now() } }
    try {
      await c.pushTokens.updateOne({ token }, op, { upsert: true })
    } catch (err) {
      if (!isDup(err)) throw err
      await c.pushTokens.updateOne({ token }, { $set: set })
    }
  }
  const register = async (viewer, body) => {
    const token = body?.token
    if (typeof token !== 'string' || !TOKEN.test(token)) throw badRequest('"token" tidak valid')
    const appVersion = typeof body.appVersion === 'string' ? body.appVersion.slice(0, 20) : ''
    await upsert(token, { userId: viewer?._id || null, appVersion, updatedAt: now() })
    const previous = body.previous
    if (typeof previous === 'string' && previous !== token && TOKEN.test(previous)) await c.pushTokens.deleteOne({ token: previous })
    return { ok: true }
  }
  const unregister = async body => {
    const token = body?.token
    if (typeof token !== 'string' || !TOKEN.test(token)) throw badRequest('"token" tidak valid')
    await c.pushTokens.deleteOne({ token })
    return { ok: true }
  }
  const dropUser = userId => c.pushTokens.deleteMany({ userId })
  const status = async actor => {
    if (rank(actor) < 3) throw forbidden('Fitur ini khusus OWNER')
    const [devices, linked] = await Promise.all([c.pushTokens.countDocuments({}), c.pushTokens.countDocuments({ userId: { $ne: null } })])
    return { enabled: !!messaging, devices, linkedToAccount: linked }
  }
  const send = async doc => {
    if (!messaging) return { sent: 0, failed: 0, skipped: true }
    await c.pushTokens.deleteMany({ updatedAt: { $lt: now() - STALE_MS } })
    const data = dataOf(doc)
    let sent = 0
    let failed = 0
    let last = ''
    for (;;) {
      const rows = await c.pushTokens.find({ _id: { $gt: last } }, { sort: { _id: 1 }, limit: BATCH }).toArray()
      if (!rows.length) break
      last = rows[rows.length - 1]._id
      const tokens = rows.map(r => r.token)
      try {
        const res = await messaging.sendEachForMulticast({ tokens, data, android: { priority: 'high', ttl: TTL_MS } })
        const dead = []
        res.responses.forEach((r, i) => {
          if (r.success) sent++
          else {
            failed++
            if (DEAD.has(r.error?.code)) dead.push(tokens[i])
          }
        })
        if (dead.length) await c.pushTokens.deleteMany({ token: { $in: dead } })
      } catch (err) {
        failed += tokens.length
        logger.error(`FCM batch gagal: ${err?.message || err}`)
      }
      if (rows.length < BATCH) break
    }
    return { sent, failed, skipped: false }
  }
  const dispatch = doc => {
    const p = send(doc)
      .then(async r => {
        if (!r.skipped) await c.broadcasts.updateOne({ _id: doc._id }, { $set: { push: { sent: r.sent, failed: r.failed, at: now() } } })
        return r
      })
      .catch(err => {
        logger.error(`FCM kirim pengumuman gagal: ${err?.message || err}`)
        return { sent: 0, failed: 0, skipped: false, error: true }
      })
      .finally(() => pending.delete(p))
    pending.add(p)
    return p
  }
  return { enabled: !!messaging, register, unregister, dropUser, status, dispatch, flush: () => Promise.all([...pending]) }
}
