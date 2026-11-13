import { createHash } from 'node:crypto'
import { HttpError, badRequest } from '../lib/errors.js'
import { etagMatches, send, encode } from '../http/respond.js'
import { normalizeDetail } from '../normalize.js'
import { qint, qstr, hit } from './util.js'
import { loginWithGoogle, authenticate, me, updateProfile, updateAvatar, getUser } from './users.js'
import { setLike, likeStatus } from './likes.js'
import { getProfile, listActivity } from './profile.js'
import { resolveTarget, listComments, listReplies, createComment, chapterCounts, editComment, removeComment, likeComment, reportComment } from './comments.js'
import { deleteAccount } from './account.js'
import { saveProgress, trackReadingTime } from './reading.js'
import { adminComic, saveComic, resetComic, getPages, savePages, resetPages, uploadMedia, serveMedia, trackView } from './catalog.js'
import { registerToken, unregisterToken } from './push.js'
import { createBroadcast, feed, listBroadcasts, removeBroadcast } from './broadcasts.js'
import { listReports, resolveReport, findUser, userDetail, grantXp, resetMedia, setRole, setVerified, setBan, adminStats, listUsers, listAdminComments } from './admin.js'

const P = '/api/community'

export function registerCommunityRoutes(router, { registry, community }) {
  const hasSource = id => registry.has(id)
  // community boleh berupa objek atau fungsi getter (koneksi MongoDB bisa tersambung belakangan, dengan retry)
  const current = () => (typeof community === 'function' ? community() : community)
  const guard = fn => ctx => {
    const cm = current()
    if (!cm) throw new HttpError(503, 'COMMUNITY_DISABLED', 'Fitur komunitas belum diaktifkan di server')
    return fn(cm, ctx)
  }
  const authed = fn => guard(async (cm, ctx) => fn(cm, ctx, await authenticate(cm, ctx.req)))
  const maybe = fn => guard(async (cm, ctx) => fn(cm, ctx, await authenticate(cm, ctx.req, { optional: true })))
  const pageOf = q => ({ page: qint(q, 'page', 1, 1, 200), limit: qint(q, 'limit', 15, 1, 30) })

  router.post(`${P}/auth/google`, guard(async (cm, { body, ip }) => {
    await hit(cm.limits.login, ip, 'Terlalu banyak percobaan login')
    return loginWithGoogle(cm, body.idToken)
  }))
  router.get(`${P}/me`, authed((cm, ctx, user) => me(cm, user)))
  router.patch(`${P}/me`, authed((cm, { body }, user) => updateProfile(cm, user, body)))
  router.put(`${P}/me/avatar`, authed((cm, { body }, user) => updateAvatar(cm, user, body)))
  router.delete(`${P}/me`, authed((cm, ctx, user) => deleteAccount(cm, user)))
  router.get(`${P}/users/:id/avatar`, async ({ req, res, params, query }) => {
    const cm = current()
    if (!cm) throw new HttpError(503, 'COMMUNITY_DISABLED', 'Fitur komunitas belum diaktifkan di server')
    const asked = /^\d{1,15}$/.test(query.get('v') || '') ? query.get('v') : '0'
    let e = cm.avatars.get(params.id)
    // URL bertanda versi (?v=) tidak berubah isinya → cache aman; URL lama tanpa ?v= dicek ulang tiap 30 dtk
    if (!e || e.v !== asked || (asked === '0' && cm.now() - e.at > 30_000)) {
      const user = await cm.c.users.findOne({ _id: params.id }, { projection: { customPicture: 1, avatarAt: 1 } })
      if (!user?.customPicture) throw new HttpError(404, 'AVATAR_NOT_FOUND', 'Foto profil tidak ditemukan')
      const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(user.customPicture)
      if (!match) throw new HttpError(404, 'AVATAR_NOT_FOUND', 'Foto profil tidak valid')
      const bytes = Buffer.from(match[2], 'base64')
      e = { v: String(user.avatarAt || 0), at: cm.now(), mime: `image/${match[1]}`, bytes, etag: `"${createHash('sha1').update(bytes).digest('base64url').slice(0, 20)}"` }
      cm.avatars.set(params.id, e)
    }
    const immutable = asked !== '0' && asked === e.v // URL versi terbaru → boleh disimpan klien selamanya
    const headers = {
      'content-type': e.mime,
      etag: e.etag,
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300, stale-while-revalidate=3600',
      'x-content-type-options': 'nosniff'
    }
    if (etagMatches(req.headers['if-none-match'], e.etag)) {
      res.writeHead(304, headers)
      return res.end()
    }
    headers['content-length'] = e.bytes.length
    res.writeHead(200, headers)
    res.end(req.method === 'HEAD' ? undefined : e.bytes)
  }, { public: true, raw: true })
  router.get(`${P}/users/:id/profile`, maybe((cm, { params }, viewer) => getProfile(cm, viewer, params.id)))
  router.get(`${P}/users/:id/activity`, maybe((cm, { params, query }, viewer) =>
    listActivity(cm, viewer, params.id, { tab: qstr(query, 'tab', 10) || 'all', page: qint(query, 'page', 1, 1, 200), limit: qint(query, 'limit', 20, 1, 30) })
  ))
  router.get(`${P}/users/:id`, guard((cm, { params }) => getUser(cm, params.id)))
  router.put(`${P}/me/reading-time`, authed((cm, { body }, user) => trackReadingTime(cm, user, body, hasSource)))
  const likeTarget = q => ({ type: qstr(q, 'type', 10), source: qstr(q, 'source', 40), slug: qstr(q, 'slug', 200), chapter: qstr(q, 'chapter', 50) })
  router.get(`${P}/likes/status`, maybe((cm, { query }, viewer) => likeStatus(cm, viewer, likeTarget(query), hasSource)))
  router.put(`${P}/likes`, authed((cm, { body }, user) => setLike(cm, user, body, hasSource, true)))
  router.delete(`${P}/likes`, authed((cm, { query }, user) => setLike(cm, user, likeTarget(query), hasSource, false)))
  router.put(`${P}/me/reading-progress`, authed((cm, { body }, user) => saveProgress(cm, user, body, hasSource)))

  router.get(`${P}/comments`, maybe((cm, { query }, viewer) => {
    const target = resolveTarget(
      { type: qstr(query, 'type', 10), source: qstr(query, 'source', 40), slug: qstr(query, 'slug', 200), chapter: qstr(query, 'chapter', 50) },
      hasSource
    )
    const sort = qstr(query, 'sort', 10) || 'newest'
    if (sort !== 'newest' && sort !== 'top') throw badRequest('"sort" harus newest atau top')
    return listComments(cm, viewer, target, { sort, ...pageOf(query) })
  }))
  router.get(`${P}/comments/counts`, guard((cm, { query }) => {
    const t = resolveTarget({ type: 'comic', source: qstr(query, 'source', 40), slug: qstr(query, 'slug', 200) }, hasSource)
    return chapterCounts(cm, t.source, t.slug)
  }))
  router.get(`${P}/comments/:id/replies`, maybe((cm, { params, query }, viewer) => listReplies(cm, viewer, params.id, pageOf(query))))
  router.post(`${P}/comments`, authed((cm, { body }, user) => createComment(cm, user, body, hasSource)))
  router.patch(`${P}/comments/:id`, authed((cm, { params, body }, user) => editComment(cm, user, params.id, body)))
  router.delete(`${P}/comments/:id`, authed((cm, { params }, user) => removeComment(cm, user, params.id)))
  router.put(`${P}/comments/:id/like`, authed((cm, { params }, user) => likeComment(cm, user, params.id, true)))
  router.delete(`${P}/comments/:id/like`, authed((cm, { params }, user) => likeComment(cm, user, params.id, false)))
  router.post(`${P}/comments/:id/report`, authed((cm, { params, body }, user) => reportComment(cm, user, params.id, body)))

  // Pengumuman → notifikasi di semua HP. Feed publik (tanpa login, tanpa data pribadi); kirim/riwayat/tarik khusus OWNER.
  router.get(`${P}/broadcasts`, guard((cm, { query }) => feed(cm, query)))
  router.post(`${P}/admin/broadcasts`, authed(async (cm, { body }, user) => {
    await hit(cm.limits.write, user._id, 'Terlalu banyak pengumuman')
    return createBroadcast(cm, user, body, hasSource)
  }))
  router.get(`${P}/admin/broadcasts`, authed((cm, { query }, user) => listBroadcasts(cm, user, query)))
  router.delete(`${P}/admin/broadcasts/:id`, authed((cm, { params }, user) => removeBroadcast(cm, user, params.id)))

  router.put(`${P}/push-token`, maybe(async (cm, { body, ip }, user) => {
    await hit(cm.limits.write, user?._id || ip, 'Terlalu banyak permintaan')
    return registerToken(cm, user, body)
  }))
  router.post(`${P}/push-token/unregister`, guard(async (cm, { body, ip }) => {
    await hit(cm.limits.write, ip, 'Terlalu banyak permintaan')
    return unregisterToken(cm, body)
  }))

  const loadDetail = (source, slug) => () => {
    if (!registry.has(source)) throw badRequest(`Sumber "${source}" tidak ada`)
    return Promise.resolve(registry.get(source).detail(slug)).then(d => normalizeDetail(d, source))
  }
  const loadChapter = (source, slug, chapter) => () => {
    if (!registry.has(source)) throw badRequest(`Sumber "${source}" tidak ada`)
    return Promise.resolve(registry.get(source).chapter(slug, chapter))
  }
  router.get(`${P}/admin/comics/:source/:slug`, authed((cm, { params: p }, user) => adminComic(cm, user, p.source, p.slug, loadDetail(p.source, p.slug))))
  router.put(`${P}/admin/comics/:source/:slug`, authed((cm, { params: p, body }, user) => saveComic(cm, user, p.source, p.slug, body, loadDetail(p.source, p.slug))))
  router.delete(`${P}/admin/comics/:source/:slug/override`, authed((cm, { params: p }, user) => resetComic(cm, user, p.source, p.slug, loadDetail(p.source, p.slug))))
  router.get(`${P}/admin/comics/:source/:slug/chapters/:chapter/pages`, authed((cm, { params: p }, user) => getPages(cm, user, p.source, p.slug, p.chapter, loadChapter(p.source, p.slug, p.chapter))))
  router.put(`${P}/admin/comics/:source/:slug/chapters/:chapter/pages`, authed((cm, { params: p, body }, user) => savePages(cm, user, p.source, p.slug, p.chapter, body)))
  router.delete(`${P}/admin/comics/:source/:slug/chapters/:chapter/pages`, authed((cm, { params: p }, user) => resetPages(cm, user, p.source, p.slug, p.chapter, loadChapter(p.source, p.slug, p.chapter))))
  router.add('POST', `${P}/admin/media`, async ({ req, res }) => {
    const cm = current()
    if (!cm) throw new HttpError(503, 'COMMUNITY_DISABLED', 'Fitur komunitas belum diaktifkan di server')
    const user = await authenticate(cm, req)
    await hit(cm.limits.write, user._id, 'Terlalu banyak unggahan')
    send(req, res, await encode({ ok: true, data: await uploadMedia(cm, user, req) }, { gzip: false }))
  }, { raw: true })
  router.get('/media/:id', async ({ req, res, params }) => {
    const cm = current()
    if (!cm) throw new HttpError(503, 'COMMUNITY_DISABLED', 'Fitur komunitas belum diaktifkan di server')
    await serveMedia(cm, req, res, params.id)
  }, { raw: true, public: true })
  const deviceOf = (req, ip) => ({ deviceId: String(req.headers['x-device-id'] || '').slice(0, 64), ip })
  router.post(`${P}/views/comic`, maybe(async (cm, { req, body, ip }, user) => trackView(cm, user, deviceOf(req, ip), 'comic', body)))
  router.post(`${P}/views/chapter`, maybe(async (cm, { req, body, ip }, user) => trackView(cm, user, deviceOf(req, ip), 'chapter', body)))

  router.get(`${P}/admin/reports`, authed((cm, { query }, user) => listReports(cm, user, { status: qstr(query, 'status', 10) || 'open', page: qint(query, 'page', 1, 1, 200), limit: 20 })))
  router.post(`${P}/admin/reports/:id/resolve`, authed((cm, { params, body }, user) => resolveReport(cm, user, params.id, body.action)))
  // ?username= = cari satu akun persis (MODERATOR/OWNER). Tanpa itu = daftar pengguna untuk panel OWNER (q, role, banned, page).
  router.get(`${P}/admin/users`, authed((cm, { query }, user) => (query.has('username') ? findUser(cm, user, query) : listUsers(cm, user, query))))
  router.get(`${P}/admin/stats`, authed((cm, ctx, user) => adminStats(cm, user)))
  router.get(`${P}/admin/comments`, authed((cm, { query }, user) => listAdminComments(cm, user, query)))
  router.get(`${P}/admin/users/:id`, authed((cm, { params }, user) => userDetail(cm, user, params.id)))
  router.post(`${P}/admin/users/:id/xp`, authed((cm, { params, body }, user) => grantXp(cm, user, params.id, body.amount)))
  router.post(`${P}/admin/users/:id/reset-media`, authed((cm, { params, body }, user) => resetMedia(cm, user, params.id, body)))
  router.put(`${P}/admin/users/:id/role`, authed((cm, { params, body }, user) => setRole(cm, user, params.id, body.role)))
  router.put(`${P}/admin/users/:id/verified`, authed((cm, { params, body }, user) => setVerified(cm, user, params.id, body.verified)))
  router.put(`${P}/admin/users/:id/ban`, authed((cm, { params, body }, user) => setBan(cm, user, params.id, body.banned)))
}
