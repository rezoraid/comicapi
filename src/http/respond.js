import { gzip as gzipCb } from 'node:zlib'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'

const gzip = promisify(gzipCb)

/** Serialisasi sekali (+ gzip + ETag) lalu simpan di cache → request berikutnya nol kerja. */
export async function encode(payload) {
  const body = Buffer.from(JSON.stringify(payload))
  const etag = `"${createHash('md5').update(body).digest('base64url').slice(0, 22)}"`
  const gzipped = body.length > 1024 ? await gzip(body) : null
  return { body, gzipped, etag }
}

export function send(req, res, entry, { status = 200, cacheSeconds = 0, cacheState } = {}) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    etag: entry.etag,
    vary: 'Accept-Encoding',
    'cache-control': cacheSeconds ? `public, max-age=${cacheSeconds}` : 'no-store'
  }
  if (cacheState) headers['x-cache'] = cacheState

  if (status === 200 && req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, headers)
    return res.end()
  }

  const useGzip = entry.gzipped && /\bgzip\b/.test(req.headers['accept-encoding'] || '')
  const out = useGzip ? entry.gzipped : entry.body
  if (useGzip) headers['content-encoding'] = 'gzip'
  headers['content-length'] = out.length

  res.writeHead(status, headers)
  res.end(req.method === 'HEAD' ? undefined : out)
}

export async function sendError(req, res, httpError) {
  const entry = await encode({ ok: false, error: { code: httpError.code, message: httpError.message } })
  send(req, res, entry, { status: httpError.status })
}
