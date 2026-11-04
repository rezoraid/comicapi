import { forbidden } from '../lib/errors.js'
import { hit } from './util.js'
import { deleteDoc } from './comments.js'

export async function deleteAccount(ctx, user) {
  if (user.role === 'OWNER') throw forbidden('Akun OWNER tidak bisa dihapus lewat aplikasi')
  hit(ctx.limits.write, user._id, 'Terlalu banyak permintaan')

  // Soft-delete komentar (perlu deleteDoc untuk reverse XP + replyCount)
  const mine = await ctx.c.comments.find({ userId: user._id, deleted: false }, { projection: { parentId: 1, replyCount: 1, userId: 1, deleted: 1 } }).toArray()
  // Sequential karena deleteDoc saling bergantung (root/reply); tetap dibatasi per akun
  for (const c of mine) await deleteDoc(ctx, c, user._id)

  // Un-like komentar orang lain secara batch
  const likes = await ctx.c.commentLikes.find({ userId: user._id }, { projection: { commentId: 1 } }).toArray()
  if (likes.length) {
    const commentIds = likes.map(l => l.commentId)
    await ctx.c.commentLikes.deleteMany({ userId: user._id })
    // $inc -1 per comment yang dilike — parallel batches
    await Promise.all(commentIds.map(cid => ctx.c.comments.updateOne({ _id: cid }, { $inc: { likeCount: -1 } })))
  }

  await Promise.all([
    ctx.c.likes.deleteMany({ userId: user._id }),
    ctx.c.readingProgress.deleteMany({ userId: user._id }),
    ctx.c.chapterReads.deleteMany({ userId: user._id }),
    ctx.c.xpEvents.deleteMany({ userId: user._id }),
    ctx.c.reports.deleteMany({ reporterId: user._id })
  ])
  await ctx.c.users.deleteOne({ _id: user._id })
  return { ok: true }
}
