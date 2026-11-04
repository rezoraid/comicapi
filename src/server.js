import { createServer } from 'node:http'
import cluster from 'node:cluster'
import os from 'node:os'

try {
  process.loadEnvFile()
} catch {}

import { loadConfig } from './config.js'
import { createApp } from './app.js'
import registry from './scrapers/index.js'
import { createCommunity } from './community/index.js'

const config = loadConfig()

/**
 * Cluster mode (opt-in): set CLUSTER_WORKERS=auto atau angka.
 * Satu proses Node ≈ satu core; untuk ribuan concurrent user, jalankan beberapa worker
 * di belakang load balancer / reverse proxy yang sama (Mongo & cache per-worker).
 */
const workersEnv = process.env.CLUSTER_WORKERS || ''
const wantWorkers =
  workersEnv === 'auto' ? Math.min(4, Math.max(1, os.cpus().length)) : Math.max(0, parseInt(workersEnv, 10) || 0)

if (cluster.isPrimary && wantWorkers > 1) {
  console.log(`cluster primary: spawn ${wantWorkers} workers`)
  for (let i = 0; i < wantWorkers; i++) cluster.fork()
  cluster.on('exit', (worker, code, signal) => {
    console.error(`worker ${worker.process.pid} exit code=${code} signal=${signal}, respawn...`)
    cluster.fork()
  })
} else {
  await startWorker(config)
}

async function startWorker(config) {
  let community = null
  try {
    community = await createCommunity(config.community)
  } catch (err) {
    console.error('komunitas gagal start (MongoDB tidak terhubung?):', err?.message || err)
  }
  const app = createApp({ registry, config, community })

  const server = createServer({ keepAlive: true, noDelay: true }, app.handler)
  // lebih panjang dari idle timeout load balancer (biasanya 60s) → hindari 502 acak
  server.keepAliveTimeout = 65_000
  server.headersTimeout = 66_000
  server.requestTimeout = 30_000
  server.timeout = 30_000
  server.maxHeadersCount = 50
  // Batasi backlog socket agar spike traffic tidak menghabiskan FD
  server.maxConnections = Math.max(100, parseInt(process.env.MAX_CONNECTIONS || '2000', 10) || 2000)

  server.listen(config.port, config.host, () => {
    const tag = cluster.isWorker ? `worker ${process.pid}` : `pid ${process.pid}`
    console.log(`comic-api jalan di http://${config.host}:${config.port}  (${tag})  sumber: ${registry.list().map(s => s.id).join(', ')}`)
    console.log(community ? 'komunitas aktif (MongoDB terhubung)' : 'komunitas nonaktif')
    if (!config.apiKey) console.log('⚠️  API_KEY kosong — endpoint terbuka untuk umum')
  })

  function shutdown(signal) {
    console.log(`${signal} diterima, mematikan server...`)
    server.close(() => {
      app.close()
      Promise.resolve(community?.close()).finally(() => process.exit(0))
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  // jangan sampai satu scrape yang error mematikan seluruh server
  process.on('unhandledRejection', err => console.error('unhandledRejection:', err))
  process.on('uncaughtException', err => console.error('uncaughtException:', err))
}
