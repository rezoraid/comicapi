const dupErr = () => Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
const eq = (a, b) => (a === undefined ? null : a) === (b === undefined ? null : b)
const ops = {
  $in: (v, arg) => arg.some(a => eq(v, a)),
  $gte: (v, arg) => v >= arg,
  $gt: (v, arg) => v > arg,
  $lt: (v, arg) => v < arg,
  $ne: (v, arg) => !eq(v, arg)
}
const match = (doc, filter) =>
  Object.entries(filter).every(([k, cond]) => {
    const v = doc[k]
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const keys = Object.keys(cond)
      if (keys.every(x => x.startsWith('$'))) return keys.every(op => (ops[op] ? ops[op](v, cond[op]) : (() => { throw new Error(`operator ${op} tidak didukung fake`) })()))
    }
    return eq(v, cond)
  })
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

class FakeCollection {
  docs = []
  uniques = []
  createIndex(spec, opts = {}) {
    if (opts.unique) this.uniques.push(Object.keys(spec))
    return Promise.resolve('ok')
  }
  #checkUnique(doc, ignore) {
    for (const keys of this.uniques) {
      if (this.docs.some(d => d !== ignore && keys.every(k => eq(d[k], doc[k])))) throw dupErr()
    }
  }
  async findOne(filter) {
    const d = this.docs.find(x => match(x, filter))
    return d ? structuredClone(d) : null
  }
  find(filter = {}, { sort, skip = 0, limit = 0 } = {}) {
    let rows = this.docs.filter(d => match(d, filter))
    if (sort) {
      const keys = Object.entries(sort)
      rows = [...rows].sort((a, b) => {
        for (const [k, dir] of keys) {
          const c = cmp(a[k], b[k])
          if (c) return c * dir
        }
        return 0
      })
    }
    rows = rows.slice(skip, limit ? skip + limit : undefined)
    return { toArray: async () => structuredClone(rows) }
  }
  async insertOne(doc) {
    if (this.docs.some(d => d._id === doc._id)) throw dupErr()
    this.#checkUnique(doc, null)
    this.docs.push(structuredClone(doc))
    return { insertedId: doc._id }
  }
  #apply(d, update) {
    const next = { ...d }
    for (const [k, v] of Object.entries(update.$set || {})) next[k] = v
    for (const [k, v] of Object.entries(update.$inc || {})) next[k] = (next[k] || 0) + v
    return next
  }
  async updateOne(filter, update) {
    const i = this.docs.findIndex(x => match(x, filter))
    if (i < 0) return { matchedCount: 0, modifiedCount: 0 }
    const next = this.#apply(this.docs[i], update)
    this.#checkUnique(next, this.docs[i])
    this.docs[i] = next
    return { matchedCount: 1, modifiedCount: 1 }
  }
  async updateMany(filter, update) {
    let n = 0
    this.docs = this.docs.map(d => (match(d, filter) ? (n++, this.#apply(d, update)) : d))
    return { matchedCount: n, modifiedCount: n }
  }
  async deleteOne(filter) {
    const i = this.docs.findIndex(x => match(x, filter))
    if (i >= 0) this.docs.splice(i, 1)
    return { deletedCount: i >= 0 ? 1 : 0 }
  }
  async countDocuments(filter = {}) {
    return this.docs.filter(d => match(d, filter)).length
  }
}

export const fakeDb = () => {
  const cols = new Map()
  return { collection: name => (cols.has(name) || cols.set(name, new FakeCollection()), cols.get(name)) }
}
