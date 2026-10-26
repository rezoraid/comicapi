import dns from 'node:dns/promises'
import net from 'node:net'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { badRequest, HttpError } from './lib/errors.js'

const MAX_BYTES = 25 * 1024 * 1024
const MAX_REDIRECTS = 3
const TIMEOUT_MS = 20_000

/**
 * GET /api/image?url=<url gambar>
 * Menambahkan referer/header yang dibutuhkan situs sumber, jadi APK bisa
 * menampilkan gambar tanpa kena hotlink-protection. Hanya host milik
 * scraper yang diizinkan (anti-SSRF), redirect divalidasi ulang.
 */
export function imageProxy(registry) {
  return async ({ req, res, query }) => {
    const raw = query.get('url')
    if (!raw) throw badRequest('Parameter "url" wajib diisi')

    const ac = new AbortController()
    res.on('close', () => !res.writableEnded && ac.abort())
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)

    let target
    let provider
    let upstream
    try {
      target = parse(raw)
      for (let hop = 0; ; hop++) {
        const known = registry.findByImageHost(target.hostname)
        if (hop === 0) {
          provider = known
          if (!provider) throw new HttpError(403, 'FORBIDDEN_HOST', `Host gambar tidak diizinkan: ${target.hostname}`)
        } else if (!known && !(await isPublicHost(target.hostname))) {
          // redirect dari host sumber ke CDN lain boleh, asal bukan alamat internal
          throw new HttpError(403, 'FORBIDDEN_HOST', `Redirect ke host tidak diizinkan: ${target.hostname}`)
        }

        upstream = await fetch(target, { headers: (known || provider).imageHeaders, signal: ac.signal, redirect: 'manual' })
        if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
          if (hop >= MAX_REDIRECTS) throw new HttpError(502, 'SOURCE_ERROR', 'Terlalu banyak redirect')
          target = parse(new URL(upstream.headers.get('location'), target).href)
          upstream.body?.cancel()
          continue
        }
        break
      }
    } finally {
      clearTimeout(timer)
    }

    if (!upstream.ok) {
      upstream.body?.cancel()
      throw new HttpError(upstream.status === 404 ? 404 : 502, 'SOURCE_ERROR', `Gambar gagal diambil (HTTP ${upstream.status})`)
    }
    const type = upstream.headers.get('content-type') || ''
    if (!type.startsWith('image/')) {
      upstream.body?.cancel()
      throw new HttpError(502, 'SOURCE_ERROR', 'Sumber tidak mengembalikan gambar')
    }
    const length = Number(upstream.headers.get('content-length')) || 0
    if (length > MAX_BYTES) {
      upstream.body?.cancel()
      throw new HttpError(413, 'TOO_LARGE', 'Gambar terlalu besar')
    }

    const headers = {
      'content-type': type,
      'cache-control': 'public, max-age=604800, immutable',
      'x-content-type-options': 'nosniff'
    }
    // content-length hanya valid kalau upstream tidak di-compress
    if (length && !upstream.headers.get('content-encoding')) headers['content-length'] = length
    res.writeHead(200, headers)

    if (req.method === 'HEAD') {
      upstream.body?.cancel()
      return res.end()
    }
    try {
      await pipeline(Readable.fromWeb(upstream.body), res)
    } catch {
      res.destroy() // klien putus / upstream error di tengah stream
    }
  }
}

function parse(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    throw badRequest('URL gambar tidak valid')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw badRequest('URL gambar tidak valid')
  return u
}

/** true kalau hostname me-resolve ke alamat publik saja (anti-SSRF untuk redirect). */
async function isPublicHost(hostname) {
  try {
    const ips = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true })
    return ips.length > 0 && ips.every(a => isPublicIp(a.address))
  } catch {
    return false
  }
}

function isPublicIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    return !(
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    )
  }
  const v = ip.toLowerCase()
  if (v.startsWith('::ffff:')) return isPublicIp(v.slice(7))
  return !(v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb'))
}
