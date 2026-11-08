/**
 * Kelengkapan data katalog (fungsi murni, tanpa I/O).
 *
 * Tiga lapis, urut dari yang paling bisa dipercaya:
 *   1. DATA ASLI   : hasil scrape detail (disimpan di koleksi `comic_catalog`), komik yang sama di sumber lain
 *                    (judul identik), dan metadata luar (lihat external-meta.js). Hanya MENGISI field yang kosong,
 *                    tidak pernah menimpa data yang sudah ada.
 *   2. TURUNAN     : nilai yang dihitung dari data yang sudah ada (status dari umur chapter terbaru, tahun rilis dari
 *                    chapter paling lama, sinopsis dari metadata, author <-> artist, views = views sumber + views Komikta).
 *                    Setiap field turunan dicatat di `derived`, dan TIDAK disimpan sebagai data asli: begitu sumber
 *                    sungguhan tersedia, nilai turunan otomatis tergantikan.
 *   3. TAMPILAN    : yang tetap kosong (mis. rating yang memang tidak dimiliki sumber mana pun) dibiarkan null; APK yang
 *                    menulis teks penggantinya ("Baru", "Tidak dicantumkan"). Tidak ada angka karangan.
 */
import { normGenres } from './normalize.js'

export const SOURCE_NAMES = { lumos: 'Lumos', manta: 'Manta', shinigami: 'Shinigami', voratoon: 'VoraToon' }
export const sourceName = id => SOURCE_NAMES[id] || (id ? String(id)[0].toUpperCase() + String(id).slice(1) : 'Komikta')

// Jenis bawaan per sumber bila jenis tidak terbaca dari mana pun. Manta = komik vertikal (webtoon).
const DEFAULT_TYPE = { manta: 'webtoon', shinigami: 'manhwa', lumos: 'manhwa', voratoon: 'manhwa' }
const TYPE_WORD = { manga: 'manga', manhwa: 'manhwa', manhua: 'manhua', webtoon: 'webtoon', novel: 'novel' }
const STATUS_PHRASE = { ongoing: 'masih berlangsung', completed: 'sudah tamat', hiatus: 'sedang hiatus', cancelled: 'dihentikan' }
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

export const DAY_MS = 86_400_000
/** Komik yang chapter terbarunya lebih tua dari ini dianggap hiatus kalau sumber tidak menyebut statusnya. */
export const HIATUS_AFTER_DAYS = 120

/* ───────────── dasar ───────────── */

/** Kunci pencocokan judul lintas sumber: huruf/angka saja, tanpa aksen dan huruf besar. */
export const normTitle = t =>
  String(t ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')

export const blank = v => (Array.isArray(v) ? v.length === 0 : typeof v === 'string' ? v.trim() === '' : v == null || (typeof v === 'number' && !(v > 0)))
const num = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
const ts = v => {
  const t = typeof v === 'number' ? v : Date.parse(String(v ?? ''))
  return Number.isFinite(t) && t > 0 ? t : null
}
const iso = t => (t ? new Date(t).toISOString() : '')

const UNIT_MS = [
  [/^(detik|dtk|sec|second)/, 1000],
  [/^(menit|mnt|min)/, 60_000],
  [/^(jam|hour|hr)/, 3_600_000],
  [/^(hari|day)/, DAY_MS],
  [/^(minggu|mgg|week|wk)/, 7 * DAY_MS],
  [/^(bulan|bln|month|mo)/, 30 * DAY_MS],
  [/^(tahun|thn|year|yr)/, 365 * DAY_MS]
]

/** "3 jam yang lalu" / "2 days ago" / ISO / epoch -> epoch ms (relatif dihitung dari `now`); null kalau tidak dikenali. */
export function parseWhen(v, now = Date.now()) {
  if (v == null || v === '') return null
  const s = String(v).trim().toLowerCase()
  if (/^(baru saja|just now|now|sekarang|barusan)$/.test(s)) return now
  if (/^(kemarin|yesterday)$/.test(s)) return now - DAY_MS
  const rel = /^(\d+|an?)\s*([a-z]+)\.?(?:\s+(?:yang\s+)?(?:lalu|ago))?$/.exec(s)
  if (rel) {
    const n = /^\d+$/.test(rel[1]) ? Number(rel[1]) : 1
    const unit = UNIT_MS.find(([re]) => re.test(rel[2]))
    return unit ? now - n * unit[1] : null
  }
  if (/^\d{9,13}$/.test(s)) return s.length <= 10 ? Number(s) * 1000 : Number(s)
  return ts(s)
}

export function fmtDate(t) {
  const d = new Date(t)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/* ───────────── rekaman katalog (data asli hasil scrape) ───────────── */

/** Rekaman katalog dari detail komik yang sudah dinormalisasi. Hanya data asli sumber, tidak ada nilai turunan. */
export function recordFromDetail(d, source, now = Date.now()) {
  const chapters = Array.isArray(d.chapters) ? d.chapters : []
  const head = chapters[0]
  const dated = chapters.map(c => ts(c.releaseDate)).filter(Boolean)
  const headWhen = head ? ts(head.releaseDate) ?? parseWhen(head.timeAgo, now) : null
  const first = dated.length ? Math.min(...dated) : null
  return {
    _id: `${source}|${d.slug}`,
    source,
    slug: d.slug,
    nt: normTitle(d.title),
    title: d.title || '',
    cover: d.cover || '',
    type: d.type || '',
    status: d.status || '',
    rating: num(d.rating),
    srcViews: num(d.views),
    genres: Array.isArray(d.genres) ? d.genres : [],
    author: d.author || '',
    artist: d.artist || '',
    year: d.year || '',
    firstYear: first ? String(new Date(first).getUTCFullYear()) : '',
    synopsis: d.synopsis || '',
    alt: Array.isArray(d.alt) ? d.alt : [],
    totalChapters: Number.isFinite(d.totalChapters) && d.totalChapters > 0 ? d.totalChapters : chapters.length || null,
    latest: head ? { slug: head.slug || '', number: head.number || '', title: head.title || '', releaseDate: iso(headWhen) } : null,
    syncedAt: now
  }
}

/** Kolom yang bisa diisi dari metadata luar / sibling. Urutan = urutan prioritas pengisian. */
export const FILLABLE = ['cover', 'type', 'status', 'rating', 'genres', 'author', 'artist', 'year', 'synopsis']

/** true kalau masih ada kolom penting yang kosong (alasan untuk mencari metadata luar). */
export const hasGaps = rec => FILLABLE.some(f => blank(rec[f]))

/** Isi kolom kosong `rec` dari `data` (hasil metadata luar). Mengembalikan daftar kolom yang terisi. */
export function mergeInto(rec, data, fields = FILLABLE) {
  const filled = []
  for (const f of fields) {
    if (!blank(rec[f]) || blank(data?.[f])) continue
    rec[f] = Array.isArray(data[f]) ? [...data[f]] : data[f]
    filled.push(f)
  }
  return filled
}

/* ───────────── isi data asli ke respons ───────────── */

const LIST_FILL = ['cover', 'type', 'status', 'rating', 'genres', 'author', 'artist', 'year']
const DETAIL_FILL = ['cover', 'type', 'status', 'rating', 'genres', 'author', 'artist', 'year', 'synopsis']

// Dua rekaman dianggap komik yang sama bila judulnya identik DAN jenisnya tidak saling bertentangan.
const FAMILY = { manga: 'jp', manhwa: 'kr', webtoon: 'kr', manhua: 'cn', novel: 'novel' }
export const sameWork = (a, b) => !!a && !!b && a._id !== b._id && a.nt && a.nt.length >= 4 && a.nt === b.nt && (!a.type || !b.type || FAMILY[a.type] === FAMILY[b.type] || a.type === 'webtoon' || b.type === 'webtoon')

function fillFields(out, rec, fields) {
  let changed = false
  // "webtoon" hanya nama format: jenis yang lebih tepat (manhwa/manhua/manga) dari rekaman menggantikannya
  if (out.type === 'webtoon' && rec.type && rec.type !== 'webtoon') {
    out.type = rec.type
    changed = true
  }
  for (const f of fields) {
    if (!blank(out[f]) || blank(rec[f])) continue
    out[f] = Array.isArray(rec[f]) ? [...rec[f]] : rec[f]
    changed = true
  }
  return changed
}

/** Chapter terbaru dari rekaman, dalam bentuk item `chapters[]` yang dikenal APK. */
function chapterOf(rec) {
  const l = rec?.latest
  if (!l || (!l.number && !l.title)) return null
  return { slug: l.slug || '', number: l.number || '', title: l.title || '', timeAgo: l.releaseDate || '', releaseDate: l.releaseDate || null, isNew: false }
}

/**
 * Item daftar: isi kolom kosong dari rekaman katalog, lalu dari komik yang sama di sumber lain (`siblings`).
 * Mengembalikan objek baru; data cache bersama tidak pernah diubah.
 */
export function fillItem(item, rec, siblings = []) {
  const out = { ...item }
  let changed = false
  for (const r of [rec, ...siblings]) {
    if (!r) continue
    changed = fillFields(out, r, LIST_FILL) || changed
    if (blank(out.views) && r.srcViews) {
      out.views = r.srcViews
      changed = true
    }
    if (blank(out.chapterCount) && r.totalChapters) {
      out.chapterCount = r.totalChapters
      changed = true
    }
  }
  const head = Array.isArray(out.chapters) ? out.chapters[0] : null
  const latest = chapterOf(rec)
  if (latest) {
    if (!head) {
      out.chapters = [latest]
      changed = true
    } else if (!head.timeAgo && (!head.number || head.number === latest.number)) {
      out.chapters = [{ ...head, number: head.number || latest.number, timeAgo: latest.timeAgo, releaseDate: head.releaseDate || latest.releaseDate }, ...out.chapters.slice(1)]
      changed = true
    }
  }
  return changed ? out : item
}

/** Detail komik: sama seperti fillItem, ditambah sinopsis dan judul lain. */
export function fillDetail(detail, rec, siblings = []) {
  const out = { ...detail }
  let changed = false
  for (const r of [rec, ...siblings]) {
    if (!r) continue
    changed = fillFields(out, r, DETAIL_FILL) || changed
    if (blank(out.views) && r.srcViews) {
      out.views = r.srcViews
      changed = true
    }
    if (blank(out.alt) && !blank(r.alt)) {
      out.alt = r.alt.filter(a => a !== out.title)
      changed = changed || out.alt.length > 0
    }
  }
  if (blank(out.year) && rec?.firstYear) {
    out.year = rec.firstYear
    out.derived = [...(out.derived || []), 'year']
    changed = true
  }
  return changed ? out : detail
}

/* ───────────── nilai turunan (tidak disimpan) ───────────── */

const list = items => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} dan ${items[items.length - 1]}`)

function updatedAt(o, now) {
  const head = Array.isArray(o.chapters) ? o.chapters[0] : null
  return head ? ts(head.releaseDate) ?? parseWhen(head.timeAgo, now) : null
}

/** Status dari umur chapter terbaru. Tidak ada tanggal sama sekali = anggap masih berjalan. */
export function inferStatus(o, now = Date.now()) {
  const t = updatedAt(o, now)
  return t && now - t > HIATUS_AFTER_DAYS * DAY_MS ? 'hiatus' : 'ongoing'
}

/** Sinopsis ringkas dari metadata yang ada (dipakai hanya kalau sumber tidak punya sinopsis). */
export function describe(d, source, now = Date.now()) {
  const word = TYPE_WORD[d.type] || 'komik'
  const genres = normGenres(d.genres).slice(0, 3)
  let s = `${d.title || 'Komik ini'} adalah ${word}${genres.length ? ` bergenre ${list(genres)}` : ''}`
  s += d.status && STATUS_PHRASE[d.status] ? ` yang ${STATUS_PHRASE[d.status]}.` : '.'
  if (d.author) s += ` Karya ${d.author}${d.artist && d.artist !== d.author ? `, ilustrasi oleh ${d.artist}` : ''}.`
  const n = d.totalChapters || (Array.isArray(d.chapters) ? d.chapters.length : 0) || d.chapterCount
  const when = updatedAt(d, now)
  if (n) s += ` Tersedia ${n} chapter di ${sourceName(source)}${when ? `, diperbarui terakhir ${fmtDate(when)}` : ''}.`
  return s
}

const mark = (out, field) => {
  out.derived = [...(out.derived || []), field]
}

function finalizeCommon(out, source, now) {
  if (blank(out.type)) {
    out.type = DEFAULT_TYPE[source] || 'manhwa'
    mark(out, 'type')
  }
  if (blank(out.status)) {
    out.status = inferStatus(out, now)
    mark(out, 'status')
  }
  if (blank(out.author) && !blank(out.artist)) {
    out.author = out.artist
    mark(out, 'author')
  }
  if (blank(out.artist) && !blank(out.author)) {
    out.artist = out.author
    mark(out, 'artist')
  }
  // views yang tampil = views dari sumber + views di aplikasi Komikta (`viewCount` dari database internal)
  const total = (num(out.viewCount) || 0) + (num(out.views) || 0)
  out.viewCount = total
  if (blank(out.chapterCount)) {
    const n = Array.isArray(out.chapters) ? out.chapters.length : 0
    if (n > 1) out.chapterCount = n
  }
}

export function finalizeItem(item, source, now = Date.now()) {
  if (!item || typeof item !== 'object' || !item.slug) return item
  const out = { ...item }
  finalizeCommon(out, item.source || source, now)
  return out
}

export function finalizeDetail(d, source, now = Date.now()) {
  if (!d || typeof d !== 'object') return d
  const out = { ...d }
  const src = d.source || source
  finalizeCommon(out, src, now)
  out.totalChapters = Math.max(out.totalChapters || 0, Array.isArray(out.chapters) ? out.chapters.length : 0)
  if (blank(out.synopsis)) {
    out.synopsis = describe(out, src, now)
    mark(out, 'synopsis')
  }
  return out
}

/** Kolom penting yang masih kosong setelah semua sumber data asli dicoba (untuk laporan status). */
export const missingOf = rec => FILLABLE.filter(f => blank(rec[f]))
