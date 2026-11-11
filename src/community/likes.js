import { hit } from './util.js'
import { resolveTarget } from './comments.js'

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '')

const likeCount = async (ctx, targetKey) => {
  const hit = ctx.stats?.likeCount.get(targetKey)
  if (hit !== undefined) return hit
  const n = await ctx.c.likes.countDocuments({ targetKey })
  ctx.stats?.likeCount.set(targetKey, n)
  return n
}

export async function setLike(ctx, user, input, hasSource, on) {
  await hit(ctx.limits.like, user._id, 'Terlalu banyak like')
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
  ctx.stats?.likeCount.delete(t.targetKey)
  return { liked: on, count: await likeCount(ctx, t.targetKey) }
}

export async function likeStatus(ctx, viewer, input, hasSource) {
  const t = resolveTarget(input, hasSource)
  const [count, mine] = await Promise.all([
    likeCount(ctx, t.targetKey),
    viewer ? ctx.c.likes.findOne({ _id: `${viewer._id}:${t.targetKey}` }) : null
  ])
  return { liked: !!mine, count }
}
