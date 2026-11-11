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
      const onInsert = { ...e.setOnInsert }
      for (const k of Object.keys(e.set)) delete onInsert[k]
      update.$set = e.set
      if (Object.keys(onInsert).length) update.$setOnInsert = onInsert
    }
    if (e.inc) update.$inc = { readSeconds: e.inc }
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
    async save(id, set, setOnInsert = {}) {
      if (flushMs <= 0 || closed) return writeOne(id, { set, setOnInsert, inc: 0 })
      if (pending.size >= MAX_PENDING && !pending.has(id)) await flush()
      const e = entry(id)
      e.set = { ...e.set, ...set }
      e.setOnInsert = { ...setOnInsert, ...e.setOnInsert }
      schedule()
    },
    async addSeconds(id, seconds) {
      if (flushMs <= 0 || closed) return writeOne(id, { set: null, inc: seconds })
      entry(id).inc += seconds
      schedule()
    },
    flush,
    async flushFor(userId) {
      const prefix = `${userId}:`
      for (const id of pending.keys()) if (id.startsWith(prefix)) return flush()
      return chain
    },
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
