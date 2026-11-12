// Statistik baca yang dihitung dari data tersimpan di server. Klien tidak pernah mengirim angka ini.
// Hasil COUNT ditahan singkat di memori (10 dtk) dan dibuang tepat saat chapter baru dihitung di instance ini.
export const chaptersRead = async (ctx, userId) => {
  const cached = ctx.stats?.chaptersRead.get(userId)
  if (cached !== undefined) return cached
  const n = await ctx.c.chapterReads.countDocuments({ userId, counted: true })
  ctx.stats?.chaptersRead.set(userId, n)
  return n
}

export const forgetChaptersRead = (ctx, userId) => ctx.stats?.chaptersRead.delete(userId)

// Satu aggregate untuk banyak komik sekaligus (menggantikan satu COUNT per baris riwayat). Hasil: Map "source:slug" → jumlah.
export async function chaptersReadByComics(ctx, userId, rows) {
  const out = new Map()
  if (!rows.length) return out
  const sources = [...new Set(rows.map(r => r.source))]
  const slugs = [...new Set(rows.map(r => r.slug))]
  const grouped = await ctx.c.chapterReads
    .aggregate([
      { $match: { userId, counted: true, source: { $in: sources }, slug: { $in: slugs } } },
      { $group: { _id: { source: '$source', slug: '$slug' }, n: { $sum: 1 } } }
    ])
    .toArray()
  for (const g of grouped) out.set(`${g._id.source}:${g._id.slug}`, g.n)
  return out
}
