// Isi dengan host sumber yang butuh relay, mis. 'contoh-komik.com'
const ALLOWED = []

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const allowed = host => ALLOWED.some(h => host === h || host.endsWith('.' + h))

export default {
  async fetch(request, env) {
    const params = new URL(request.url).searchParams
    if (env.KEY && params.get('key') !== env.KEY) return new Response('forbidden', { status: 403 })

    let target
    try {
      target = new URL(params.get('url'))
    } catch {
      return new Response('url tidak valid', { status: 400 })
    }
    if (target.protocol !== 'https:' || !allowed(target.hostname)) {
      return new Response('host tidak diizinkan', { status: 403 })
    }

    const upstream = await fetch(target, {
      headers: {
        'user-agent': UA,
        accept: request.headers.get('accept') || '*/*',
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        referer: target.origin + '/'
      },
      redirect: 'follow'
    })

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') || 'text/plain' }
    })
  }
}
