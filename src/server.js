import { createServer } from 'node:http'
import { loadConfig } from './config.js'
import { createApp } from './app.js'
import registry from './scrapers/index.js'

const config = loadConfig()
const app = createApp({ registry, config })

const server = createServer(app.handler)
// lebih panjang dari idle timeout load balancer (biasanya 60s) → hindari 502 acak
server.keepAliveTimeout = 65_000
server.headersTimeout = 66_000
server.requestTimeout = 30_000

server.listen(config.port, config.host, () => {
  console.log(`comic-api jalan di http://${config.host}:${config.port}  (sumber: ${registry.list().map(s => s.id).join(', ')})`)
  if (!config.apiKey) console.log('⚠️  API_KEY kosong — endpoint terbuka untuk umum')
})

function shutdown(signal) {
  console.log(`${signal} diterima, mematikan server...`)
  server.close(() => {
    app.close()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// jangan sampai satu scrape yang error mematikan seluruh server
process.on('unhandledRejection', err => console.error('unhandledRejection:', err))
process.on('uncaughtException', err => console.error('uncaughtException:', err))
