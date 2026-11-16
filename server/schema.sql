-- Bank Sampah Lestari: PostgreSQL schema
CREATE TABLE IF NOT EXISTS users (
  id_user BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Ketua','Bendahara','Petugas Timbang','Nasabah')),
  nama_user TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ketua (
  id_ketua BIGSERIAL PRIMARY KEY,
  nama TEXT NOT NULL,
  jabatan TEXT NOT NULL DEFAULT 'Ketua'
);
CREATE TABLE IF NOT EXISTS nasabah (
  id_nasabah BIGSERIAL PRIMARY KEY,
  id_user BIGINT UNIQUE REFERENCES users(id_user),
  no_buku TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  alamat TEXT DEFAULT '',
  no_hp TEXT DEFAULT '',
  saldo NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (saldo >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS harga_sampah (
  id_harga BIGSERIAL PRIMARY KEY,
  jenis_sampah TEXT NOT NULL UNIQUE,
  harga_per_kg NUMERIC(16,2) NOT NULL DEFAULT 0,
  tgl_mulai DATE,
  tgl_selesai DATE
);
CREATE TABLE IF NOT EXISTS transaksi_setor (
  id_setor BIGSERIAL PRIMARY KEY,
  id_nasabah BIGINT NOT NULL REFERENCES nasabah(id_nasabah),
  id_harga BIGINT REFERENCES harga_sampah(id_harga),
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  jenis_sampah TEXT NOT NULL,
  berat_awal NUMERIC(16,3) NOT NULL CHECK (berat_awal > 0),
  harga NUMERIC(16,2) NOT NULL,
  nilai_setor NUMERIC(16,2) NOT NULL,
  petugas TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transaksi_penarikan (
  id_penarikan BIGSERIAL PRIMARY KEY,
  id_nasabah BIGINT NOT NULL REFERENCES nasabah(id_nasabah),
  id_user BIGINT REFERENCES users(id_user),
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  jumlah NUMERIC(16,2) NOT NULL CHECK (jumlah > 0),
  keterangan TEXT DEFAULT '',
  petugas TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pengepul (
  id_pengepul BIGSERIAL PRIMARY KEY,
  nama TEXT NOT NULL,
  kontak TEXT DEFAULT '',
  alamat TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS transaksi_penjualan (
  id_penjualan BIGSERIAL PRIMARY KEY,
  id_pengepul BIGINT REFERENCES pengepul(id_pengepul),
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  jenis_sampah TEXT NOT NULL,
  berat_jual NUMERIC(16,3) NOT NULL CHECK (berat_jual > 0),
  harga_jual NUMERIC(16,2) NOT NULL CHECK (harga_jual > 0),
  total NUMERIC(16,2) NOT NULL,
  pembeli TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS laporan_bulanan (
  id_laporan BIGSERIAL PRIMARY KEY,
  id_ketua BIGINT REFERENCES ketua(id_ketua),
  bulan INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  tahun INTEGER NOT NULL,
  total_setor NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_penarikan NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_penjualan NUMERIC(16,2) NOT NULL DEFAULT 0,
  UNIQUE(id_ketua, bulan, tahun)
);
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
