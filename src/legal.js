const page = (title, body) => `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} - Komikta</title><style>body{font:16px/1.65 system-ui,sans-serif;max-width:720px;margin:0 auto;padding:24px 16px;background:#000;color:#ddd}h1{color:#fff;font-size:24px}h2{color:#fff;font-size:18px;margin-top:28px}a{color:#fff}li{margin:4px 0}</style></head><body><h1>${title}</h1>${body}</body></html>`

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

export const privacyPage = contact => page('Kebijakan Privasi', `
<p>Berlaku untuk aplikasi Komikta. Pembaruan terakhir: 1 November 2026.</p>
<h2>Data yang kami simpan</h2>
<ul><li>Saat masuk dengan Google: ID akun Google, alamat email, nama, dan foto profil.</li><li>Yang kamu buat di aplikasi: username, komentar, balasan, like, laporan, serta XP dan level.</li><li>Riwayat baca, bookmark, dan pengaturan baca disimpan hanya di perangkatmu dan tidak dikirim ke server.</li></ul>
<h2>Kegunaan</h2>
<p>Data dipakai untuk membuat akun, menampilkan identitasmu di komentar, menghitung XP dan level, dan moderasi. Kami tidak menjual data dan tidak memakainya untuk iklan.</p>
<h2>Yang tampil ke pengguna lain</h2>
<p>Nama, foto profil, username, level, role, dan komentarmu. Emailmu tidak ditampilkan ke pengguna lain.</p>
<h2>Penyimpanan dan keamanan</h2>
<p>Data disimpan di database MongoDB. Aplikasi hanya menyimpan token sesi di perangkat, dan token itu tidak ikut backup.</p>
<h2>Hapus akun</h2>
<p>Buka Profile di aplikasi lalu pilih Hapus akun. Akunmu dihapus, komentarmu dihapus, dan like yang kamu berikan ditarik. Laporan yang pernah kamu kirim dapat tetap disimpan untuk keperluan moderasi.</p>
<h2>Kontak</h2>
<p>${contact ? `<a href="mailto:${esc(contact)}">${esc(contact)}</a>` : 'Hubungi pengelola aplikasi lewat halaman toko aplikasi.'}</p>`)

export const termsPage = contact => page('Ketentuan Layanan', `
<p>Dengan memakai fitur komunitas Komikta, kamu menyetujui ketentuan berikut.</p>
<h2>Perilaku</h2>
<ul><li>Dilarang spam, pelecehan, ujaran kebencian, konten dewasa, atau menyebarkan data pribadi orang lain.</li><li>Tandai atau hindari spoiler yang mengganggu.</li><li>Dilarang memanipulasi XP atau level, termasuk memakai banyak akun.</li></ul>
<h2>Moderasi</h2>
<p>Moderator dapat menghapus komentar dan memblokir akun yang melanggar tanpa pemberitahuan sebelumnya.</p>
<h2>Konten</h2>
<p>Komentar adalah tanggung jawab penulisnya. Kamu memberi kami izin menampilkannya di aplikasi.</p>
<h2>Kontak</h2>
<p>${contact ? `<a href="mailto:${esc(contact)}">${esc(contact)}</a>` : 'Hubungi pengelola aplikasi lewat halaman toko aplikasi.'}</p>`)

export const legalHandler = html => ({ req, res }) => {
  const body = Buffer.from(html)
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=3600',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'x-frame-options': 'DENY',
    'content-length': body.length
  })
  res.end(req.method === 'HEAD' ? undefined : body)
}
