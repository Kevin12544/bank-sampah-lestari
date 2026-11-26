-- Bank Sampah Lestari: PostgreSQL Schema (Production + H1-H4 Full Compliance)

CREATE TABLE IF NOT EXISTS users (
  id_user BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Ketua','Bendahara','Petugas Timbang','Nasabah')),
  nama_user TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  token_version INTEGER NOT NULL DEFAULT 1,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ketua (
  id_ketua BIGSERIAL PRIMARY KEY,
  nama TEXT NOT NULL,
  jabatan TEXT NOT NULL DEFAULT 'Ketua'
);

CREATE TABLE IF NOT EXISTS nasabah (
  id_nasabah BIGSERIAL PRIMARY KEY,
  id_user BIGINT UNIQUE REFERENCES users(id_user) ON DELETE SET NULL,
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
  harga_per_kg NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (harga_per_kg >= 0),
  tgl_mulai DATE,
  tgl_selesai DATE
);

-- H1: Entitas HargaPeriode (penetapan harga awal bulan, terkunci setelah ditetapkan/dipakai)
CREATE TABLE IF NOT EXISTS harga_periode (
  id_periode BIGSERIAL PRIMARY KEY,
  id_harga BIGINT NOT NULL REFERENCES harga_sampah(id_harga) ON DELETE CASCADE,
  jenis_sampah TEXT NOT NULL,
  bulan INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  tahun INTEGER NOT NULL CHECK (tahun BETWEEN 2000 AND 2100),
  harga_per_kg NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (harga_per_kg >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','terkunci')),
  ditetapkan_oleh TEXT NOT NULL DEFAULT 'Sistem',
  ditetapkan_pada TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id_harga, bulan, tahun)
);

-- H1 & H3: Setoran menyimpan salinan harga periode & pembagian 10% Kas Operasional : 90% Nasabah
CREATE TABLE IF NOT EXISTS transaksi_setor (
  id_setor BIGSERIAL PRIMARY KEY,
  id_nasabah BIGINT NOT NULL REFERENCES nasabah(id_nasabah),
  id_harga BIGINT REFERENCES harga_sampah(id_harga) ON DELETE SET NULL,
  id_periode BIGINT REFERENCES harga_periode(id_periode) ON DELETE SET NULL,
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  jenis_sampah TEXT NOT NULL,
  berat_awal NUMERIC(16,3) NOT NULL CHECK (berat_awal > 0),
  harga NUMERIC(16,2) NOT NULL CHECK (harga >= 0),
  nilai_kotor NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (nilai_kotor >= 0),
  persen_potongan NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (persen_potongan BETWEEN 0 AND 100),
  potongan_kas NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (potongan_kas >= 0),
  nilai_nasabah NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (nilai_nasabah >= 0),
  nilai_setor NUMERIC(16,2) NOT NULL CHECK (nilai_setor >= 0),
  petugas TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- H2: Penarikan saldo (min Rp50.000, maks 1x/bulan, pengecualian Desember tarik seluruh saldo)
CREATE TABLE IF NOT EXISTS transaksi_penarikan (
  id_penarikan BIGSERIAL PRIMARY KEY,
  id_nasabah BIGINT NOT NULL REFERENCES nasabah(id_nasabah),
  id_user BIGINT REFERENCES users(id_user) ON DELETE SET NULL,
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  jumlah NUMERIC(16,2) NOT NULL CHECK (jumlah > 0),
  keterangan TEXT DEFAULT '',
  petugas TEXT NOT NULL,
  is_penarikan_desember BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pengepul (
  id_pengepul BIGSERIAL PRIMARY KEY,
  nama TEXT NOT NULL,
  kontak TEXT DEFAULT '',
  alamat TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- H4: Header transaksi penjualan (siklus 2 mingguan + ringkasan berat gudang & susut)
CREATE TABLE IF NOT EXISTS transaksi_penjualan (
  id_penjualan BIGSERIAL PRIMARY KEY,
  id_pengepul BIGINT REFERENCES pengepul(id_pengepul) ON DELETE SET NULL,
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  jenis_sampah TEXT NOT NULL,
  berat_jual NUMERIC(16,3) NOT NULL CHECK (berat_jual > 0),
  total_berat_gudang NUMERIC(16,3) NOT NULL DEFAULT 0,
  total_susut NUMERIC(16,3) NOT NULL DEFAULT 0,
  harga_jual NUMERIC(16,2) NOT NULL CHECK (harga_jual > 0),
  total NUMERIC(16,2) NOT NULL CHECK (total > 0),
  pembeli TEXT DEFAULT '',
  catatan TEXT DEFAULT '',
  diluar_jadwal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- H4: Relasi M:N Penjualan <-> JenisSampah dengan pencatatan berat gudang, timbangan pengepul, & susut
CREATE TABLE IF NOT EXISTS detail_penjualan (
  id_detail BIGSERIAL PRIMARY KEY,
  id_penjualan BIGINT NOT NULL REFERENCES transaksi_penjualan(id_penjualan) ON DELETE CASCADE,
  id_harga BIGINT REFERENCES harga_sampah(id_harga) ON DELETE SET NULL,
  jenis_sampah TEXT NOT NULL,
  berat_gudang NUMERIC(16,3) NOT NULL CHECK (berat_gudang > 0),
  berat_jual NUMERIC(16,3) NOT NULL CHECK (berat_jual > 0),
  berat_susut NUMERIC(16,3) NOT NULL DEFAULT 0 CHECK (berat_susut >= 0),
  harga_jual NUMERIC(16,2) NOT NULL CHECK (harga_jual > 0),
  subtotal NUMERIC(16,2) NOT NULL CHECK (subtotal > 0)
);

CREATE TABLE IF NOT EXISTS laporan_bulanan (
  id_laporan BIGSERIAL PRIMARY KEY,
  id_ketua BIGINT REFERENCES ketua(id_ketua),
  bulan INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  tahun INTEGER NOT NULL,
  total_setor NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_potongan_kas NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_penarikan NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_penjualan NUMERIC(16,2) NOT NULL DEFAULT 0,
  total_susut NUMERIC(16,3) NOT NULL DEFAULT 0,
  UNIQUE(id_ketua, bulan, tahun)
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  message TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  audience TEXT NOT NULL DEFAULT 'staff' CHECK (audience IN ('staff','nasabah','all')),
  id_nasabah BIGINT REFERENCES nasabah(id_nasabah) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  id_user BIGINT REFERENCES users(id_user) ON DELETE SET NULL,
  username TEXT NOT NULL DEFAULT 'system',
  role TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  ip_address TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pengaturan (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_harga_periode_ym ON harga_periode(tahun DESC, bulan DESC);
CREATE INDEX IF NOT EXISTS idx_setor_tanggal ON transaksi_setor(tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_setor_nasabah ON transaksi_setor(id_nasabah);
CREATE INDEX IF NOT EXISTS idx_penarikan_tanggal ON transaksi_penarikan(tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_penarikan_nasabah ON transaksi_penarikan(id_nasabah);
CREATE INDEX IF NOT EXISTS idx_penjualan_tanggal ON transaksi_penjualan(tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_detail_penjualan_parent ON detail_penjualan(id_penjualan);
CREATE INDEX IF NOT EXISTS idx_detail_penjualan_jenis ON detail_penjualan(jenis_sampah);
CREATE INDEX IF NOT EXISTS idx_notifications_scope ON notifications(audience, id_nasabah, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
