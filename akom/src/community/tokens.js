import { createHmac, timingSafeEqual } from 'node:crypto'

export function createTokens({ secret, ttlDays, now = Date.now }) {
  const mac = body => createHmac('sha256', secret).update(`komikta.v1.${body}`).digest('base64url')
  return {
    ttlMs: ttlDays * 86_400_000,
    sign(userId) {
      const iat = Math.floor(now() / 1000)
      const body = Buffer.from(JSON.stringify({ sub: userId, iat, exp: iat + ttlDays * 86_400 })).toString('base64url')
      return `v1.${body}.${mac(body)}`
    },
    verify(token) {
      if (typeof token !== 'string' || token.length > 512) return null
      const [v, body, sig, extra] = token.split('.')
      if (v !== 'v1' || !body || !sig || extra !== undefined) return null
      const want = Buffer.from(mac(body))
      const got = Buffer.from(sig)
      if (want.length !== got.length || !timingSafeEqual(want, got)) return null
      try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
        if (typeof p.sub !== 'string' || typeof p.exp !== 'number' || p.exp * 1000 <= now()) return null
        return p
      } catch {
        return null
      }
    }
  }
}
