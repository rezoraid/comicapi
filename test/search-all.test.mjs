import test from 'node:test'
import assert from 'node:assert/strict'
import { searchProviders } from '../src/scrapers/index.js'

const prov = (id, ms, fail = false) => ({
  id,
  search: () =>
    new Promise((resolve, reject) =>
      setTimeout(() => (fail ? reject(new Error('x')) : resolve([{ title: id, slug: id }])), ms)
    )
})

test('searchAll: tidak menunggu sumber lambat setelah masa tenggang', async () => {
  const t = Date.now()
  const out = await searchProviders([prov('cepat', 10), prov('lambat', 2000)], 'q', { graceMs: 100, timeoutMs: 5000 })
  assert.ok(Date.now() - t < 800, 'harus selesai jauh sebelum sumber lambat')
  assert.deepEqual(out.items.map(i => i.source), ['cepat'])
  assert.deepEqual(out.failed, ['lambat'])
})

test('searchAll: semua sumber cepat tetap lengkap, urutan interleave, gagal tercatat', async () => {
  const out = await searchProviders([prov('a', 5), prov('b', 20), prov('c', 5, true)], 'q', { graceMs: 500 })
  assert.deepEqual(out.items.map(i => i.source), ['a', 'b'])
  assert.deepEqual(out.failed, ['c'])
})

test('searchAll: semua gagal → items kosong, tanpa menggantung', async () => {
  const out = await searchProviders([prov('a', 5, true), prov('b', 5, true)], 'q')
  assert.deepEqual(out.items, [])
  assert.deepEqual(out.failed, ['a', 'b'])
})
