# comic-api

Server scraper komik untuk aplikasi (APK). Sumber scraper aktif: **Manta**, **Shinigami**, **Lumos**.
Satu pintu API, semua sumber punya bentuk data yang sama — cepat, ringan, cache agresif.

## Jalankan

```bash
npm install
API_KEY=rahasia npm start   # http://localhost:3000 (API_KEY opsional)
npm test                 # tes server + playground (offline, pakai mock)
npm run smoke            # tes scraper ke situs asli (butuh internet)
```

Butuh Node 20+. Dependensi: `cheerio` (scraper) dan `mongodb` (fitur komunitas).

## Playground (halaman tes)

Buka `http://localhost:3000/playground` (atau `https://server-kamu.com/playground`).
Satu file HTML tanpa library, tampilan kotak polos, jalan di HP maupun desktop.

1. **Tes otomatis**: klik **Tes semua endpoint**. Yang dites:
   - Server: `/health`, `/api/sources`, `/api/search` (semua sumber), validasi `400` (tanpa `q`) dan `404` (sumber tidak ada).
   - Tiap sumber: search → latest → popular → browse → genres → detail → chapter → gambar (proxy).
   - Hasil per langkah `PASS` / `FAIL` / `SKIP` + waktu (ms) + keterangan, ringkasan di atas.
2. **Coba manual**: pilih sumber + endpoint, isi parameter, **Execute** (atau Ctrl+Enter). Terlihat status, waktu, ukuran, `x-cache`. Preview (daftar, detail, thumbnail chapter) atau JSON mentah; klik item/chapter untuk lanjut.

Server URL & API key disimpan di browser (localStorage), tidak dikirim ke mana pun selain server kamu.
Matikan di production dengan env `PLAYGROUND=false`.

## Hosting

- **Railway / Heroku / Render**: push repo, `Procfile` sudah ada. Set env `API_KEY`.
- **Docker / VPS**: `docker build -t comic-api . && docker run -p 3000:3000 -e API_KEY=rahasia comic-api`
- Health check: `GET /health`

## Endpoint

Semua response JSON: `{ "ok": true, "data": ... }` atau `{ "ok": false, "error": { "code", "message" } }`.
Kalau `API_KEY` diisi, kirim header `x-api-key`.

| Endpoint | Keterangan |
|---|---|
| `GET /health` | status server (tanpa auth) |
| `GET /playground` | halaman tes (tanpa auth, lihat bawah) |
| `GET /api/sources` | daftar sumber + filter yang didukung |
| `GET /api/search?q=&limit=` | cari di **semua** sumber sekaligus (hasil `source` per item) |
| `GET /api/:source/search?q=&limit=` | cari di satu sumber |
| `GET /api/:source/latest?page=` | update terbaru |
| `GET /api/:source/popular?period=&limit=` | populer (tidak semua sumber mendukung → `501`) |
| `GET /api/:source/browse?q=&genre=&type=&status=&sort=&min=&page=` | filter lengkap |
| `GET /api/:source/genres` | daftar genre |
| `GET /api/:source/comic/:slug` | detail + daftar chapter (terbaru → terlama) |
| `GET /api/:source/chapter/:slug/:chapter` | gambar chapter + `prev`/`next` |
| `GET /api/image?url=` | image proxy (lihat bawah) |

### Profil, waktu baca, dan Likes (komunitas)

| Endpoint | Fungsi |
|---|---|
| `GET /api/community/users/:id/profile` | statistik profil: `readMinutes`, `commentCount`, `monthsJoined`, `level`, `publicNo` (ID publik), `activityVisible` |
| `GET /api/community/users/:id/activity?tab=all\|comments\|likes&page=&limit=` | daftar aktivitas berpaginasi. semua tab (`all`, `comments`, `likes`) selalu publik; tidak ada lagi pengaturan privasi aktivitas |
| `PUT /api/community/me/reading-time` | `{source, slug, chapter, seconds}` waktu baca aktif. Kredit dibatasi waktu nyata sejak ping terakhir (ping pertama maks 60 dtk, per ping maks 300 dtk) |
| `PUT /api/community/likes` | like komik/chapter: `{type, source, slug, chapter?, comicTitle?, chapterTitle?, coverUrl?}` (idempotent) |
| `DELETE /api/community/likes?type=&source=&slug=&chapter=` | hapus like |
| `GET /api/community/likes/status?type=&source=&slug=&chapter=` | `{liked, count}` |

Koleksi baru: `likes`, `counters` (ID publik berurutan, diberikan sekali per pengguna saat pertama dibutuhkan). Menit membaca = akumulasi `users.readSeconds`; per komik tersimpan di `reading_progress.readSeconds`. Pengguna lama mulai dari 0 menit karena durasi sebelumnya memang tidak pernah dicatat.

### Katalog mandiri: views, edit komik, gambar chapter (untuk APK)

Kontrak lengkap: `BACKEND_KATALOG.md` di proyek APK. Kode: `src/community/catalog.js`.

| Endpoint | Fungsi |
|---|---|
| `POST /api/community/views/comic` `{source, slug}` | catat 1 view komik (login atau anonim, header `X-Device-Id`); dedupe per userId/deviceId/IP per komik, jendela 6 jam; balas `{viewCount}` |
| `POST /api/community/views/chapter` `{source, comic, chapter}` | sama untuk chapter |
| `GET\|PUT /api/community/admin/comics/:source/:slug` | OWNER: data gabungan / simpan override (`title, cover, synopsis, genres[], type, status, author, artist`) |
| `DELETE /api/community/admin/comics/:source/:slug/override` | OWNER: kembali ke data scraper |
| `GET\|PUT\|DELETE /api/community/admin/comics/:source/:slug/chapters/:chapter/pages` | OWNER: daftar gambar chapter (PUT = daftar lengkap berurutan, 1–500 item) |
| `POST /api/community/admin/media` | OWNER: unggah gambar (multipart, field `file`, JPEG/PNG/WebP/GIF, maks 10 MB, dicek byte-nya) → `{url: "/media/<id>"}` |
| `GET /media/:id` | sajikan gambar unggahan (`Cache-Control: immutable`, ETag) |

- `viewCount` ditambahkan ke item daftar (`latest`, `popular`, `search`, `browse`, `/api/search`) dan detail komik (+ tiap `chapters[]`). Field `views` dari scraper dibiarkan apa adanya (APK mengabaikannya).
- Override menggantikan field scraper di semua respons; field kosong = pakai scraper. Override `type`/`status`/`genres` ikut dihitung di `browse` (komik yang dipindahkan keluar disaring, yang dipindahkan masuk muncul di halaman 1).
- Cache scraper (memori + Redis) tidak diubah dan tidak perlu dibuang: views dan override ditempel di atas hasil cache tiap request (`overlay` di `app.js`). Kalau MongoDB bermasalah, respons cache disajikan apa adanya.
- Koleksi baru: `comic_stats`, `chapter_stats`, `view_dedupe` (indeks TTL 6 jam), `comic_overrides`, `chapter_overrides`, `media`. File di `media` tidak dihapus otomatis kalau tidak lagi dipakai.
- Header `X-Device-Id` kini diizinkan CORS.

Filter per sumber ada di `/api/sources` → `filters` (mis. manta: `types`).

### Menampilkan gambar di APK

Banyak situs memblokir gambar tanpa header referer. Response `chapter` berisi `images`
(URL asli) dan `proxy` (path relatif lewat server ini). Pakai `proxy`:

```
https://server-kamu.com + data.proxy[0]   →  gambar langsung bisa dimuat
```

Kalau `API_KEY` aktif, kirim juga `x-api-key` di request gambar (atau pasang di interceptor
Glide/Coil/OkHttp). Hanya host gambar milik scraper yang boleh di-proxy.

## Kenapa cepat

- Cache respons di memori (TTL per endpoint: search 1 mnt, detail 5 mnt, genre 1 jam, dst.), sudah
  dalam bentuk JSON + gzip + ETag → request berikutnya hampir tanpa kerja. Header `x-cache: HIT|MISS|STALE`.
- Request identik yang datang barengan hanya memicu **1** scrape.
- Kalau situs sumber down, data lama tetap disajikan (maks 6 jam, `x-cache: STALE`).
- Klien bisa kirim `If-None-Match` → `304` tanpa body.
- Cache tambahan di level scraper (HTML/API sumber), retry otomatis, timeout per request.

## Struktur

```
src/
  server.js          entry: listen, graceful shutdown
  app.js             pipeline request: CORS → auth → rate limit → cache → handler
  routes.js          semua endpoint + validasi
  image-proxy.js     streaming gambar (anti-SSRF)
  playground.js      sajikan public/playground.html (gzip di-cache)
  public/playground.html   halaman tes API
  config.js          baca env
  http/              router, respond (JSON+gzip+ETag), middleware
  lib/               cache TTL, errors, timeout
  scrapers/
    index.js         registry — daftar sumber
    manta.js         Manta Comics
    shinigami.js     Shinigami
    lumos.js         Lumos
    utils.js         HTTP client (retry, cache, dedupe) + trackHost
test/                tes server
scripts/smoke-test.mjs   tes scraper ke situs asli
```

## Nambah scraper baru

1. Buat `src/scrapers/namabaru.js`, export default:
   `{ id, name, base, imageHeaders, imageHosts, filters?, search, latest, popular, browse, genres, detail, chapter }`
   (bentuk item/detail ikuti `manta.js`). Method yang tidak didukung boleh dihilangkan → endpoint jawab `501`.
2. Import dan tambahkan ke array `PROVIDERS` di `src/scrapers/index.js`.

Route, cache, rate limit, pencarian gabungan, dan image proxy langsung ikut. Cek dengan `npm run smoke namabaru`.


## Kalau muncul HTTP 403 (IP server diblokir)

Sebagian situs sumber kadang menolak IP datacenter seperti Railway, dan yang diblokir bisa berganti tiap deploy.
Scraper yang dipasang relay (`createHttp({ relay })` di `utils.js`) akan mengulang lewat relay kalau tetap 403/429/503.
Relay yang berhasil diingat 10 menit, lalu dicoba langsung lagi.

- **Bawaan**: dua relay publik (kurang stabil, bisa mati kapan saja). Matikan dengan `RELAY_PUBLIC=false`.
- **Disarankan**: relay sendiri lewat Cloudflare Worker (gratis):
  1. Cloudflare Dashboard → Workers & Pages → Create → Worker → Deploy, lalu Edit code dan tempel `relay/cloudflare-worker.js`.
  2. Settings → Variables → tambah `KEY` berisi kata rahasia.
  3. Railway → Variables: `RELAY_URL=https://nama-worker.workers.dev/?key=RAHASIA&url={url}`
  Beberapa relay dipisah tanda `|`. Host yang boleh diakses worker dibatasi di daftar `ALLOWED`.

## Komunitas (login Google, komentar, XP)

Aktif otomatis kalau `MONGODB_URI`, `GOOGLE_CLIENT_ID`, dan `AUTH_SECRET` (min. 32 karakter) terisi. Kalau salah satu kosong, fitur komunitas mati (endpoint `/api/community/*` balas `503`) dan endpoint lama tetap jalan.

| Env | Keterangan |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` | koneksi MongoDB (default db `komikta`); index dibuat otomatis saat start |
| `GOOGLE_CLIENT_ID` | Web client ID Google (boleh beberapa, pisah koma); dipakai memeriksa `aud` ID token |
| `AUTH_SECRET` | kunci penanda token sesi |
| `OWNER_EMAILS` | email yang otomatis jadi OWNER saat login (dicabut dari env → turun jadi USER) |
| `MODERATOR_EMAILS` | email yang otomatis jadi MODERATOR saat login (selama role belum diatur manual oleh OWNER) |

Koleksi: `users`, `comments` (komentar + balasan, soft delete), `comment_likes`, `reports`, `xp_events`.

Endpoint (header `Authorization: Bearer <token>`):

| Endpoint | Keterangan |
|---|---|
| `POST /api/community/auth/google` `{idToken}` | tukar ID token Google dengan token sesi |
| `GET/PATCH/DELETE /api/community/me` | profil sendiri / ganti username (1x per 7 hari) / hapus akun (komentar ikut dihapus, XP dibalik) |
| `GET /api/community/comments?type=comic\|chapter&source=&slug=&chapter=&sort=newest\|top&page=` | daftar komentar (auth opsional) |
| `GET /api/community/comments/:id/replies?page=` | balasan |
| `POST /api/community/comments` | `{type,source,slug,chapter?,body}` atau `{parentId,body}` |
| `PATCH/DELETE /api/community/comments/:id` | edit (hanya pemilik) / hapus (pemilik atau moderator) |
| `PUT/DELETE /api/community/comments/:id/like` | like / unlike |
| `POST /api/community/comments/:id/report` | `{reason: spam\|abuse\|hate\|spoiler\|other, note?}` |
| `GET /api/community/admin/reports`, `POST .../admin/reports/:id/resolve {action: delete\|dismiss}` | MODERATOR/OWNER |
| `GET /api/community/admin/users?username=`, `PUT .../admin/users/:id/ban {banned}` | MODERATOR/OWNER (MODERATOR hanya bisa ke USER dan PREMIUM) |
| `PUT /api/community/admin/users/:id/role {role: MODERATOR\|PREMIUM\|USER}` | hanya OWNER, tidak bisa ke diri sendiri, OWNER tidak bisa diberikan lewat API |
| `PUT /api/community/admin/users/:id/verified {verified: true\|false}` | hanya OWNER: beri/cabut centang verified. OWNER selalu `verified: true` dan tidak bisa diubah. Semua objek user kini punya field `verified` |
| `GET /api/community/admin/stats` | hanya OWNER: ringkasan (`users`, `newUsers7d`, `active24h`, `banned`, `owners`, `moderators`, `premiums`, `comments`, `comments24h`, `openReports`, `chaptersRead`) |
| `GET /api/community/admin/users?q=&role=&banned=1&page=` | hanya OWNER: daftar pengguna terbaru dulu, 20 per halaman. `q` mencari username/nama/email, `role` = OWNER\|MODERATOR\|PREMIUM\|USER, `verified=1` hanya akun terverifikasi. Tanpa `username` ini yang dipakai; dengan `?username=` tetap pencarian persis (MODERATOR/OWNER) |
| `GET /api/community/admin/comments?q=&reported=1&page=` | hanya OWNER: semua komentar termasuk yang sudah dihapus, terbaru dulu. `q` mencari isi atau username/nama pembuat, `reported=1` hanya yang dilaporkan |

### Pengumuman OWNER → notifikasi di semua HP

| Endpoint | Keterangan |
|---|---|
| `POST /api/community/admin/broadcasts` | hanya OWNER: `{title (maks 60), body (maks 200), source?, slug?}`. `source`+`slug` berpasangan = komik yang dibuka saat notifikasi diketuk |
| `GET /api/community/admin/broadcasts?page=` | hanya OWNER: riwayat, terbaru dulu |
| `DELETE /api/community/admin/broadcasts/:id` | hanya OWNER: tarik pengumuman (HP yang belum mengambilnya tidak akan menerimanya) |
| `GET /api/community/broadcasts?after=<id>` | publik (tanpa login, tanpa data pribadi), dipakai APK. Tanpa `after` → hanya `{latestId}` (posisi awal untuk HP baru). Dengan `after` → `{latestId, items}` yang lebih baru, paling lama dulu, maks 20 |

Koleksi: `broadcasts`. Pengumuman OWNER kini langsung didorong lewat Firebase Cloud Messaging (FCM) ke semua perangkat terdaftar. Feed di atas tetap ada sebagai cadangan: APK tetap mengambilnya tiap ±30 menit, dan pengumuman yang sudah tampil dari FCM tidak ditampilkan lagi (dedupe per ID di perangkat).

### FCM

| Endpoint | Keterangan |
|---|---|
| `PUT /api/community/push-token` | `{token, appVersion?, previous?}`. Login opsional: kalau ada sesi valid token ditautkan ke akun, kalau tidak `userId: null`. Upsert per token (satu token = satu dokumen). `previous` = token lama perangkat yang sama, langsung dihapus |
| `POST /api/community/push-token/unregister` | `{token}`. Dipanggil APK saat notifikasi dimatikan |
| `GET /api/community/admin/push-status` | hanya OWNER: `{enabled, devices, linkedToAccount}` untuk cek konfigurasi |

Koleksi `push_tokens`: `{token (unik), userId|null, appVersion, createdAt, updatedAt}`. Token yang ditolak FCM (`registration-token-not-registered`/`invalid-registration-token`) dihapus otomatis, token yang tidak diperbarui > 60 hari dibersihkan saat pengiriman, dan token ikut terhapus saat akun dihapus. APK menyinkronkan ulang tiap 7 hari.

Pesan yang dikirim berupa **data-only** (tanpa blok `notification`) dengan prioritas `high` dan TTL 3 hari, supaya `onMessageReceived` di APK selalu jalan (juga saat aplikasi ditutup) dan tidak ada notifikasi ganda dari sistem. Hasil pengiriman disimpan di dokumen pengumuman (`push: {sent, failed, at}`).

Env yang dibutuhkan di server (Railway):

- `FIREBASE_SERVICE_ACCOUNT`: isi file JSON service account (Firebase Console → Project settings → Service accounts → Generate new private key), boleh JSON mentah atau base64.
- `FIREBASE_PROJECT_ID`: opsional, bawaan `komikta-id`.

Tanpa `FIREBASE_SERVICE_ACCOUNT`, FCM nonaktif dan semua fitur lain (termasuk polling pengumuman) tetap berjalan.

XP: komentar +5, balasan +3, like diterima +2. Hanya komentar bermutu (min. 8 karakter, 2 kata, bukan huruf berulang), batas 50 XP/hari dari posting dan 20 XP/hari dari like, like hanya dihitung dari akun berumur > 1 jam dan maks 3 per pasangan akun per hari, komentar identik 24 jam ditolak, menghapus komentar membalikkan XP-nya. Level = `floor((1+sqrt(1+4*xp/25))/2)`, maks 100. Rate limit per pengguna ada di memori proses (cukup untuk 1 instance).

Halaman publik `/privacy` (Kebijakan Privasi) dan `/terms` (Ketentuan) tersedia untuk diisi di Google OAuth consent screen dan Play Console. Isi `CONTACT_EMAIL` supaya email kontak tampil. `/health` menampilkan `community: true|false`.

## Profil: chapter dibaca, level, alat OWNER

- **Chapter dibaca** dihitung server, bukan klien. `PUT /me/reading-time` hanya mengkredit detik sebesar waktu nyata sejak ping terakhir (diklaim atomik). Sebuah chapter terhitung setelah ≥ 60 dtk aktif terkumpul di chapter itu, maksimal 120 chapter / 24 jam, dan tiap chapter hanya dihitung sekali. Chapter yang terhitung memberi +8 XP (batas 80 XP/hari, grup `read`).
- **OWNER** selalu tampil `#1` dengan level `99999` (nomor lama pemegang #1 ditukar otomatis). Level pengguna lain tetap murni dari XP.
- **Banner profil sudah dihapus total**: tidak ada endpoint maupun field `banner`. Data `customBanner` lama di database tidak dipakai lagi (boleh dibersihkan manual).
- **Khusus OWNER**: `GET /admin/users/:id` (detail akun), `POST /admin/users/:id/xp` (`{ amount }`, ±50.000, dicatat sebagai event `admin`), `POST /admin/users/:id/reset-media` (`{ avatar }`, juga boleh MODERATOR untuk akun di bawahnya).
- Pengguna lama mulai dari 0 chapter dibaca (riwayat lama tidak punya bukti waktu baca per chapter).

## Performa & operasional

Ringkasan optimasi dan variabel env baru: lihat [`OPTIMIZATION.md`](OPTIMIZATION.md).

## Katalog internal & kelengkapan data

Semua daftar (latest/popular/search/browse) dan detail melewati `catalog` (koleksi Mongo `comic_catalog`):
data yang kosong dilengkapi dari detail sumber, sumber lain (judul sama), lalu AniList (hanya judul dikirim).
Nilai hasil turunan (status/tahun/sinopsis) ditandai di `derived[]`. Crawler latar belakang mengisi seluruh katalog bertahap (butuh MongoDB).

Env: `CATALOG` (true), `META_ENRICH` (true; `false` menonaktifkan AniList), `CATALOG_CRAWL` (true),
`CATALOG_CRAWL_PAGES` (8), `CATALOG_CRAWL_INTERVAL_MIN` (20), `CATALOG_CRAWL_DELAY_MS` (400), `CATALOG_INLINE_MAX` (12).

Admin (OWNER): `GET {prefix}/admin/catalog/status`, `POST {prefix}/admin/catalog/sync` body `{source?, slug?, pages?}`.
