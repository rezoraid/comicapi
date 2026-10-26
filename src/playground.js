import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

/**
 * GET /playground — halaman tes API (1 file HTML, tanpa library).
 * Dibaca & di-gzip sekali saat boot, jadi tiap request cuma kirim buffer.
 * Nonaktifkan di production dengan env PLAYGROUND=false.
 */
export function playground() {
  const html = readFileSync(new URL('./public/playground.html', import.meta.url))
  const gz = gzipSync(html)
  const etag = `"${createHash('md5').update(html).digest('base64url').slice(0, 22)}"`
  const base = {
    'content-type': 'text/html; charset=utf-8',
    etag,
    'cache-control': 'no-cache',
    vary: 'Accept-Encoding',
    'content-security-policy':
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; connect-src *; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer'
  }

  return ({ req, res }) => {
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, base)
      return res.end()
    }
    const useGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '')
    const out = useGzip ? gz : html
    res.writeHead(200, { ...base, ...(useGzip && { 'content-encoding': 'gzip' }), 'content-length': out.length })
    res.end(req.method === 'HEAD' ? undefined : out)
  }
}
