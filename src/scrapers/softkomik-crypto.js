/**
 * SoftKomik mengirim data halaman (detail & chapter) sebagai `_stk`:
 * string base64 hasil CryptoJS.AES.encrypt(json, passphrase) — format OpenSSL
 * "Salted__" + 8 byte salt, KDF EVP_BytesToKey (MD5), AES-256-CBC.
 * Passphrase-nya ada di bundle JS situs (NEXT_PUBLIC_ENCRYPTION_KEY).
 * Kalau suatu hari situs ganti kunci: set env SOFTKOMIK_KEY.
 */
import crypto from 'node:crypto'

export const DEFAULT_KEY = 'nYTInq9MwR4pWa8yeXtu/2iO3t9nGP65WHpWEvqpEdU='
const key = () => process.env.SOFTKOMIK_KEY || DEFAULT_KEY

function evpBytesToKey(pass, salt) {
  let out = Buffer.alloc(0)
  let prev = Buffer.alloc(0)
  while (out.length < 48) {
    prev = crypto.createHash('md5').update(Buffer.concat([prev, Buffer.from(pass), salt])).digest()
    out = Buffer.concat([out, prev])
  }
  return { key: out.subarray(0, 32), iv: out.subarray(32, 48) }
}

export const looksEncrypted = v => typeof v === 'string' && v.startsWith('U2FsdGVkX1')

export function decrypt(b64) {
  const raw = Buffer.from(String(b64), 'base64')
  if (raw.length < 32 || raw.subarray(0, 8).toString() !== 'Salted__') throw new Error('Format payload SoftKomik tidak dikenali')
  const { key: k, iv } = evpBytesToKey(key(), raw.subarray(8, 16))
  const d = crypto.createDecipheriv('aes-256-cbc', k, iv)
  const text = Buffer.concat([d.update(raw.subarray(16)), d.final()]).toString('utf8')
  return JSON.parse(text)
}

/** Dipakai test untuk membuat payload tiruan. */
export function encrypt(obj) {
  const salt = crypto.randomBytes(8)
  const { key: k, iv } = evpBytesToKey(key(), salt)
  const c = crypto.createCipheriv('aes-256-cbc', k, iv)
  const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()])
  return Buffer.concat([Buffer.from('Salted__'), salt, body]).toString('base64')
}
