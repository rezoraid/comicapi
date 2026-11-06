import dns from 'node:dns/promises'
import net from 'node:net'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { badRequest, HttpError } from './lib/errors.js'

const MAX_BYTES = 25 * 1024 * 1024
const MAX_REDIRECTS = 3
const CACHE_ITEM_MAX = 1_500_000 // gambar > 1,5 MB tetap di-stream tanpa disimpan

/** LRU berbasis total byte untuk gambar kecil/sedang (halaman chapter yang sering dibuka banyak orang). */
const sniff = b =>
  b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b.length > 11 && b.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : null

function createImageCache(maxMb) {
  const maxBytes = Math.max(0, maxMb) * 1024 * 1024
  const map = new Map()
  let bytes = 0
  return {
    enabled: maxBytes > 0,
    get(key) {
      const e = map.get(key)
      if (!e) return null
      map.delete(key)
      map.set(key, e) // segarkan urutan LRU
      return e
    },
    set(key, entry) {
      if (!maxBytes || entry.buf.length > Math.min(CACHE_ITEM_MAX, maxBytes)) return
      const old = map.get(key)
      if (old) bytes -= old.buf.length
      map.set(key, entry)
      bytes += entry.buf.length
      while (bytes > maxBytes) {
        const [k, v] = map.entries().next().value
        map.delete(k)
        bytes -= v.buf.length
      }
    },
    get size() {
      return map.size
    }
  }
}

/**
 * GET /api/image?url=<url gambar>
 * Menambahkan referer/header yang dibutuhkan situs sumber, jadi APK bisa
 * menampilkan gambar tanpa kena hotlink-protection. Hanya host milik
 * scraper yang diizinkan (anti-SSRF), redirect divalidasi ulang.
 */
export function imageProxy(registry, { cacheMb = 48, headerTimeoutMs = 12_000, bodyIdleMs = 15_000, retries = 1 } = {}) {
  // headerTimeoutMs: tunggu sumber mulai merespons (per percobaan) · bodyIdleMs: batas diam saat unduh (reset tiap ada data)
  // retries: ulang kalau sumber timeout / koneksi putus (batal dari klien tidak pernah diulang)
  const HEADER_TIMEOUT_MS = headerTimeoutMs
  const BODY_IDLE_MS = bodyIdleMs
  const FETCH_RETRIES = retries
  const cache = createImageCache(cacheMb)
  return async ({ req, res, query }) => {
    const raw = query.get('url')
    if (!raw) throw badRequest('Parameter "url" wajib diisi')

    // clientGone = klien (APK) membatalkan request, mis. pindah chapter / scroll cepat. Itu bukan error server.
    // timedOut  = sumber gambar yang terlalu lambat.
    let ac = new AbortController()
    let timer = null
    let clientGone = false
    let timedOut = false
    const clearTimer = () => clearTimeout(timer)
    const arm = ms => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        ac.abort()
      }, ms)
    }
    res.on('close', () => {
      if (!res.writableEnded) {
        clientGone = true
        ac.abort()
      }
      clearTimer()
    })

    /** fetch ke sumber dengan timeout per percobaan + 1x ulang. Batal dari klien tidak diulang. */
    const fetchSource = async (url, headers) => {
      for (let attempt = 0; ; attempt++) {
        if (clientGone) throw new Error('client closed')
        ac = new AbortController()
        timedOut = false
        arm(HEADER_TIMEOUT_MS)
        try {
          return await fetch(url, { headers, signal: ac.signal, redirect: 'manual' })
        } catch (err) {
          clearTimer()
          if (clientGone || attempt >= FETCH_RETRIES) {
            if (timedOut && !clientGone) throw new HttpError(504, 'SOURCE_TIMEOUT', `Sumber gambar terlalu lama merespons (${url.hostname})`)
            throw err
          }
        }
      }
    }

    let target
    let provider
    let upstream
    let prep = null
    let firstHref
    try {
      target = parse(raw)
      firstHref = target.href
      // cache hanya dilayani untuk host yang diizinkan (aturan anti-SSRF tetap berlaku sebelum cache)
      const cached = cache.enabled && registry.findByImageHost(target.hostname) ? cache.get(target.href) : null
      if (cached) {
        clearTimer()
        res.writeHead(200, { 'content-type': cached.type, 'cache-control': 'public, max-age=604800, immutable', 'x-content-type-options': 'nosniff', 'content-length': cached.buf.length, 'x-cache': 'HIT' })
        return res.end(req.method === 'HEAD' ? undefined : cached.buf)
      }
      for (let hop = 0; ; hop++) {
        const known = registry.findByImageHost(target.hostname)
        if (hop === 0) {
          provider = known
          if (!provider) throw new HttpError(403, 'FORBIDDEN_HOST', `Host gambar tidak diizinkan: ${target.hostname}`)
          prep = provider.imagePrep?.(target) ?? null
        } else if (!known && !(await isPublicHost(target.hostname))) {
          // redirect dari host sumber ke CDN lain boleh, asal bukan alamat internal
          throw new HttpError(403, 'FORBIDDEN_HOST', `Redirect ke host tidak diizinkan: ${target.hostname}`)
        }

        const baseHeaders = (known || provider).imageHeaders
        upstream = await fetchSource(target, hop === 0 && prep ? { ...baseHeaders, ...prep.headers } : baseHeaders)
        if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
          if (hop >= MAX_REDIRECTS) throw new HttpError(502, 'SOURCE_ERROR', 'Terlalu banyak redirect')
          target = parse(new URL(upstream.headers.get('location'), target).href)
          upstream.body?.cancel()
          continue
        }
        break
      }
    } catch (error) {
      clearTimer()
      if (clientGone) return res.destroy() // klien sudah pergi: jangan dicatat sebagai error
      throw error
    }

    if (!upstream.ok) {
      clearTimer()
      upstream.body?.cancel()
      throw new HttpError(upstream.status === 404 ? 404 : 502, 'SOURCE_ERROR', `Gambar gagal diambil (HTTP ${upstream.status})`)
    }
    let type = upstream.headers.get('content-type') || ''
    if (!prep?.decode && !type.startsWith('image/')) {
      clearTimer()
      upstream.body?.cancel()
      throw new HttpError(502, 'SOURCE_ERROR', 'Sumber tidak mengembalikan gambar')
    }
    const length = Number(upstream.headers.get('content-length')) || 0
    if (length > MAX_BYTES) {
      clearTimer()
      upstream.body?.cancel()
      throw new HttpError(413, 'TOO_LARGE', 'Gambar terlalu besar')
    }

    arm(BODY_IDLE_MS) // header sudah diterima: sekarang batasi waktu unduh body
    if (prep?.decode) {
      try {
        if (req.method === 'HEAD') {
          upstream.body?.cancel()
          res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=604800, immutable' })
          return res.end()
        }
        const enc = Buffer.from(await upstream.arrayBuffer())
        if (enc.length > MAX_BYTES) throw new HttpError(413, 'TOO_LARGE', 'Gambar terlalu besar')
        const buf = prep.decode(enc)
        type = sniff(buf)
        if (!type) throw new HttpError(502, 'SOURCE_ERROR', 'Gambar gagal didekripsi')
        cache.set(firstHref, { type, buf })
        res.writeHead(200, { 'content-type': type, 'cache-control': 'public, max-age=604800, immutable', 'x-content-type-options': 'nosniff', 'content-length': buf.length })
        return res.end(buf)
      } catch (error) {
        if (clientGone) return res.destroy()
        if (timedOut) throw new HttpError(504, 'SOURCE_TIMEOUT', `Unduhan gambar terlalu lama (${target.hostname})`)
        throw error
      } finally {
        clearTimer()
      }
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
      clearTimer()
      upstream.body?.cancel()
      return res.end()
    }

    // Batasi ukuran aktual juga: Content-Length dari upstream bisa tidak ada atau tidak jujur.
    let received = 0
    // salin ke memori hanya selama masih di bawah batas item cache; disimpan setelah seluruh body sukses terkirim
    let keep = cache.enabled && length <= CACHE_ITEM_MAX ? [] : null
    const sizeGuard = new Transform({
      transform(chunk, _encoding, callback) {
        arm(BODY_IDLE_MS)
        received += chunk.length
        if (received > MAX_BYTES) {
          ac.abort()
          callback(new Error('Gambar melebihi batas ukuran'))
          return
        }
        if (keep) {
          if (received > CACHE_ITEM_MAX) keep = null
          else keep.push(chunk)
        }
        callback(null, chunk)
      }
    })
    try {
      await pipeline(Readable.fromWeb(upstream.body), sizeGuard, res)
      if (keep && received > 0 && (!length || length === received || upstream.headers.get('content-encoding'))) cache.set(firstHref, { type, buf: Buffer.concat(keep) })
    } catch {
      res.destroy() // klien putus, timeout, atau upstream melewati batas ukuran
    } finally {
      clearTimer()
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
