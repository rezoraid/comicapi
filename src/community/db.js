export async function connectMongo({ mongoUri, dbName }) {
  const { MongoClient } = await import('mongodb')
  const client = new MongoClient(mongoUri, {
    maxPoolSize: 50,
    minPoolSize: 5,
    maxIdleTimeMS: 60_000,
    waitQueueTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    // compressors bantu saat dokumen besar / banyak field teks
    compressors: ['zlib'],
    appName: 'komikta-community'
  })
  await client.connect()
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
  counters: db.collection('counters')
})

/** Field user yang cukup untuk auth + publicUser. customPicture (base64) sengaja di-exclude. */
export const USER_LIGHT = {
  googleSub: 1,
  email: 1,
  name: 1,
  picture: 1,
  username: 1,
  role: 1,
  roleManual: 1,
  verified: 1,
  publicNo: 1,
  xp: 1,
  level: 1,
  banned: 1,
  usernameChangedAt: 1,
  createdAt: 1,
  lastLoginAt: 1,
  nameCustom: 1,
  readTimeAt: 1,
  readSeconds: 1,
  hasCustomPicture: 1,
  xpReconciledAt: 1
}

export const ensureIndexes = async c => {
  await Promise.all([
    c.users.createIndex({ googleSub: 1 }, { unique: true }),
    c.users.createIndex({ username: 1 }, { unique: true }),
    c.users.createIndex({ role: 1 }),
    c.users.createIndex({ publicNo: 1 }, { sparse: true }),
    c.users.createIndex({ lastLoginAt: -1 }),
    c.users.createIndex({ createdAt: -1 }),
    c.users.createIndex({ banned: 1 }),
    c.readingProgress.createIndex({ userId: 1, updatedAt: -1 }),
    c.readingProgress.createIndex({ userId: 1, source: 1, slug: 1 }, { unique: true }),
    c.readingProgress.createIndex({ source: 1, slug: 1 }),
    c.chapterReads.createIndex({ userId: 1, counted: 1, countedAt: -1 }),
    c.chapterReads.createIndex({ userId: 1, source: 1, slug: 1 }),
    c.chapterReads.createIndex({ userId: 1, source: 1, slug: 1, counted: 1 }),
    c.likes.createIndex({ userId: 1, createdAt: -1 }),
    c.likes.createIndex({ targetKey: 1 }),
    c.comments.createIndex({ userId: 1, deleted: 1, _id: -1 }),
    c.comments.createIndex({ targetKey: 1, parentId: 1, listed: 1, _id: -1 }),
    c.comments.createIndex({ targetKey: 1, parentId: 1, listed: 1, likeCount: -1, _id: -1 }),
    c.comments.createIndex({ parentId: 1, deleted: 1, _id: 1 }),
    c.comments.createIndex({ targetKey: 1, deleted: 1 }),
    c.comments.createIndex({ userId: 1, bodyHash: 1, createdAt: -1 }),
    c.comments.createIndex({ type: 1, source: 1, slug: 1, deleted: 1 }),
    c.commentLikes.createIndex({ commentId: 1, userId: 1 }, { unique: true }),
    c.commentLikes.createIndex({ userId: 1, commentId: 1 }),
    c.reports.createIndex({ commentId: 1, reporterId: 1 }, { unique: true }),
    c.reports.createIndex({ status: 1, _id: -1 }),
    c.xpEvents.createIndex({ userId: 1, type: 1, refId: 1 }, { unique: true }),
    c.xpEvents.createIndex({ userId: 1, group: 1, createdAt: -1 }),
    c.xpEvents.createIndex({ commentId: 1 }),
    c.xpEvents.createIndex({ userId: 1, reversed: 1, group: 1, createdAt: -1 })
  ])

  // Backfill flag avatar agar projection ringan bisa dipakai tanpa memuat base64.
  // Operasi idempotent, aman dijalankan setiap start.
  await c.users.updateMany(
    { customPicture: { $exists: true, $type: 'string', $ne: '' }, hasCustomPicture: { $ne: true } },
    { $set: { hasCustomPicture: true } }
  )
}
