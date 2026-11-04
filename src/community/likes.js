import { badRequest } from '../lib/errors.js'
import { hit } from './util.js'
import { resolveTarget } from './comments.js'

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '')

// Like sebuah komik atau chapter. Satu dokumen per (user, target) sehingga idempotent.
export async function setLike(ctx, user, input, hasSource, on) {
  hit(ctx.limits.like, user._id, 'Terlalu banyak like')
  const t = resolveTarget(input, hasSource)
  const _id = `${user._id}:${t.targetKey}`
  if (on) {
    const cover = typeof input.coverUrl === 'string' && input.coverUrl.startsWith('https://') ? input.coverUrl.slice(0, 1000) : ''
    await ctx.c.likes.updateOne(
      { _id },
      {
        $set: { comicTitle: clean(input.comicTitle, 180), chapterTitle: clean(input.chapterTitle, 100), coverUrl: cover },
        $setOnInsert: { userId: user._id, type: t.type, source: t.source, slug: t.slug, chapter: t.chapter, targetKey: t.targetKey, createdAt: ctx.now() }
      },
      { upsert: true }
    )
  } else await ctx.c.likes.deleteOne({ _id })
  return { liked: on, count: await ctx.c.likes.countDocuments({ targetKey: t.targetKey }) }
}

export async function likeStatus(ctx, viewer, input, hasSource) {
  const t = resolveTarget(input, hasSource)
  const [count, mine] = await Promise.all([
    ctx.c.likes.countDocuments({ targetKey: t.targetKey }),
    viewer ? ctx.c.likes.findOne({ _id: `${viewer._id}:${t.targetKey}` }, { projection: { _id: 1 } }) : null
  ])
  return { liked: !!mine, count }
}

export const requireBool = (v, name) => {
  if (typeof v !== 'boolean') throw badRequest(`"${name}" harus berupa boolean`)
  return v
}
