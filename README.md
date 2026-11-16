

Versi ini mempertahankan antarmuka React/Vite dan mengganti backend SQLite lokal menjadi Express + PostgreSQL (Supabase). Data transaksi disimpan di PostgreSQL, bukan localStorage atau file JSON. `localStorage` pada browser hanya dipakai untuk menyimpan token login dan informasi sesi UI.

## Struktur
- `client/` — React + Vite
- `server/` — Express API + PostgreSQL
- `server/schema.sql` — skema database relasional
- `render.yaml` — konfigurasi awal service backend Render
- `client/vercel.json` — konfigurasi routing SPA Vercel

## Akun uji
Seed akun dibuat otomatis saat database pertama kali kosong:
| Aktor | Username | Password awal |
|---|---|---|
| Ketua | `ketua` | `lestari` |
| Bendahara | `bendahara` | `lestari` |
| Petugas Timbang | `petugas` | `lestari` |
| Nasabah | `nasabah` | `lestari` |

Password disimpan dalam bentuk hash bcrypt. Untuk demo publik, set `DEMO_PASSWORD` sebelum database pertama kali diinisialisasi dan gunakan password yang tidak mudah ditebak. Nilai awal `lestari` hanya untuk pengujian lokal.

## A. Menyiapkan Supabase
1. Buka https://supabase.com/ dan buat project baru.
2. Simpan database password project dengan aman.
3. Di Supabase, buka **Project Settings → Database → Connection string**.
4. Pilih URI/connection string yang disediakan Supabase. Untuk Render, gunakan connection pooler jika koneksi direct tidak cocok dengan jaringan hosting.
5. Salin connection string. Jangan masukkan ke source code atau ke variabel `VITE_` frontend.
6. Backend akan membuat tabel dan akun demo otomatis saat pertama kali berjalan. `server/schema.sql` juga disediakan sebagai dokumentasi skema.

## B. Menjalankan backend lokal
1. Salin `server/.env.example` menjadi `server/.env`.
2. Isi `DATABASE_URL` dengan connection string Supabase.
3. Isi `JWT_SECRET` dengan string acak panjang (minimal 32 karakter).
4. Isi `CLIENT_URL=http://localhost:5173`.
5. Isi `DEMO_PASSWORD` dengan password uji yang ingin digunakan. Atur ini sebelum database pertama kali dibuat.
6. Buka terminal:
   ```bash
   cd server
   npm install
   npm run dev
   ```
7. Tes `http://localhost:4000/api/health`. Respons sukses menampilkan `"database":"connected"`.

## C. Menjalankan frontend lokal
1. Salin `client/.env.example` menjadi `client/.env`.
2. Isi `VITE_API_URL=http://localhost:4000/api`.
3. Terminal baru:
   ```bash
   cd client
   npm install
   npm run dev
   ```
4. Buka alamat Vite, biasanya `http://localhost:5173`.

## D. Upload ke GitHub
1. Buat repository GitHub baru.
2. Upload isi folder proyek ini.
3. Pastikan `.env` tidak ikut di-upload. File `.gitignore` sudah mengabaikan `.env`, `node_modules`, `dist`, dan database lokal.
4. Jangan menaruh password database, JWT secret, atau credential Supabase di GitHub.

## E. Deploy backend ke Render
1. Push project ke GitHub.
2. Di https://render.com/, pilih **New → Web Service**, lalu hubungkan repository.
3. Isi **Root Directory**: `server`.
4. **Build Command**: `npm install`.
5. **Start Command**: `npm start`.
6. Tambahkan Environment Variables:
   - `DATABASE_URL` = connection string Supabase
   - `DATABASE_SSL` = `true`
   - `JWT_SECRET` = secret acak panjang minimal 32 karakter
   - `CLIENT_URL` = URL Vercel setelah frontend dideploy (contoh `https://nama-proyek.vercel.app`)
   - `DEMO_PASSWORD` = password akun uji (harus ditentukan sebelum seed pertama)
   - `NODE_ENV` = `production`
7. Deploy. Tes URL backend dengan menambahkan `/api/health`.

## F. Deploy frontend ke Vercel
1. Di https://vercel.com/, pilih **Add New → Project** dan import repository GitHub.
2. Isi **Root Directory**: `client`.
3. Framework preset: **Vite**.
4. Build Command: `npm run build`.
5. Output Directory: `dist`.
6. Tambahkan Environment Variable:
   - `VITE_API_URL` = URL Render lengkap ditambah `/api`, contoh `https://nama-api.onrender.com/api`
7. Deploy. Setelah URL Vercel tersedia, kembali ke Render dan pastikan `CLIENT_URL` berisi URL tersebut, lalu redeploy/restart backend.

## G. Uji sebelum presentasi
- Buka URL Vercel dari browser/perangkat lain.
- Login dengan masing-masing aktor.
- Coba tambah nasabah, ubah harga, input setoran, penarikan, penjualan, dan laporan.
- Pastikan data tetap ada setelah refresh dan setelah backend restart.
- Pastikan URL `.../api/health` menunjukkan database terhubung.

## Catatan penting / batasan yang masih perlu diuji
- Ini paket sumber yang sudah disiapkan untuk PostgreSQL dan hosting, tetapi belum dapat dianggap sudah online sampai Supabase, GitHub, Render, dan Vercel dikonfigurasi menggunakan akun pemilik proyek.
- Belum ada migrasi otomatis yang mengimpor isi file SQLite lama. Database Supabase baru akan diisi data demo awal. Jika ada transaksi penting di SQLite lama, ekspor dan impor perlu dilakukan secara terpisah.
- Akun Nasabah demo ditautkan ke data nasabah Andi Pratama. Nasabah baru yang ditambahkan dari menu Data Nasabah belum otomatis memperoleh akun login.
- `DEMO_PASSWORD` hanya digunakan ketika seed akun dibuat pertama kali. Mengubah environment variable setelah akun terbentuk tidak mengganti password akun yang sudah ada.
- Uji seluruh alur transaksi setelah deploy. Untuk penggunaan nyata, tambahkan proses ganti password, pemulihan akun, audit log, backup, dan pengaturan keamanan lebih lanjut.
=======

