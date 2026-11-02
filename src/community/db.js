export async function connectMongo({ mongoUri, dbName }) {
  const { MongoClient } = await import('mongodb')
  const client = new MongoClient(mongoUri, { maxPoolSize: 10, serverSelectionTimeoutMS: 8000, appName: 'komikta-community' })
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
  counters: db.collection('counters')
})

export const ensureIndexes = async c => {
  await Promise.all([
    c.users.createIndex({ googleSub: 1 }, { unique: true }),
    c.users.createIndex({ username: 1 }, { unique: true }),
    c.users.createIndex({ role: 1 }),
    c.readingProgress.createIndex({ userId: 1, updatedAt: -1 }),
    c.readingProgress.createIndex({ userId: 1, source: 1, slug: 1 }, { unique: true }),
    c.readingProgress.createIndex({ source: 1, slug: 1 }),
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
    c.xpEvents.createIndex({ commentId: 1 })
  ])
}
