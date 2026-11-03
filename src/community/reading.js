import { badRequest, forbidden, notFound } from '../lib/errors.js'
import { SLUG, CHAPTER, DAY, idParam, hit } from './util.js'
import { publicUser } from './users.js'
import { awardXp, XP } from './xp.js'
import { chaptersRead } from './stats.js'

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

const MAX_PING_SECONDS = 300
// Sebuah chapter baru dihitung "dibaca" setelah akumulasi waktu baca aktif sebanyak ini.
export const MIN_CHAPTER_SECONDS = 60
// Batas chapter yang bisa dihitung per 24 jam, supaya skrip tidak bisa menggelembungkan angka.
export const MAX_COUNTED_PER_DAY = 120

// Mencatat durasi membaca aktif. Kredit dibatasi oleh waktu nyata sejak ping terakhir (dan diklaim
// secara atomik, jadi permintaan paralel tidak bisa menggandakan kredit). Jumlah chapter dibaca dan XP
// membaca hanya berasal dari akumulasi detik yang sudah lolos pembatasan itu, bukan dari angka kiriman klien.
export async function trackReadingTime(ctx, user, input, hasSource) {
  hit(ctx.limits.readTime, user._id, 'Terlalu banyak permintaan')
  const source = text(input.source, 'source', 40)
  const slug = text(input.slug, 'slug', 200)
  const chapter = text(input.chapter, 'chapter', 50)
  if (!hasSource(source) || !SLUG.test(slug) || !CHAPTER.test(chapter)) throw badRequest('Data chapter tidak valid')
  const seconds = input.seconds
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_PING_SECONDS) throw badRequest(`"seconds" harus bilangan bulat 1-${MAX_PING_SECONDS}`)
  const now = ctx.now()
  const prev = user.readTimeAt ?? null
  const gap = prev && now - prev < 600_000 ? Math.ceil((now - prev) / 1000) + 5 : 60
  const credit = Math.min(seconds, gap)
  const claim = await ctx.c.users.updateOne({ _id: user._id, readTimeAt: prev }, { $inc: { readSeconds: credit }, $set: { readTimeAt: now } })
  if (claim.matchedCount !== 1) return { ok: true, credited: 0, xpGained: 0 }
  await ctx.c.readingProgress.updateOne({ _id: `${user._id}:${source}:${slug}` }, { $inc: { readSeconds: credit } })

  const id = `${user._id}:${source}:${slug}:${chapter}`
  await ctx.c.chapterReads.updateOne(
    { _id: id },
    { $inc: { seconds: credit }, $set: { updatedAt: now }, $setOnInsert: { userId: user._id, source, slug, chapter, createdAt: now } },
    { upsert: true }
  )
  const row = await ctx.c.chapterReads.findOne({ _id: id })
  let xpGained = 0
  if (row && !row.counted && (row.seconds || 0) >= MIN_CHAPTER_SECONDS) {
    const today = await ctx.c.chapterReads.countDocuments({ userId: user._id, counted: true, countedAt: { $gte: now - DAY } })
    if (today < MAX_COUNTED_PER_DAY) {
      const won = await ctx.c.chapterReads.updateOne({ _id: id, counted: { $ne: true } }, { $set: { counted: true, countedAt: now } })
      if (won.matchedCount === 1) xpGained = await awardXp(ctx, { userId: user._id, type: 'read', refId: id, amount: XP.chapterRead, group: 'read' })
    }
  }
  return { ok: true, credited: credit, xpGained, chaptersRead: await chaptersRead(ctx, user._id) }
}
