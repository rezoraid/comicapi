# comic-api

Server scraper komik untuk aplikasi (APK). Sumber: **Manta**, **Shinigami**.
Satu pintu API, semua sumber punya bentuk data yang sama — cepat, ringan, cache agresif.

## Jalankan

```bash
npm install
cp .env.example .env     # isi API_KEY
npm start                # http://localhost:3000
npm test                 # tes server + playground (offline, pakai mock)
npm run smoke            # tes scraper ke situs asli (butuh internet)
```

Butuh Node 20+. Dependensi cuma `cheerio`.

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
