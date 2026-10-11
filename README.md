# Ismha Cell Online V2

Web kasir responsif dengan:
- Login admin menggunakan bcrypt hash (password tidak disimpan sebagai teks biasa)
- Session cookie `HttpOnly`, `SameSite=Lax`, dan `Secure` di production
- Pembatasan percobaan login
- PostgreSQL untuk data transaksi, produk, pengeluaran, dan sesi login
- Validasi input dan query SQL berparameter
- Dashboard dan form kasir sederhana

## Persyaratan
- Node.js 20+
- PostgreSQL database
- Hosting/server yang mendukung Node.js dan koneksi PostgreSQL
- Domain dengan HTTPS untuk penggunaan produksi

## Setup lokal
1. Instal Node.js dan PostgreSQL.
2. Buat database, misalnya `ismha_cell`.
3. Salin `.env.example` menjadi `.env`.
4. Buat password admin yang kuat, lalu hasilkan hash bcrypt:
   ```bash
   node -e "require('bcryptjs').hash('GANTI_PASSWORD_KUAT_ANDA',12).then(console.log)"
   ```
   Masukkan hasil hash ke `ADMIN_PASSWORD_HASH`. Jangan isi variabel itu dengan password biasa.
5. Atur `DATABASE_URL`, `ADMIN_USERNAME`, dan `SESSION_SECRET` (secret acak minimal 32 karakter).
6. Instal dependency dan jalankan:
   ```bash
   npm install
   npm start
   ```
7. Buka `http://localhost:3000`.

Untuk membuat secret acak dengan Node:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Deploy online
Deploy folder proyek ini ke hosting Node.js yang mendukung persistent environment variables dan PostgreSQL. Tambahkan semua variabel dari `.env.example` pada pengaturan environment hosting. Atur `NODE_ENV=production`, gunakan PostgreSQL yang mendukung SSL jika diperlukan (`DB_SSL=true`), dan aktifkan HTTPS/domain pada hosting. Jangan mengunggah file `.env` ke repositori publik.

## Penting sebelum dipakai untuk transaksi toko
Ini adalah starter V2, belum audit keamanan atau sistem akuntansi lengkap. Buat backup database rutin. Tambahkan peran karyawan, audit log, perlindungan CSRF yang sesuai, kebijakan retensi sesi, koreksi stok otomatis saat penjualan, dan uji pemulihan backup sebelum pemakaian produksi. Fitur saat ini belum mengurangi stok otomatis dan belum menyediakan pengeditan/penghapusan data.
