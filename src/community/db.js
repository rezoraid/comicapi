export async function connectMongo({ mongoUri, dbName, mongoPoolMax = 30, mongoPoolMin = 2 }) {
  const { MongoClient } = await import('mongodb')
  const client = new MongoClient(mongoUri, {
    appName: 'komikta-community',
    maxPoolSize: mongoPoolMax,
    minPoolSize: mongoPoolMin, // koneksi hangat → request pertama setelah sepi tidak kena handshake TLS
    maxIdleTimeMS: 60_000,
    connectTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 8_000,
    socketTimeoutMS: 45_000, // query macet tidak boleh menahan request selamanya
    waitQueueTimeoutMS: 10_000, // pool habis → gagal cepat (503/504), bukan antre tanpa batas
    retryWrites: true,
    retryReads: true
  })
  try {
    await client.connect()
  } catch (err) {
    await client.close().catch(() => {}) // jangan bocorkan socket/timer saat retry
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
  pushTokens: db.collection('push_tokens')
})

// Indeks yang sudah ada TIDAK diubah (mengubah opsi indeks yang sama membuat createIndex error).
// Indeks tambahan di bawah hanya menutup query yang tadinya collection scan / membaca banyak dokumen.
const INDEXES = c => [
  [c.users, { googleSub: 1 }, { unique: true }],
  [c.users, { username: 1 }, { unique: true }],
  [c.users, { role: 1 }],
  [c.users, { createdAt: -1 }], // daftar pengguna admin + statistik 7 hari
  [c.users, { lastLoginAt: -1 }], // statistik aktif 24 jam
  [c.users, { publicNo: 1 }, { sparse: true }], // claimOwnerNo mencari pemegang nomor 1
  // Tanpa opsi (bukan partial): database produksi yang sudah punya indeks `banned_1` polos otomatis cocok,
  // sehingga createIndex tidak bentrok (error IndexOptionsConflict yang muncul di log Railway).
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
  [c.comments, { userId: 1, clientId: 1 }, { sparse: true }], // idempotensi kiriman komentar (optimistic UI + retry)
  [c.comments, { type: 1, source: 1, slug: 1, deleted: 1 }],
  [c.comments, { deleted: 1, createdAt: -1 }], // komentar 24 jam terakhir (statistik admin)
  [c.comments, { reportCount: 1 }, { partialFilterExpression: { reportCount: { $gt: 0 } } }], // filter "dilaporkan"
  [c.commentLikes, { commentId: 1, userId: 1 }, { unique: true }],
  [c.commentLikes, { userId: 1, commentId: 1 }],
  [c.reports, { commentId: 1, reporterId: 1 }, { unique: true }],
  [c.reports, { status: 1, _id: -1 }],
  [c.xpEvents, { userId: 1, type: 1, refId: 1 }, { unique: true }],
  [c.xpEvents, { userId: 1, group: 1, createdAt: -1 }],
  [c.xpEvents, { userId: 1, reversed: 1, xp: 1 }], // total XP (aggregate $sum) terlayani langsung dari indeks
  [c.xpEvents, { commentId: 1 }],
  [c.broadcasts, { deleted: 1, _id: 1 }], // pengumuman OWNER (feed HP + riwayat panel)
  [c.pushTokens, { token: 1 }, { unique: true }],
  [c.pushTokens, { userId: 1 }],
  [c.pushTokens, { updatedAt: 1 }]
]

const sameKey = (a, b) => JSON.stringify(Object.entries(a || {})) === JSON.stringify(Object.entries(b || {}))

// 85 = IndexOptionsConflict, 86 = IndexKeySpecsConflict (indeks sama sudah ada dengan opsi/nama berbeda)
const isIndexConflict = err => err?.code === 85 || err?.code === 86 || err?.codeName === 'IndexOptionsConflict' || err?.codeName === 'IndexKeySpecsConflict'

/**
 * Satu indeks gagal (mis. data lama melanggar unique, atau indeks setara sudah ada dengan opsi lain)
 * tidak boleh mematikan komunitas, dan tidak boleh membuat log berisik di setiap deploy.
 * Konflik opsi dianggap AMAN selama sudah ada indeks dengan kunci yang sama: query tetap terlayani indeks itu.
 */
const createOne = async (col, spec, opts, logger) => {
  try {
    await col.createIndex(spec, opts)
  } catch (err) {
    if (isIndexConflict(err)) {
      const existing = typeof col.indexes === 'function' ? await col.indexes().catch(() => null) : null
      if (existing?.some(i => sameKey(i.key, spec))) return // indeks setara sudah ada
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

/**
 * Foto profil kini ditandai dengan `hasAvatar`, jadi dokumen user bisa dibaca TANPA isi base64-nya.
 * Dokumen lama (punya customPicture tapi belum ada flag) diberi flag sekali di sini.
 */
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
