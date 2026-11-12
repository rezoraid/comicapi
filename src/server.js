import { createServer } from 'node:http'

try {
  process.loadEnvFile()
} catch {}

import { loadConfig } from './config.js'
import { createApp } from './app.js'
import { RedisRestCache } from './lib/redis-rest-cache.js'
import registry from './scrapers/index.js'
import { startCommunity } from './community/lifecycle.js'
import { createCatalog } from './catalog-sync.js'
import { createExternalMeta } from './external-meta.js'

const config = loadConfig()

const sharedCache = new RedisRestCache({ url: config.redisRestUrl, token: config.redisRestToken, prefix: config.redisKeyPrefix, timeoutMs: config.redisTimeoutMs })
const community = startCommunity(config.community, { sharedCache })
const { enabled: catalogEnabled, metaEnrich, ...catalogOpts } = config.catalog
const catalog = catalogEnabled
  ? createCatalog({ registry, collection: () => community.get()?.c?.catalog ?? null, external: createExternalMeta({ enabled: metaEnrich }), ...catalogOpts })
  : null
const app = createApp({ registry, config, community: community.get, sharedCache, catalog })

const server = createServer(app.handler)

server.keepAliveTimeout = 65_000
server.headersTimeout = 66_000
server.requestTimeout = 30_000

server.listen(config.port, config.host, () => {
  console.log(`comic-api jalan di http://${config.host}:${config.port}  (sumber: ${registry.list().map(s => s.id).join(', ')})`)
  if (!config.apiKey) console.log('⚠️  API_KEY kosong — endpoint terbuka untuk umum')
  app.startWarmer()
  catalog?.startCrawler()
})

function shutdown(signal) {
  console.log(`${signal} diterima, mematikan server...`)
  server.close(() => {
    app.close()
    catalog?.close()
    community.stop().catch(() => {}).finally(() => process.exit(0))
  })
  server.closeIdleConnections?.()
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

process.on('unhandledRejection', err => console.error('unhandledRejection:', err))
process.on('uncaughtException', err => console.error('uncaughtException:', err))
