import { badRequest, forbidden, notFound } from '../lib/errors.js'
import { rank, idParam, newId, bodyText, qint, qstr, ID, SLUG } from './util.js'

/**
 * Pengumuman dari OWNER yang ditampilkan sebagai notifikasi di semua HP.
 * HP mengambilnya berkala (tanpa login, tanpa data pribadi) dan memposting notifikasi lokal.
 * ID berurutan menurut waktu (hex), jadi "setelah ID ini" cukup dengan perbandingan teks.
 */

export const ZERO_ID = '0'.repeat(24)
const PAGE_SIZE = 20
const FEED_LIMIT = 20

const needOwner = u => {
  if (rank(u) < 3) throw forbidden('Fitur ini khusus OWNER')
}

const oneLine = (v, name, max) => bodyText(v, name, { max }).replace(/\s*\n\s*/g, ' ')

const view = b => ({ id: b._id, title: b.title, body: b.body, source: b.source || '', slug: b.slug || '', createdAt: b.createdAt })

/** OWNER mengirim pengumuman. `source` + `slug` (opsional, harus berpasangan) = komik yang dibuka saat notifikasi diketuk. */
export async function createBroadcast(ctx, actor, input, hasSource) {
  needOwner(actor)
  const title = oneLine(input?.title, 'title', 60)
  const body = bodyText(input?.body, 'body', { max: 200 })
  const source = typeof input?.source === 'string' ? input.source.trim() : ''
  const slug = typeof input?.slug === 'string' ? input.slug.trim() : ''
  if (!!source !== !!slug) throw badRequest('"source" dan "slug" harus diisi berpasangan')
  if (source && !hasSource(source)) throw badRequest(`Sumber "${source}" tidak ada`)
  if (slug && !SLUG.test(slug)) throw badRequest('"slug" tidak valid')
  const doc = { _id: newId(), title, body, source, slug, createdBy: actor._id, createdAt: ctx.now(), deleted: false }
  await ctx.c.broadcasts.insertOne(doc)
  return { broadcast: view(doc) }
}

/**
 * Publik, dipakai HP.
 *  - tanpa `after`: hanya `latestId` (posisi awal untuk HP baru; pengumuman lama tidak dikirim ulang)
 *  - dengan `after`: pengumuman yang lebih baru, paling lama dulu, maks 20
 */
export async function feed(ctx, query) {
  const afterRaw = qstr(query, 'after', 24)
  if (afterRaw && !ID.test(afterRaw)) throw badRequest('"after" tidak valid')
  const latest = await ctx.c.broadcasts.find({ deleted: false }, { sort: { _id: -1 }, limit: 1 }).toArray()
  const latestId = latest[0]?._id || ZERO_ID
  if (!afterRaw) return { latestId, items: [] }
  const rows = await ctx.c.broadcasts.find({ deleted: false, _id: { $gt: afterRaw } }, { sort: { _id: 1 }, limit: FEED_LIMIT }).toArray()
  return { latestId, items: rows.map(view) }
}

/** Riwayat pengumuman untuk panel OWNER, terbaru dulu. */
export async function listBroadcasts(ctx, actor, query) {
  needOwner(actor)
  const page = qint(query, 'page', 1, 1, 200)
  const rows = await ctx.c.broadcasts.find({ deleted: false }, { sort: { _id: -1 }, skip: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE + 1 }).toArray()
  return { page, hasMore: rows.length > PAGE_SIZE, items: rows.slice(0, PAGE_SIZE).map(view) }
}

/** Tarik pengumuman: HP yang belum mengambilnya tidak akan menerimanya (yang sudah menerima tetap punya notifikasinya). */
export async function removeBroadcast(ctx, actor, id) {
  needOwner(actor)
  const uid = idParam(id)
  const found = await ctx.c.broadcasts.findOne({ _id: uid, deleted: false })
  if (!found) throw notFound('Pengumuman tidak ditemukan')
  await ctx.c.broadcasts.updateOne({ _id: uid }, { $set: { deleted: true } })
  return { ok: true }
}
