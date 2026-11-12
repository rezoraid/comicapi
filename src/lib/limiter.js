import { HttpError } from './errors.js'

export function createLimiter({ max, maxQueue = 500, waitMs = 15_000 }) {
  let active = 0
  const queue = []

  const busy = () => new HttpError(503, 'BUSY', 'Server sedang sibuk, coba lagi sebentar')

  const releaseSlot = () => {
    const next = queue.shift()
    if (!next) {
      active--
      return
    }
    clearTimeout(next.timer)
    next.resolve()
  }

  const makeRelease = () => {
    let done = false
    return () => {
      if (done) return
      done = true
      releaseSlot()
    }
  }

  return {
    get active() {
      return active
    },
    get queued() {
      return queue.length
    },
    async acquire() {
      if (active < max) {
        active++
        return makeRelease()
      }
      if (queue.length >= maxQueue) throw busy()
      await new Promise((resolve, reject) => {
        const entry = { resolve, timer: null }
        entry.timer = setTimeout(() => {
          const i = queue.indexOf(entry)
          if (i !== -1) queue.splice(i, 1)
          reject(busy())
        }, waitMs)
        queue.push(entry)
      })
      return makeRelease()
    },
    async run(task) {
      const release = await this.acquire()
      try {
        return await task()
      } finally {
        release()
      }
    }
  }
}
