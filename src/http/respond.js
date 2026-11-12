import { gzip as gzipCb } from 'node:zlib'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'

const gzip = promisify(gzipCb)

export async function encode(payload, { gzip: wantGzip = true, level = 6 } = {}) {
  const body = Buffer.from(JSON.stringify(payload))
  const etag = `"${createHash('md5').update(body).digest('base64url').slice(0, 22)}"`
  const gzipped = wantGzip && body.length > 1024 ? await gzip(body, { level }) : null
  return { body, gzipped, etag }
}

export const acceptsGzip = req => /\bgzip\b/.test(req.headers['accept-encoding'] || '')

export function etagMatches(header, etag) {
  if (!header) return false
  if (header === '*') return true
  return header.split(',').some(t => t.trim().replace(/^W\//, '') === etag)
}

export function send(req, res, entry, { status = 200, cacheSeconds = 0, cacheState, revalidate = false } = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    etag: entry.etag,
    vary: revalidate ? 'Accept-Encoding, Authorization' : 'Accept-Encoding',
    'cache-control': cacheSeconds ? `public, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds}` : revalidate ? 'private, no-cache' : 'no-store'
  }
  if (cacheState) headers['x-cache'] = cacheState
  if (status === 200 && etagMatches(req.headers['if-none-match'], entry.etag)) {
    res.writeHead(304, headers)
    return res.end()
  }
  const useGzip = entry.gzipped && acceptsGzip(req)
  const out = useGzip ? entry.gzipped : entry.body
  if (useGzip) headers['content-encoding'] = 'gzip'
  headers['content-length'] = out.length
  res.writeHead(status, headers)
  res.end(req.method === 'HEAD' ? undefined : out)
}

export async function sendError(req, res, httpError) {
  const entry = await encode({ ok: false, error: { code: httpError.code, message: httpError.message } }, { gzip: false })
  send(req, res, entry, { status: httpError.status })
}
