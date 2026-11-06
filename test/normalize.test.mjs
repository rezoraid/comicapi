import test from 'node:test'
import assert from 'node:assert/strict'
import { canonStatus, canonType, normGenres, normRating, normViews, normalizeDetail, normalizeItem } from '../src/normalize.js'

test('type: berbagai tulisan sumber -> satu nilai baku', () => {
  for (const [raw, want] of [['Manhwa', 'manhwa'], ['MANHUA', 'manhua'], ['manga', 'manga'], ['Korean Webtoon', 'webtoon'], ['Light Novel', 'novel'], ['', ''], ['komik', '']]) {
    assert.equal(canonType(raw), want, raw)
  }
  assert.equal(canonType('', ['Action', 'Manhua']), 'manhua') // jenis hanya ada di tag
})

test('status: berbagai tulisan sumber -> satu nilai baku', () => {
  for (const [raw, want] of [
    ['Ongoing', 'ongoing'], ['ONGOING', 'ongoing'], ['Berjalan', 'ongoing'], ['Publishing', 'ongoing'],
    ['Completed', 'completed'], ['Tamat', 'completed'], ['Finished', 'completed'], ['On Hiatus', 'hiatus'],
    ['Cancelled', 'cancelled'], ['', ''], ['entah', '']
  ]) assert.equal(canonStatus(raw), want, raw)
})

test('genre: rapi, tanpa duplikat, huruf judul', () => {
  assert.deepEqual(normGenres(['action', 'ACTION', ' slice of life ', 'Sci-Fi', 'romance', { name: 'drama' }, '']), ['Action', 'Slice of Life', 'Sci-Fi', 'Romance', 'Drama'])
  assert.deepEqual(normGenres(undefined), [])
})

test('rating & views', () => {
  assert.equal(normRating(8.54), 8.5)
  assert.equal(normRating('9,1'), 9.1)
  assert.equal(normRating(85), 8.5)
  assert.equal(normRating(0), null)
  assert.equal(normRating(null), null)
  assert.equal(normViews('18.664.676'), 18664676)
  assert.equal(normViews('1.2M'), 1200000)
  assert.equal(normViews(0), null)
  assert.equal(normViews(null), null)
})

test('item dari sumber berbeda punya kolom baku yang sama', () => {
  const lumos = normalizeItem({ title: ' Solo  Leveling ', slug: 'solo', type: 'Manhwa', status: 'Ongoing', genres: ['action', 'fantasy'], rating: '8.1', chapters: [{ slug: 'c1', number: '200', timeAgo: '1 hour ago' }] }, 'lumos')
  const shini = normalizeItem({ title: 'Berserk', slug: 'b', type: 'Manga', status: 'completed', rating: 87, genres: ['Action'], views: '1.2M' }, 'shinigami')
  const manta = normalizeItem({ title: 'X', slug: 'x', type: '', status: '', genres: ['Manhwa', 'drama'], author: 'Updating' }, 'manta')
  const plus = normalizeItem({ title: 'One Piece', slug: '100020', type: 'manga', status: 'ongoing', genres: ['Action'], author: 'Eiichiro Oda' }, 'mangaplus')
  const core = ['title', 'slug', 'url', 'cover', 'type', 'status', 'rating', 'chapterCount', 'genres', 'author', 'views', 'chapters', 'source']
  for (const it of [lumos, shini, manta, plus]) for (const k of core) assert.ok(k in it, `${it.source} kehilangan ${k}`)
  assert.deepEqual([lumos.title, lumos.type, lumos.status, lumos.genres, lumos.rating, lumos.source], ['Solo Leveling', 'manhwa', 'ongoing', ['Action', 'Fantasy'], 8.1, 'lumos'])
  assert.deepEqual([shini.type, shini.status, shini.rating, shini.views], ['manga', 'completed', 8.7, 1200000])
  assert.deepEqual([manta.type, manta.status, manta.author], ['manhwa', '', ''])
  assert.deepEqual([plus.type, plus.status, plus.author, plus.rating, plus.views], ['manga', 'ongoing', 'Eiichiro Oda', null, null])
})

test('detail: kolom baku selalu ada walau sumber tidak punya datanya', () => {
  const d = normalizeDetail({ title: 'One Piece', slug: '1', status: 'Ongoing', type: 'manga', genres: ['action'], chapters: [{ slug: 'a', number: '1' }, { slug: 'b', number: '2' }], artist: 'N/A', year: 'abc', alt: ['One Piece', 'ワンピース'] }, 'mangaplus')
  assert.deepEqual([d.artist, d.year, d.rating, d.views, d.totalChapters, d.alt, d.genres, d.status, d.source], ['', '', null, null, 2, ['ワンピース'], ['Action'], 'ongoing', 'mangaplus'])
  assert.equal(d.chapters[0].timeAgo, '')
  assert.equal(d.chapters[0].releaseDate, null)
})
