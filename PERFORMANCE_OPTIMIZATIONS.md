# Komikta performance notes

- Ktor dihapus, API pakai OkHttp + kotlinx.serialization langsung. Parsing JSON dan mapping ke domain jalan di `Dispatchers.Default`, bukan main thread.
- Dependency dibuang: ktor (client, android, logging, content-negotiation, serialization), timber, datastore.
- Logo 1536x512 (di-decode di main thread saat buka Home/Profile) diganti 384x128.
- `largeHeap` dimatikan. Rule proguard yang meng-keep seluruh ktor/okhttp dihapus supaya R8 bisa shrink.
- `baseline-prof.txt` ditambahkan untuk kode aplikasi.
- UI: tanpa glassmorphism, tanpa floating nav, tanpa gradient, tanpa shimmer/infinite animation, tanpa transisi navigasi, tanpa carousel auto-scroll.
- Kartu komik: tanpa ikon vector per item, satu komponen `PosterCard` dipakai Home/Explore/Library.
- Explore/Detail: `OutlinedTextField`, `FilterChip`, `TabRow` diganti komponen sederhana.
- Reader: map rasio halaman tidak lagi observable (sebelumnya tiap update me-recompose semua halaman), prefetch berbasis event bukan polling 300ms, tanpa animasi fade/slide, bar kontrol solid.
