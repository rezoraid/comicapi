export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export const badRequest = msg => new HttpError(400, 'BAD_REQUEST', msg)
export const notFound = msg => new HttpError(404, 'NOT_FOUND', msg)

/** Ubah error apa pun (termasuk dari scraper) jadi HttpError yang aman dikirim ke klien. */
export function toHttpError(err) {
  if (err instanceof HttpError) return err
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new HttpError(504, 'SOURCE_TIMEOUT', 'Sumber terlalu lama merespons')
  }
  if (err?.status === 404) return new HttpError(404, 'NOT_FOUND', 'Data tidak ditemukan di sumber')
  const http = /^HTTP \d{3}$/.test(err?.message || '') ? err.message : ''
  const net = /^[A-Z_]{3,30}$/.test(err?.cause?.code || '') ? err.cause.code : ''
  const reason = [http, net].filter(Boolean).join(' ')
  return new HttpError(502, 'SOURCE_ERROR', reason ? `Gagal mengambil data dari sumber (${reason})` : 'Gagal mengambil data dari sumber')
}
