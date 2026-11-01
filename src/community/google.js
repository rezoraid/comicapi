import { createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { HttpError } from '../lib/errors.js'

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const invalid = () => new HttpError(401, 'INVALID_GOOGLE_TOKEN', 'Token Google tidak valid atau kedaluwarsa')

const defaultFetchJwks = async () => {
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { keys } = await res.json()
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '')
  return { keys, maxAge: m ? parseInt(m[1], 10) : 3600 }
}

const decode = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))

export function createGoogleVerifier({ clientIds, fetchJwks = defaultFetchJwks, now = Date.now }) {
  let keys = new Map()
  let expires = 0
  let lastFetch = 0

  const refresh = async () => {
    lastFetch = now()
    try {
      const { keys: list, maxAge } = await fetchJwks()
      keys = new Map(list.map(k => [k.kid, createPublicKey({ key: k, format: 'jwk' })]))
      expires = now() + Math.max(60, maxAge) * 1000
    } catch {
      throw new HttpError(503, 'GOOGLE_UNAVAILABLE', 'Tidak bisa memverifikasi login Google saat ini')
    }
  }

  const keyFor = async kid => {
    if (now() >= expires || (!keys.has(kid) && now() - lastFetch > 60_000)) await refresh()
    return keys.get(kid)
  }

  return {
    async verify(idToken) {
      if (typeof idToken !== 'string' || idToken.length > 4096) throw invalid()
      const parts = idToken.split('.')
      if (parts.length !== 3) throw invalid()
      let header, payload
      try {
        header = decode(parts[0])
        payload = decode(parts[1])
      } catch {
        throw invalid()
      }
      if (header?.alg !== 'RS256' || typeof header.kid !== 'string') throw invalid()
      const key = await keyFor(header.kid)
      if (!key) throw invalid()
      const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))
      if (!ok) throw invalid()
      const nowSec = Math.floor(now() / 1000)
      if (!ISSUERS.includes(payload.iss)) throw invalid()
      if (!clientIds.includes(payload.aud)) throw invalid()
      if (typeof payload.exp !== 'number' || payload.exp + 60 < nowSec) throw invalid()
      if (typeof payload.iat === 'number' && payload.iat - 300 > nowSec) throw invalid()
      if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 64) throw invalid()
      if (payload.email_verified !== true && payload.email_verified !== 'true') throw invalid()
      if (typeof payload.email !== 'string' || !payload.email.includes('@')) throw invalid()
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        name: typeof payload.name === 'string' ? payload.name : '',
        picture: typeof payload.picture === 'string' ? payload.picture : ''
      }
    }
  }
}
