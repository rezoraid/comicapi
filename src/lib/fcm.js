import { createSign } from 'node:crypto'

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const b64url = v => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')

export function parseServiceAccount(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  try {
    const json = JSON.parse(text.startsWith('{') ? text : Buffer.from(text, 'base64').toString('utf8'))
    return json.client_email && json.private_key && json.project_id ? { email: json.client_email, key: json.private_key, project: json.project_id, tokenUri: json.token_uri || 'https://oauth2.googleapis.com/token' } : null
  } catch {
    return null
  }
}

export function createFcm({ serviceAccount, fetchImpl = fetch, now = Date.now, logger = console } = {}) {
  const sa = typeof serviceAccount === 'string' ? parseServiceAccount(serviceAccount) : serviceAccount
  if (!sa) return { enabled: false, send: async () => ({ ok: false, skipped: true }) }
  let cached = null

  const accessToken = async () => {
    if (cached && cached.exp - 60_000 > now()) return cached.value
    const iat = Math.floor(now() / 1000)
    const head = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: sa.email, scope: SCOPE, aud: sa.tokenUri, iat, exp: iat + 3600 })}`
    const sig = createSign('RSA-SHA256').update(head).sign(sa.key, 'base64url')
    const res = await fetchImpl(sa.tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${sig}` }),
      signal: AbortSignal.timeout(8000)
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.access_token) throw new Error(`token FCM gagal (${res.status})`)
    cached = { value: json.access_token, exp: now() + (json.expires_in || 3600) * 1000 }
    return cached.value
  }

  const send = async (target, data, { ttl = 3600 } = {}) => {
    try {
      const res = await fetchImpl(`https://fcm.googleapis.com/v1/projects/${sa.project}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: { ...target, data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? '')])), android: { priority: 'HIGH', ttl: `${ttl}s` } } }),
        signal: AbortSignal.timeout(8000)
      })
      if (res.ok) return { ok: true }
      const text = await res.text().catch(() => '')
      const gone = res.status === 404 || (res.status === 400 && /INVALID_ARGUMENT/.test(text) && /registration token/i.test(text)) || /UNREGISTERED/.test(text)
      if (!gone) logger.error(`[fcm] kirim gagal ${res.status} ${text.slice(0, 160)}`)
      return { ok: false, gone }
    } catch (err) {
      logger.error(`[fcm] ${err?.message || err}`)
      return { ok: false, gone: false }
    }
  }

  return { enabled: true, send }
}
