import { createCommunity } from './index.js'

export function startCommunity(cfg, { create = createCommunity, logger = console, baseDelayMs = 2000, maxDelayMs = 60_000, sharedCache = null } = {}) {
  let current = null
  let stopped = false
  let timer = null
  let wake = () => {}
  let attempt = 0
  const ready = (async function connect() {
    while (!stopped) {
      try {
        const cm = await create(cfg, { sharedCache, logger })
        if (stopped) {
          await cm?.close()
          return
        }
        current = cm
        if (cm) logger.log('komunitas aktif (MongoDB terhubung)')
        return
      } catch (err) {
        const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt++)
        logger.error(`komunitas gagal start (${err?.message || err}) — coba lagi ${Math.round(delay / 1000)} dtk`)
        await new Promise(resolve => {
          wake = resolve
          timer = setTimeout(resolve, delay)
        })
      }
    }
  })()
  return {
    get: () => current,
    ready,
    async stop() {
      stopped = true
      clearTimeout(timer)
      wake()
      await ready
      const cm = current
      current = null
      await cm?.close()
    }
  }
}
