import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

try {
  process.loadEnvFile()
} catch {}

const args = process.argv.slice(2)
const uri = process.env.MONGODB_URI
const SYSTEM = new Set(['admin', 'local', 'config'])

if (!uri) {
  console.error('MONGODB_URI belum diisi (env atau file .env)')
  process.exit(1)
}
if (process.env.NODE_ENV === 'production' && !args.includes('--force')) {
  console.error('NODE_ENV=production. Tambahkan --force jika benar-benar yakin.')
  process.exit(1)
}

const { MongoClient } = await import('mongodb')
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 })

const confirm = async () => {
  if (args.includes('--yes')) return true
  const rl = readline.createInterface({ input, output })
  try {
    return (await rl.question('Semua database di atas akan dihapus permanen. Ketik HAPUS SEMUA untuk melanjutkan: ')).trim() === 'HAPUS SEMUA'
  } finally {
    rl.close()
  }
}

try {
  await client.connect()
  const admin = client.db().admin()
  const dbs = (await admin.listDatabases({ nameOnly: true })).databases.map(d => d.name).filter(n => !SYSTEM.has(n))
  if (!dbs.length) {
    console.log('Tidak ada database yang perlu dihapus.')
  } else {
    console.log(`Cluster: ${new URL(uri.replace('mongodb+srv://', 'https://')).hostname}`)
    for (const n of dbs) {
      const cols = await client.db(n).listCollections({}, { nameOnly: true }).toArray()
      console.log(`  ${n}: ${cols.length} koleksi${cols.length ? ` (${cols.map(c => c.name).join(', ')})` : ''}`)
    }
    if (!(await confirm())) {
      console.log('Dibatalkan.')
    } else {
      for (const n of dbs) {
        await client.db(n).dropDatabase()
        console.log(`Dihapus: ${n}`)
      }
      const left = (await admin.listDatabases({ nameOnly: true })).databases.map(d => d.name).filter(n => !SYSTEM.has(n))
      console.log(left.length ? `Masih tersisa: ${left.join(', ')}` : 'Semua database bersih. Restart server Komikta supaya index dibuat ulang.')
    }
  }
} catch (e) {
  console.error('Reset gagal:', e.message)
  process.exitCode = 1
} finally {
  await client.close()
}
