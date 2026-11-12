export async function connectMongo({ mongoUri, dbName, mongoPoolMax = 30, mongoPoolMin = 2 }) {
  const { MongoClient } = await import('mongodb')
  const client = new MongoClient(mongoUri, {
    appName: 'komikta-community',
    maxPoolSize: mongoPoolMax,
    minPoolSize: mongoPoolMin,
    maxIdleTimeMS: 60_000,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 8_000,
    socketTimeoutMS: 45_000,
    waitQueueTimeoutMS: 10_000,
    retryWrites: true,
    retryReads: true
  })
  try {
    await client.connect()
  } catch (err) {
    await client.close().catch(() => {})
    throw err
  }
  return { db: client.db(dbName), close: () => client.close() }
}

export const collections = db => ({
  users: db.collection('users'),
  comments: db.collection('comments'),
  commentLikes: db.collection('comment_likes'),
  reports: db.collection('reports'),
  xpEvents: db.collection('xp_events'),
  readingProgress: db.collection('reading_progress'),
  likes: db.collection('likes'),
  chapterReads: db.collection('chapter_reads'),
  counters: db.collection('counters'),
  broadcasts: db.collection('broadcasts'),
  pushTokens: db.collection('push_tokens'),
  comicStats: db.collection('comic_stats'),
  chapterStats: db.collection('chapter_stats'),
  viewDedupe: db.collection('view_dedupe'),
  comicOverrides: db.collection('comic_overrides'),
  chapterOverrides: db.collection('chapter_overrides'),
  media: db.collection('media'),
  catalog: db.collection('comic_catalog')
})

const INDEXES = c => [
  [c.users, { googleSub: 1 }, { unique: true }],
  [c.users, { username: 1 }, { unique: true }],
  [c.users, { role: 1 }],
  [c.users, { createdAt: -1 }],
  [c.users, { lastLoginAt: -1 }],
  [c.users, { publicNo: 1 }, { sparse: true }],
  [c.users, { banned: 1 }],
  [c.readingProgress, { userId: 1, updatedAt: -1 }],
  [c.readingProgress, { userId: 1, source: 1, slug: 1 }, { unique: true }],
  [c.readingProgress, { source: 1, slug: 1 }],
  [c.chapterReads, { userId: 1, counted: 1, countedAt: -1 }],
  [c.chapterReads, { userId: 1, source: 1, slug: 1 }],
  [c.likes, { userId: 1, createdAt: -1 }],
  [c.likes, { targetKey: 1 }],
  [c.comments, { userId: 1, deleted: 1, _id: -1 }],
  [c.comments, { targetKey: 1, parentId: 1, listed: 1, _id: -1 }],
  [c.comments, { targetKey: 1, parentId: 1, listed: 1, likeCount: -1, _id: -1 }],
  [c.comments, { parentId: 1, deleted: 1, _id: 1 }],
  [c.comments, { targetKey: 1, deleted: 1 }],
  [c.comments, { userId: 1, bodyHash: 1, createdAt: -1 }],
  [c.comments, { userId: 1, clientId: 1 }, { sparse: true }],
  [c.comments, { type: 1, source: 1, slug: 1, deleted: 1 }],
  [c.comments, { deleted: 1, createdAt: -1 }],
  [c.comments, { reportCount: 1 }, { partialFilterExpression: { reportCount: { $gt: 0 } } }],
  [c.commentLikes, { commentId: 1, userId: 1 }, { unique: true }],
  [c.commentLikes, { userId: 1, commentId: 1 }],
  [c.reports, { commentId: 1, reporterId: 1 }, { unique: true }],
  [c.reports, { status: 1, _id: -1 }],
  [c.xpEvents, { userId: 1, type: 1, refId: 1 }, { unique: true }],
  [c.xpEvents, { userId: 1, group: 1, createdAt: -1 }],
  [c.xpEvents, { userId: 1, reversed: 1, xp: 1 }],
  [c.xpEvents, { commentId: 1 }],
  [c.broadcasts, { deleted: 1, _id: 1 }],
  [c.pushTokens, { token: 1 }, { unique: true }],
  [c.pushTokens, { userId: 1 }],
  [c.pushTokens, { updatedAt: 1 }],
  [c.viewDedupe, { at: 1 }, { expireAfterSeconds: 21_600 }],
  [c.comicOverrides, { type: 1 }, { sparse: true }],
  [c.catalog, { nt: 1 }, { sparse: true }]
]

const sameKey = (a, b) => JSON.stringify(Object.entries(a || {})) === JSON.stringify(Object.entries(b || {}))

const isIndexConflict = err => err?.code === 85 || err?.code === 86 || err?.codeName === 'IndexOptionsConflict' || err?.codeName === 'IndexKeySpecsConflict'

const createOne = async (col, spec, opts, logger) => {
  try {
    await col.createIndex(spec, opts)
  } catch (err) {
    if (isIndexConflict(err)) {
      const existing = typeof col.indexes === 'function' ? await col.indexes().catch(() => null) : null
      if (existing?.some(i => sameKey(i.key, spec))) return
    }
    throw err
  }
}

export const ensureIndexes = async (c, logger = console) => {
  const jobs = INDEXES(c)
  const results = await Promise.allSettled(jobs.map(([col, spec, opts]) => createOne(col, spec, opts, logger)))
  results.forEach((r, i) => {
    if (r.status === 'rejected') logger.error(`indeks gagal dibuat ${JSON.stringify(jobs[i][1])}: ${r.reason?.message || r.reason}`)
  })
}

export const backfillAvatarFlag = async (c, logger = console) => {
  try {
    await c.users.updateMany(
      { hasAvatar: { $exists: false }, customPicture: { $exists: true, $nin: [null, ''] } },
      { $set: { hasAvatar: true } }
    )
  } catch (err) {
    logger.error(`backfill hasAvatar gagal: ${err?.message || err}`)
  }
}
