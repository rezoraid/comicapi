# Komikta Android

## UI dan performa
- Tema gelap dengan aksen violet (`Ui.Accent`) dan font Poppins, tanpa glassmorphism dan tanpa navigasi mengambang.
- Transisi navigasi berupa fade singkat; loading memakai skeleton shimmer.
- Explore memuat satu halaman awal; halaman berikutnya dimuat saat mendekati akhir daftar.
- Daftar Compose memakai stable keys dan contentType.
- Cache memori repository: daftar 60 detik, detail 5 menit, chapter 10 menit.
- Coil memakai memory cache dan disk cache.

## Build
Buka folder ini melalui Android Studio dan jalankan Gradle Sync, lalu Build APK. Arsip ini tidak menyertakan `gradle-wrapper.jar`; jika Android Studio tidak dapat menjalankan wrapper, gunakan Gradle wrapper yang dibuat Android Studio atau tambahkan file wrapper resmi yang sesuai dengan Gradle 8.9.

## Komunitas (login Google, komentar)
1. Di Google Cloud Console buat OAuth client **Web** (dipakai juga di server sebagai `GOOGLE_CLIENT_ID`) dan OAuth client **Android** untuk package `com.komikta` dan `com.komikta.debug` dengan SHA-1 keystore yang dipakai (keystore `app/komikta-debug.jks`: `19:4D:B1:1D:47:89:70:75:C3:F8:52:E3:F9:5A:64:00:05:27:C1:8B`).
2. Isi `GOOGLE_WEB_CLIENT_ID=<web client id>` di `gradle.properties` (atau `-PGOOGLE_WEB_CLIENT_ID=...`). Kosong = tombol login menampilkan pesan belum dikonfigurasi.
3. Server harus punya `MONGODB_URI`, `GOOGLE_CLIENT_ID`, `AUTH_SECRET` (lihat README comic-api).
Komentar ada di Detail (baris "Komentar") dan di akhir tiap chapter di Reader. Token sesi disimpan di SharedPreferences yang dikecualikan dari backup.

## Rilis
- Versi 1.1.0 (versionCode 2). Signing rilis dibaca dari env/properti `KOMIKTA_STORE_FILE`, `KOMIKTA_STORE_PASSWORD`, `KOMIKTA_KEY_ALIAS`, `KOMIKTA_KEY_PASSWORD`. Kalau kosong, build rilis masih memakai keystore debug (tidak bisa diunggah ke Play Store, buat keystore sendiri dan simpan di luar repo).
- Profile: Hapus akun (wajib Play Store), tautan Ketentuan dan Kebijakan Privasi (halaman `/terms` dan `/privacy` dari server), dan layar Moderasi untuk MODERATOR/OWNER (hapus komentar atau abaikan laporan).
