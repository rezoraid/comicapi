import { HttpError, badRequest } from '../lib/errors.js'
import { qint, qstr, hit } from './util.js'
import { loginWithGoogle, authenticate, me, updateProfile, getUser } from './users.js'
import { resolveTarget, listComments, listReplies, createComment, chapterCounts, editComment, removeComment, likeComment, reportComment } from './comments.js'
import { deleteAccount } from './account.js'
import { saveProgress, setHistoryVisibility, getPublicHistory } from './reading.js'
import { listReports, resolveReport, findUser, setRole, setBan } from './admin.js'

const P = '/api/community'

export function registerCommunityRoutes(router, { registry, community }) {
  const hasSource = id => registry.has(id)
  const guard = fn => ctx => {
    if (!community) throw new HttpError(503, 'COMMUNITY_DISABLED', 'Fitur komunitas belum diaktifkan di server')
    return fn(community, ctx)
  }
  const authed = fn => guard(async (cm, ctx) => fn(cm, ctx, await authenticate(cm, ctx.req)))
  const maybe = fn => guard(async (cm, ctx) => fn(cm, ctx, await authenticate(cm, ctx.req, { optional: true })))
  const pageOf = q => ({ page: qint(q, 'page', 1, 1, 200), limit: qint(q, 'limit', 15, 1, 30) })

  router.post(`${P}/auth/google`, guard((cm, { body, ip }) => {
    hit(cm.limits.login, ip, 'Terlalu banyak percobaan login')
    return loginWithGoogle(cm, body.idToken)
  }))
  router.get(`${P}/me`, authed((cm, ctx, user) => me(cm, user)))
  router.patch(`${P}/me`, authed((cm, { body }, user) => updateProfile(cm, user, body)))
  router.delete(`${P}/me`, authed((cm, ctx, user) => deleteAccount(cm, user)))
  router.get(`${P}/users/:id`, guard((cm, { params }) => getUser(cm, params.id)))
  router.get(`${P}/users/:id/history`, guard((cm, { params }) => getPublicHistory(cm, params.id)))
  router.put(`${P}/me/history-visibility`, authed((cm, { body }, user) => setHistoryVisibility(cm, user, body)))
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

  router.get(`${P}/admin/reports`, authed((cm, { query }, user) => listReports(cm, user, { status: qstr(query, 'status', 10) || 'open', page: qint(query, 'page', 1, 1, 200), limit: 20 })))
  router.post(`${P}/admin/reports/:id/resolve`, authed((cm, { params, body }, user) => resolveReport(cm, user, params.id, body.action)))
  router.get(`${P}/admin/users`, authed((cm, { query }, user) => findUser(cm, user, query)))
  router.put(`${P}/admin/users/:id/role`, authed((cm, { params, body }, user) => setRole(cm, user, params.id, body.role)))
  router.put(`${P}/admin/users/:id/ban`, authed((cm, { params, body }, user) => setBan(cm, user, params.id, body.banned)))
}
