import { forbidden } from '../lib/errors.js'
import { hit } from './util.js'
import { deleteDoc } from './comments.js'

export async function deleteAccount(ctx, user) {
  if (user.role === 'OWNER') throw forbidden('Akun OWNER tidak bisa dihapus lewat aplikasi')
  hit(ctx.limits.write, user._id, 'Terlalu banyak permintaan')
  const mine = await ctx.c.comments.find({ userId: user._id, deleted: false }).toArray()
  for (const c of mine) await deleteDoc(ctx, c, user._id)
  const likes = await ctx.c.commentLikes.find({ userId: user._id }).toArray()
  for (const l of likes) {
    const r = await ctx.c.commentLikes.deleteOne({ _id: l._id })
    if (r.deletedCount === 1) await ctx.c.comments.updateOne({ _id: l.commentId }, { $inc: { likeCount: -1 } })
  }
  await ctx.c.likes.deleteMany({ userId: user._id })
  await ctx.c.readingProgress.deleteMany({ userId: user._id })
  await ctx.c.users.deleteOne({ _id: user._id })
  return { ok: true }
}
