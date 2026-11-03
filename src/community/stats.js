// Statistik baca yang dihitung dari data tersimpan di server. Klien tidak pernah mengirim angka ini.
export const chaptersRead = (ctx, userId) => ctx.c.chapterReads.countDocuments({ userId, counted: true })

export const chaptersReadByComic = (ctx, userId, source, slug) =>
  ctx.c.chapterReads.countDocuments({ userId, source, slug, counted: true })
