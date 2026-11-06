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

## Perbaikan lanjutan pada audit performa

- Image proxy kini mempertahankan timeout sampai body gambar selesai di-stream, bukan hanya sampai header upstream diterima. Ini mencegah koneksi gambar yang menggantung tanpa batas.
- Image proxy juga menghitung ukuran byte aktual selama streaming, sehingga batas 25 MB tetap berlaku walaupun upstream tidak mengirim `Content-Length` atau mengirim nilai yang keliru.
- Pengujian streaming, validasi host anti-SSRF, tipe konten, dan redirect image proxy lulus setelah perubahan.

## Catatan skala multi-instance

Cache angka komunitas dan antrean write-behind progres baca tetap bersifat per proses. Respons scraper publik dan counter rate-limit komunitas dapat dibagi lintas replika melalui Redis REST bila kredensial Redis tersedia. Redis tidak menggantikan MongoDB sebagai sumber data utama.

## Shared Redis L2 cache (optional)

The API now supports an Upstash-compatible Redis REST cache for scraper GET responses. The in-process bounded LRU remains L1 (fast path); Redis is only checked after a local miss, and Redis failures fall back to the origin loader without changing response correctness.

Set these server environment variables to enable it:

- `REDIS_REST_URL`: Upstash Redis REST URL
- `REDIS_REST_TOKEN`: Upstash Redis REST token (keep it in the hosting provider's secret settings)

When both Redis variables are configured, public scraper GET response cache uses Redis L2 and community write/login rate-limit counters are shared atomically across backend replicas via Redis Lua. If Redis is unavailable, rate limiting falls back to bounded per-instance memory; this fallback preserves availability but is not a global limit during a Redis outage. Public/community personal response bodies are never stored in shared Redis cache.
- `REDIS_KEY_PREFIX`: optional namespace; default `komikta:api:v1:`
- `REDIS_TIMEOUT_MS`: optional timeout; default `250`

Redis stores only public scraper GET responses with the route's existing TTL. Community/account/comment/profile response bodies remain uncached by this layer to avoid cross-user data leakage and stale writes. Community rate-limit counters use atomic Lua fixed-window counters across replicas. If Redis is unset or unavailable, rate limiting falls back to bounded local counters; availability is preserved, but a global abuse-control boundary cannot be guaranteed during Redis outage.

## v6 — perbaikan error Railway + optimasi lanjutan

**Error `indeks gagal dibuat {"banned":1}` (log Railway).** Di database produksi sudah ada indeks polos `banned_1`, sedangkan v5 meminta indeks *partial* dengan nama yang sama → MongoDB menolak (IndexOptionsConflict). Perbaikan: (1) indeks `banned` kini polos sehingga cocok dengan yang sudah ada; (2) `ensureIndexes` menganggap konflik opsi AMAN bila indeks dengan kunci sama sudah ada, jadi tidak ada lagi error serupa di deploy berikutnya. Komunitas memang tetap hidup ("komunitas aktif") — error ini hanya mencatat satu indeks yang gagal, bukan crash.

| Area | Perubahan |
|---|---|
| Foto profil | URL kini `/avatar?v=<waktu ganti>` → foto baru tampil seketika, URL lama aman di-cache `immutable` 1 tahun. Server menyimpan foto di memori (120 entri, 5 mnt) + ETag/304, jadi MongoDB tidak membaca dokumen base64 besar tiap foto tampil. Bentuk respons tidak berubah (`picture` tetap string URL). |
| Komentar | `clientId` opsional pada `POST /comments`: kirim ulang karena timeout/jaringan putus mengembalikan komentar yang sama (tanpa ganda, tanpa XP ganda). Dasar untuk optimistic UI. Indeks `{userId, clientId}` sparse. |
| Like komentar | satu round-trip lebih sedikit (`findOneAndUpdate` mengembalikan hitungan). |
| Balasan | kenaikan `replyCount` induk dan penghitungan XP berjalan paralel. |
| Header cache | Data publik: `stale-while-revalidate`. GET personal (profil, komentar, riwayat): `private, no-cache` + `Vary: Authorization` → klien memakai ETag dan menerima 304 tanpa body, data tetap akurat. Tulis tetap `no-store`. |
| Image proxy | Cache LRU di memori untuk gambar ≤ 1,5 MB (`IMAGE_CACHE_MB`, default 48; 0 = mati). Chapter yang sama dibuka banyak orang tidak lagi memukul sumber. Aturan anti-SSRF tetap dicek sebelum cache. |

Env baru: `IMAGE_CACHE_MB` (48).

### Perbaikan log merah `[SOURCE_TIMEOUT] /api/image?...` (v11)

Penyebab: proxy gambar memakai satu timer 20 detik untuk seluruh proses, dan request yang dibatalkan APK (pindah chapter / scroll cepat) ikut dicatat sebagai `SOURCE_TIMEOUT` ("This operation was aborted"), padahal bukan error server.

| Perubahan | Efek |
|---|---|
| Batal dari klien dibedakan dari timeout sumber | Klien pergi → diam, tidak dicatat sebagai error |
| Timeout per tahap: tunggu respons sumber 12 dtk, lalu batas diam 15 dtk saat unduh (reset tiap ada data) | Gambar besar di koneksi lambat tidak terpotong; sumber yang mati tidak menahan koneksi |
| Ulang otomatis 1x kalau sumber timeout / koneksi putus | Gangguan sesaat di `lms.imgsvr.my.id` tidak sampai ke APK |
| Pesan error menyebut host sumber | Mudah tahu sumber mana yang bermasalah |

Env baru: `IMAGE_HEADER_TIMEOUT_MS` (12000), `IMAGE_BODY_IDLE_MS` (15000), `IMAGE_FETCH_RETRIES` (1).

**Untuk sisi klien (tidak ada di zip ini):** kirim `clientId` unik (UUID) tiap komentar; gunakan `picture` apa adanya (sudah berversi); pakai `If-None-Match`/ETag pada GET; panggil `reading-progress` tanpa menunggu respons.

**Preload chapter berikutnya (server).** Saat sebuah chapter baru diambil dari sumber, chapter `next`-nya dimuat diam-diam ke cache (maks 3 sekaligus, error diabaikan, memakai cache L1/Redis yang sama). Tombol "Next" jadi `x-cache: HIT`.

**Balasan komentar:** `GET /comments/:id/replies` memeriksa komentar induk dan mengambil balasan secara paralel (satu round-trip database lebih sedikit).

## Pemanas cache server (instant untuk pengguna pertama)

Server menjaga daftar Home (`latest?page=1`, `popular`), detail komik teratas, dan chapter terbarunya selalu hangat di cache (L1 + Redis), sehingga request pertama pengguna pun `x-cache: HIT` tanpa menunggu scrape ke situs sumber. Berjalan di background tiap 30 detik, berurutan dengan jeda kecil agar sumber tidak dibanjiri; satu sumber gagal tidak mengganggu yang lain.

Env (semua opsional): `WARM_ENABLED` (default true; `false` untuk mematikan), `WARM_INTERVAL_SEC` (30), `WARM_DETAILS` (6 komik per sumber), `WARM_CHAPTERS` (3 chapter terbaru per sumber), `WARM_SOURCES` (daftar id dipisah koma; kosong = semua sumber).

### MANGA Plus: bahasa benar-benar sesuai pilihan (v12)

Penyebab bug "pilih Indonesia tapi isinya bahasa lain": server MANGA Plus mengelompokkan daftar judul per serial, dan satu grup berisi **varian bahasa** (judul + ID berbeda per bahasa, chapter-nya pun terpisah). Scraper lama hanya membaca varian pertama tiap grup, jadi `?lang=ind` tetap menghasilkan ID/chapter bahasa lain.

| Perubahan | Efek |
|---|---|
| Baca semua varian tiap grup + bahasa tiap judul (enum Language protobuf: 0 eng, 1 esp, 2 fra, 3 ind, 4 ptb, 5 rus, 6 tha, 7 deu, 8 vie) | ID judul = ID bahasa yang dipilih |
| Satu serial = satu judul di search/browse/latest/popular: bahasa terpilih, kalau tidak ada → English | Tidak ada data ganda antar bahasa |
| `detail` mengembalikan `language` dan `languages: [{code, slug}]` (hanya bahasa yang tersedia) | APK menampilkan pilihan bahasa yang benar-benar ada |
| Chapter di `detail` disaring: hanya milik ID judul itu | Chapter bahasa lain tidak bisa tercampur |

Tes: `test/mangaplus-lang.test.mjs` (fixture multi-bahasa).
