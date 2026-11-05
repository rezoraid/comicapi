import { badRequest } from '../lib/errors.js'
import { SLUG, CHAPTER, DAY, hit } from './util.js'
import { awardXp, XP } from './xp.js'
import { chaptersRead, forgetChaptersRead } from './stats.js'

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
  const chapterTitle = typeof input.chapterTitle === 'string' ? input.chapterTitle.trim().slice(0, 100) : ''
  let comicTitle = typeof input.comicTitle === 'string' ? input.comicTitle.trim().slice(0, 180) : ''
  // Judul komik yang sama dengan judul chapter / berawalan "Chapter" berarti detail komik belum sempat dimuat.
  if (comicTitle && (comicTitle === chapterTitle || /^(chapter|ch\.?|bab|episode)\s*\d/i.test(comicTitle))) comicTitle = ''
  const coverUrl = typeof input.coverUrl === 'string' && input.coverUrl.startsWith('https://') ? input.coverUrl.slice(0, 1000) : ''
  const set = { userId: user._id, source, slug, chapter, chapterTitle, updatedAt: now }
  if (comicTitle) set.comicTitle = comicTitle
  if (coverUrl) set.coverUrl = coverUrl
  const id = `${user._id}:${source}:${slug}`
  // respons tidak bergantung pada hasil tulis → masuk antrean tulis-belakangan (digabung per komik, ~1 dtk)
  await ctx.progress.save(id, set, { createdAt: now, ...(comicTitle ? {} : { comicTitle: '' }), ...(coverUrl ? {} : { coverUrl: '' }) })
  return { ok: true, updatedAt: now }
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
  // akumulasi detik per komik ikut antrean tulis-belakangan; dokumen per-chapter diperlukan sekarang (ambang 60 dtk)
  await ctx.progress.addSeconds(`${user._id}:${source}:${slug}`, credit)

  const id = `${user._id}:${source}:${slug}:${chapter}`
  // upsert + baca dokumen hasilnya dalam satu round-trip (sebelumnya updateOne lalu findOne)
  const row = await ctx.c.chapterReads.findOneAndUpdate(
    { _id: id },
    { $inc: { seconds: credit }, $set: { updatedAt: now }, $setOnInsert: { userId: user._id, source, slug, chapter, createdAt: now } },
    { upsert: true, returnDocument: 'after' }
  )
  let xpGained = 0
  if (row && !row.counted && (row.seconds || 0) >= MIN_CHAPTER_SECONDS) {
    const today = await ctx.c.chapterReads.countDocuments({ userId: user._id, counted: true, countedAt: { $gte: now - DAY } })
    if (today < MAX_COUNTED_PER_DAY) {
      const won = await ctx.c.chapterReads.updateOne({ _id: id, counted: { $ne: true } }, { $set: { counted: true, countedAt: now } })
      if (won.matchedCount === 1) {
        forgetChaptersRead(ctx, user._id)
        xpGained = await awardXp(ctx, { userId: user._id, type: 'read', refId: id, amount: XP.chapterRead, group: 'read' })
      }
    }
  }
  return { ok: true, credited: credit, xpGained, chaptersRead: await chaptersRead(ctx, user._id) }
}
