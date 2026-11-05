# Optimasi backend Komikta

Tidak ada endpoint, bentuk respons, struktur koleksi, maupun perilaku yang dihapus/diubah untuk APK.
79 tes lama yang bisa dijalankan tanpa jaringan lolos tanpa diubah (`fake-mongo.mjs` hanya diperluas), ditambah 28 tes baru (`test/perf.test.mjs`). Dua tes lama yang memuat scraper (`lumos.test.mjs`, "registry asli") butuh `npm install` (cheerio) dan belum sempat dijalankan; kode scraper tidak disentuh.

## Yang berubah

### MongoDB
| Masalah | Perbaikan |
|---|---|
| Setiap request terautentikasi, daftar komentar, profil, dan panel admin membaca dokumen user **termasuk foto profil base64 (hingga ±400 KB)** | Semua pembacaan user memakai proyeksi `{customPicture: 0}`. Status foto kini dibaca dari flag `hasAvatar` (diisi otomatis untuk dokumen lama saat start, lewat satu `updateMany`). Foto hanya dibaca oleh `GET /users/:id/avatar`. |
| `/me` menarik **semua** event XP ke Node lalu menjumlahkan | `aggregate $group/$sum` di database, dilayani indeks baru `{userId, reversed, xp}` |
| `$inc` XP lalu `findOne` terpisah (2 round-trip) | `findOneAndUpdate` returnDocument:after (1 round-trip) |
| Riwayat baca: 1 `COUNT` per baris (hingga 30) | 1 `aggregate` untuk semua baris |
| Hitungan komentar per chapter menarik semua dokumen komentar | `aggregate $group` |
| `trackReadingTime`: `updateOne` + `findOne` | `findOneAndUpdate` upsert, 1 round-trip |
| `me`, profil, `hydrate` komentar: query saling lepas dijalankan berurutan | `Promise.all` |
| Indeks kurang | `users.createdAt/lastLoginAt/publicNo/banned`, `comments {deleted,createdAt}` + partial `reportCount`, `xp_events {userId,reversed,xp}`. Indeks lama tidak diubah. |
| Satu indeks gagal (data lama duplikat) mematikan komunitas | Dicatat ke log, komunitas tetap jalan |
| Pool koneksi default | `maxPoolSize` 30, `minPoolSize` 2, timeout socket/connect/antre, `maxIdleTimeMS` (env `MONGO_POOL_MAX`, `MONGO_POOL_MIN`) |

### Caching
- **Cache respons scraper: stale-while-revalidate.** Entri yang baru kedaluwarsa langsung disajikan (`x-cache: STALE`), data baru diambil di background (satu refresh per key, jeda 15 dtk kalau sumber gagal). Sebelumnya pengguna menunggu seluruh scrape (bisa beberapa detik). Usia data maksimum ≈ 2× TTL (latest ≤ 2 menit, detail ≤ 10 menit). Stale-if-error 6 jam tetap ada.
- Cache dibatasi **total byte** (`CACHE_MAX_MB`, default 96) selain jumlah entri → tidak OOM oleh payload besar.
- Cache angka murah (per proses, TTL 5–15 dtk, dibuang saat ada penulisan di instance yang sama): jumlah chapter dibaca, jumlah like, total komentar, hitungan per chapter.
- JWKS Google: fetch serentak digabung; kalau Google tak terjangkau, kunci lama tetap dipakai (login tidak ikut mati).

### Background / non-blocking
- **Progres baca ditulis belakangan** (`PROGRESS_FLUSH_MS`, default 1000 ms; `0` = tulis langsung seperti dulu): `PUT /me/reading-progress` dan akumulasi detik di `PUT /me/reading-time` langsung dijawab, perubahan pada komik yang sama digabung jadi satu tulis. Riwayat milik sendiri tetap langsung terbaca (antrean dikuras sebelum dibaca), antrean dikuras saat shutdown, dan dibuang saat hapus akun. Penghitungan chapter/XP tetap sinkron dan akurat.
- **MongoDB disambung di background dengan retry** (2 dtk → 60 dtk). Server HTTP & `/health` siap seketika; sebelumnya kalau MongoDB gagal saat boot, komunitas mati permanen sampai redeploy.
- Respons dinamis hanya di-gzip kalau klien meminta (level 4); respons ber-cache di-gzip sekali (level 6).

### Stabilitas & keamanan
- Rate limiter dibatasi jumlah kuncinya (anti banjir IP palsu → memori).
- `If-None-Match` mendukung beberapa ETag, `W/`, dan `*`.
- Log request: default hanya status ≥ 400 atau lambat (≥ `SLOW_REQUEST_MS`, 1000). Log stdout sinkron di Linux sehingga mencatat semua request membebani server saat ramai. Set `LOG_REQUESTS=true` untuk kembali mencatat semuanya, `false` untuk mati.
- `UV_THREADPOOL_SIZE=16` (Dockerfile & Procfile): gzip dan DNS berbagi 4 thread default.
- `server.closeIdleConnections()` saat shutdown.

## Variabel env baru (semua opsional)
`CACHE_MAX_MB` (96) · `SLOW_REQUEST_MS` (1000) · `LOG_REQUESTS` (`true`/`false`/default error+lambat) · `MONGO_POOL_MAX` (30) · `MONGO_POOL_MIN` (2) · `PROGRESS_FLUSH_MS` (1000)

## Perlu diketahui
- Perlu MongoDB yang mendukung `aggregate` biasa (semua versi modern, termasuk Atlas M0). Tidak ada fitur yang butuh versi khusus.
- Cache angka & antrean progres bersifat per instance. Dengan beberapa replika Railway, angka seperti jumlah like bisa tertinggal ≤ 5–10 dtk di instance lain; data di database tetap benar.
- Rate limiter tetap in-memory per instance (perilaku lama). Untuk replika > 1, batas efektif = batas × jumlah replika.
- Scraper (`src/scrapers/*`) tidak diubah.

## Belum dikerjakan (butuh keputusan/uji di lingkungan asli)
- Parsing HTML cheerio masih berjalan di thread utama; kalau profil CPU menunjukkan ini bottleneck, pindahkan ke `worker_threads`.
- Image proxy belum punya cache disk/CDN. Menaruh Cloudflare di depan `/api/image` (header `immutable` sudah ada) adalah peningkatan terbesar berikutnya.
- `clientIp` mengambil entri pertama `x-forwarded-for`; kalau Railway tidak menimpanya, klien bisa memalsukan IP untuk lolos rate limit. Periksa apa yang dikirim proxy Anda sebelum mengubahnya.
