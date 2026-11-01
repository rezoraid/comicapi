import { badRequest, forbidden, notFound } from '../lib/errors.js'
import { SLUG, CHAPTER, idParam } from './util.js'
import { publicUser } from './users.js'

const text = (v, name, max) => {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw badRequest(`"${name}" tidak valid`)
  return v.trim()
}

export async function saveProgress(ctx, user, input, hasSource) {
  const source = text(input.source, 'source', 40)
  const slug = text(input.slug, 'slug', 200)
  const chapter = text(input.chapter, 'chapter', 50)
  if (!hasSource(source) || !SLUG.test(slug) || !CHAPTER.test(chapter)) throw badRequest('Data chapter tidak valid')
  const now = ctx.now()
  const doc = {
    _id: `${user._id}:${source}:${slug}`,
    userId: user._id, source, slug, chapter,
    comicTitle: typeof input.comicTitle === 'string' ? input.comicTitle.trim().slice(0, 180) : '',
    chapterTitle: typeof input.chapterTitle === 'string' ? input.chapterTitle.trim().slice(0, 100) : '',
    coverUrl: typeof input.coverUrl === 'string' && input.coverUrl.startsWith('https://') ? input.coverUrl.slice(0, 1000) : '',
    updatedAt: now
  }
  await ctx.c.readingProgress.updateOne({ _id: doc._id }, { $set: doc, $setOnInsert: { createdAt: now } }, { upsert: true })
  return { ok: true, updatedAt: now }
}

export async function setHistoryVisibility(ctx, user, input) {
  if (typeof input.publicHistory !== 'boolean') throw badRequest('"publicHistory" harus berupa boolean')
  await ctx.c.users.updateOne({ _id: user._id }, { $set: { publicHistory: input.publicHistory } })
  return { ok: true, publicHistory: input.publicHistory }
}

export async function getPublicHistory(ctx, id) {
  const user = await ctx.c.users.findOne({ _id: idParam(id, 'id') })
  if (!user) throw notFound('Pengguna tidak ditemukan')
  if (!user.publicHistory) throw forbidden('Riwayat membaca pengguna ini bersifat privat')
  const rows = await ctx.c.readingProgress.find({ userId: user._id }).sort({ updatedAt: -1 }).limit(50).toArray()
  return {
    user: publicUser(user),
    items: rows.map(({ source, slug, chapter, comicTitle, chapterTitle, coverUrl, updatedAt }) => ({ source, slug, chapter, comicTitle, chapterTitle, coverUrl, updatedAt }))
  }
}
