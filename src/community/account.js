import { forbidden } from '../lib/errors.js'
import { hit } from './util.js'
import { deleteDoc } from './comments.js'

export async function deleteAccount(ctx, user) {
  if (user.role === 'OWNER') throw forbidden('Akun OWNER tidak bisa dihapus lewat aplikasi')
  await hit(ctx.limits.write, user._id, 'Terlalu banyak permintaan')
  const mine = await ctx.c.comments.find({ userId: user._id, deleted: false }).toArray()
  for (const c of mine) await deleteDoc(ctx, c, user._id)
  const likes = await ctx.c.commentLikes.find({ userId: user._id }, { projection: { commentId: 1 } }).toArray()
  // tiap like menyentuh komentar berbeda → aman diparalelkan per kelompok kecil
  for (let i = 0; i < likes.length; i += 10) {
    await Promise.all(
      likes.slice(i, i + 10).map(async l => {
        const r = await ctx.c.commentLikes.deleteOne({ _id: l._id })
        if (r.deletedCount === 1) await ctx.c.comments.updateOne({ _id: l.commentId }, { $inc: { likeCount: -1 } })
      })
    )
  }
  await ctx.progress.drop(user._id) // buang antrean tulis-belakangan agar tidak ada progres yatim setelah akun hilang
  // like komik/chapter milik user ikut hilang → jumlah like per target di cache harus dibuang
  const myLikes = await ctx.c.likes.find({ userId: user._id }, { projection: { targetKey: 1 } }).toArray()
  myLikes.forEach(l => ctx.stats?.likeCount.delete(l.targetKey))
  await Promise.all([
    ctx.c.likes.deleteMany({ userId: user._id }),
    ctx.c.readingProgress.deleteMany({ userId: user._id }),
    ctx.c.chapterReads.deleteMany({ userId: user._id })
  ])
  ctx.stats?.chaptersRead.delete(user._id)
  await ctx.push?.dropUser(user._id)
  await ctx.c.users.deleteOne({ _id: user._id })
  ctx.avatars?.delete(user._id)
  return { ok: true }
}
