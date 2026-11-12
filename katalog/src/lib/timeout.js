import { HttpError } from './errors.js'

export function withTimeout(promise, ms) {
  let t
  const timer = new Promise((_, reject) => {
    t = setTimeout(() => reject(new HttpError(504, 'SOURCE_TIMEOUT', 'Sumber terlalu lama merespons')), ms)
  })
  return Promise.race([promise, timer]).finally(() => clearTimeout(t))
}
