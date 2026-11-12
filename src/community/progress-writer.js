/**
 * Penulis progres baca dengan tulis-belakangan (write-behind) + coalescing.
 *
 * Progres baca (PUT /me/reading-progress) dan akumulasi detik baca (PUT /me/reading-time) adalah
 * penulisan paling sering di API, dan respons-nya tidak bergantung pada hasil tulis. Di sini request
 * langsung dijawab, perubahan untuk dokumen yang sama digabung, lalu dikirim ke MongoDB tiap `flushMs`.
 *
 *  - flushMs <= 0 → tulis langsung (perilaku lama, tanpa antrean)
 *  - flushFor(userId) → dipanggil sebelum membaca riwayat user supaya "baca punya sendiri" tetap konsisten
 *  - drop(userId)     → dipakai saat hapus akun agar tidak ada upsert yatim setelah akun hilang
 *  - close()          → menguras antrean saat shutdown
 */
const CHUNK = 50
const MAX_TRIES = 3
const MAX_PENDING = 20_000

export function createProgressWriter(coll, { flushMs = 1000, logger = console } = {}) {
  const pending = new Map()
  let timer = null
  let chain = Promise.resolve()
  let closed = false

  async function writeOne(id, e) {
    const update = {}
    if (e.set) {
      // Mongo menolak path yang sama di $set dan $setOnInsert, jadi buang yang bentrok setelah penggabungan
      const onInsert = { ...e.setOnInsert }
      for (const k of Object.keys(e.set)) delete onInsert[k]
      update.$set = e.set
      if (Object.keys(onInsert).length) update.$setOnInsert = onInsert
    }
    if (e.inc) update.$inc = { readSeconds: e.inc }
    // hanya upsert kalau ada data penuh; penambahan detik saja tidak boleh membuat dokumen setengah jadi
    await coll.updateOne({ _id: id }, update, { upsert: !!e.set })
  }

  function flush() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!pending.size) return chain
    const batch = [...pending]
    pending.clear()
    chain = chain.then(async () => {
      for (let i = 0; i < batch.length; i += CHUNK) {
        await Promise.all(
          batch.slice(i, i + CHUNK).map(async ([id, e]) => {
            try {
              await writeOne(id, e)
            } catch (err) {
              logger.error(`progres baca gagal ditulis (${id}): ${err?.message || err}`)
              // coba lagi di flush berikutnya, tapi jangan selamanya
              if (++e.tries < MAX_TRIES && !pending.has(id) && !closed) pending.set(id, e)
              if (pending.size && !timer && !closed) schedule()
            }
          })
        )
      }
    })
    return chain
  }

  function schedule() {
    if (timer || flushMs <= 0) return
    timer = setTimeout(() => {
      timer = null
      flush()
    }, flushMs)
    timer.unref?.()
  }

  function entry(id) {
    let e = pending.get(id)
    if (!e) {
      e = { set: null, setOnInsert: null, inc: 0, tries: 0 }
      pending.set(id, e)
    }
    return e
  }

  return {
    get pending() {
      return pending.size
    },

    /** Simpan/perbarui progres (upsert). */
    async save(id, set, setOnInsert = {}) {
      if (flushMs <= 0 || closed) return writeOne(id, { set, setOnInsert, inc: 0 })
      if (pending.size >= MAX_PENDING && !pending.has(id)) await flush() // antrean tidak boleh tumbuh tanpa batas
      const e = entry(id)
      e.set = { ...e.set, ...set }
      e.setOnInsert = { ...setOnInsert, ...e.setOnInsert } // createdAt tertua menang
      schedule()
    },

    /** Tambah detik baca ke dokumen progres yang sudah ada (tidak membuat dokumen baru). */
    async addSeconds(id, seconds) {
      if (flushMs <= 0 || closed) return writeOne(id, { set: null, inc: seconds })
      entry(id).inc += seconds
      schedule()
    },

    flush,

    /** Kuras antrean kalau ada entri milik user ini (read-your-writes untuk riwayat sendiri). */
    async flushFor(userId) {
      const prefix = `${userId}:`
      for (const id of pending.keys()) if (id.startsWith(prefix)) return flush()
      return chain
    },

    /** Buang antrean user + tunggu penulisan yang sedang berjalan (dipakai saat hapus akun). */
    async drop(userId) {
      const prefix = `${userId}:`
      for (const id of [...pending.keys()]) if (id.startsWith(prefix)) pending.delete(id)
      await chain
    },

    async close() {
      closed = true
      await flush()
      await chain
    }
  }
}
