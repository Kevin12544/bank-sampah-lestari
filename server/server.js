import "express-async-errors";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  ROLES,
  num,
  round2,
  round3,
  validNumber,
  parsePositiveInt,
  cleanText,
  validUsername,
  validPhone,
  validatePasswordStrength,
  witaNowParts,
  today,
  validDate,
  formatRupiah,
  getClientIp
} from "./lib/validators.js";

import {
  safeBcryptCompare,
  securityHeaders,
  noStoreApi,
  createRateLimiter,
  checkLoginLockout,
  recordFailedLogin,
  clearFailedLogin,
  recordAudit
} from "./lib/security.js";

import {
  MONTH_NAMES_ID,
  POTONGAN_KAS_PERSEN,
  DEFAULT_MIN_PENARIKAN,
  PENJUALAN_SIKLUS_HARI,
  computeSetoranSplit,
  validatePenarikanRules,
  computePenjualanItem,
  computePenjualanSchedule,
  extractYearMonth
} from "./lib/rules.js";

dotenv.config();

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ISSUER = "bank-sampah-lestari";
const JWT_EXPIRES_IN = "8h";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL belum diatur.");
}

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET wajib diisi minimal 32 karakter.");
}

app.disable("x-powered-by");
app.set("trust proxy", 1);

const pool =
  globalThis.__bankSampahPool ||
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_SSL === "false"
        ? false
        : { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 20000,
    allowExitOnIdle: true
  });

globalThis.__bankSampahPool = pool;

pool.on("error", error => {
  console.error("Database pool error:", error);
});

// SECURITY HEADERS
app.use(securityHeaders);
app.use("/api", noStoreApi);

// CORS
const allowedOrigins = [
  "https://bank-sampah-lestari.pages.dev",
  "https://bank-sampah-lestari.vercel.app",
  ...(process.env.CLIENT_URL || "")
    .split(",")
    .map(value => value.trim().replace(/\/$/, ""))
    .filter(Boolean)
];

function isAllowedOrigin(origin) {
  if (!origin) return true;

  const normalizedOrigin = origin.replace(/\/$/, "");

  if (allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  // Izinkan deployment preview Cloudflare Pages
  if (
    /^https:\/\/[a-z0-9-]+\.bank-sampah-lestari\.pages\.dev$/i.test(
      normalizedOrigin
    )
  ) {
    return true;
  }

  // Izinkan development lokal
  if (
    /^http:\/\/(localhost|127\.0\.0\.1):(5173|4173|3000)$/i.test(
      normalizedOrigin
    )
  ) {
    return true;
  }

  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      console.error("CORS blocked origin:", origin);
      const err = new Error("Origin tidak diizinkan oleh CORS.");
      err.status = 403;
      return callback(err);
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204
  })
);

app.use(express.json({ limit: "100kb" }));

// RATE LIMITERS
const apiLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 150,
  message: "Terlalu banyak permintaan. Coba lagi dalam 1 menit."
});

const loginLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 25,
  message: "Terlalu banyak percobaan login dari jaringan ini. Coba lagi 15 menit lagi."
});

app.use("/api", apiLimiter);

// HEALTH CHECK (sebelum ensureDb agar tetap memberi respons akurat saat DB down)
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      ok: true,
      app: "Bank Sampah Lestari",
      version: "2.2.0",
      database: "connected",
      timezone: "Asia/Makassar",
      date: today()
    });
  } catch (error) {
    console.error("Health check error:", error);

    res.status(503).json({
      ok: false,
      database: "disconnected"
    });
  }
});

// DATABASE INITIALIZATION MIDDLEWARE
app.use(async (_req, _res, next) => {
  try {
    await ensureDb();
    next();
  } catch (error) {
    next(error);
  }
});

// DB HELPERS dengan retry otomatis untuk galat koneksi pooler transien
function isTransientDbError(error) {
  const msg = String(error?.message || "");
  const code = String(error?.code || "");
  return (
    code === "53300" ||
    code === "57P01" ||
    code === "08006" ||
    code === "08001" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    /MaxClientsInSessionMode|max clients reached|Connection terminated|timeout expired/i.test(
      msg
    )
  );
}

async function queryWithRetry(sql, params = [], attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || i === attempts - 1) {
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 160 * (i + 1)));
    }
  }
  throw lastErr;
}

const q = async (sql, params = []) =>
  (await queryWithRetry(sql, params)).rows;

const one = async (sql, params = []) =>
  (await q(sql, params))[0] || null;

async function getMinPenarikan(db = pool) {
  try {
    const exec = db === pool ? queryWithRetry : (sql, params) => db.query(sql, params);
    const { rows } = await exec(
      "SELECT value FROM pengaturan WHERE key = 'min_penarikan' LIMIT 1"
    );
    if (!rows.length || !validNumber(rows[0].value)) {
      return DEFAULT_MIN_PENARIKAN;
    }
    return Math.max(0, round2(rows[0].value));
  } catch {
    return DEFAULT_MIN_PENARIKAN;
  }
}

function signUserToken(user) {
  const payload = {
    id: Number(user.id_user || user.id),
    username: user.username,
    role: user.role,
    nama_user: user.nama_user,
    tv: Number(user.token_version || 1)
  };

  return jwt.sign(payload, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: JWT_EXPIRES_IN,
    issuer: JWT_ISSUER
  });
}

async function notify(
  { message, type = "info", audience = "staff", id_nasabah = null },
  db = pool
) {
  await db.query(
    `INSERT INTO notifications(message, type, audience, id_nasabah)
     VALUES($1, $2, $3, $4)`,
    [cleanText(message, 400), type, audience, id_nasabah]
  );
}

// H1: Pastikan entitas harga_periode tersedia untuk (tahun, bulan) tertentu
async function ensurePeriodPrices(year, month, db = pool, actorName = "Sistem") {
  const exec = db === pool ? queryWithRetry : (sql, params) => db.query(sql, params);

  const txCheck = await exec(
    `SELECT COUNT(*)::int AS cnt
     FROM transaksi_setor
     WHERE EXTRACT(YEAR FROM tanggal) = $1
       AND EXTRACT(MONTH FROM tanggal) = $2`,
    [year, month]
  );
  const hasTransactions = Number(txCheck.rows[0]?.cnt || 0) > 0;
  const defaultStatus = hasTransactions ? "terkunci" : "draft";

  await exec(
    `INSERT INTO harga_periode (id_harga, jenis_sampah, bulan, tahun, harga_per_kg, status, ditetapkan_oleh)
     SELECT
       h.id_harga,
       h.jenis_sampah,
       $1::int AS bulan,
       $2::int AS tahun,
       COALESCE(
         (
           SELECT hp.harga_per_kg
           FROM harga_periode hp
           WHERE hp.id_harga = h.id_harga
             AND (hp.tahun < $2 OR (hp.tahun = $2 AND hp.bulan < $1))
           ORDER BY hp.tahun DESC, hp.bulan DESC
           LIMIT 1
         ),
         h.harga_per_kg
       ) AS harga_per_kg,
       $3::text AS status,
       $4::text AS ditetapkan_oleh
     FROM harga_sampah h
     WHERE NOT EXISTS (
       SELECT 1
       FROM harga_periode existing
       WHERE existing.id_harga = h.id_harga
         AND existing.bulan = $1
         AND existing.tahun = $2
     )
     ON CONFLICT (id_harga, bulan, tahun) DO NOTHING`,
    [month, year, defaultStatus, actorName]
  );

  // Jika sudah ada transaksi di periode tersebut, pastikan status terkunci
  if (hasTransactions) {
    await exec(
      `UPDATE harga_periode
       SET status = 'terkunci'
       WHERE bulan = $1 AND tahun = $2 AND status <> 'terkunci'`,
      [month, year]
    );
  }

  return { hasTransactions, txCount: Number(txCheck.rows[0]?.cnt || 0) };
}

async function getWasteStock(db = pool) {
  const exec = db === pool ? queryWithRetry : (sql, params) => db.query(sql, params);
  const now = witaNowParts();
  await ensurePeriodPrices(now.year, now.month, db);

  const { rows } = await exec(
    `SELECT
       h.id_harga,
       h.jenis_sampah,
       COALESCE(hp.harga_per_kg, h.harga_per_kg) AS harga_per_kg,
       hp.id_periode,
       COALESCE(hp.status, 'draft') AS status_periode,
       TO_CHAR(h.tgl_mulai, 'YYYY-MM-DD') AS tgl_mulai,
       COALESCE(s.berat_masuk, 0) AS berat_masuk,
       COALESCE(j.berat_keluar_gudang, 0) AS berat_keluar,
       COALESCE(j.berat_terjual, 0) AS berat_terjual,
       COALESCE(j.total_susut, 0) AS total_susut_kg,
       GREATEST(0, COALESCE(s.berat_masuk, 0) - COALESCE(j.berat_keluar_gudang, 0)) AS stok_kg
     FROM harga_sampah h
     LEFT JOIN harga_periode hp
       ON hp.id_harga = h.id_harga AND hp.bulan = $1 AND hp.tahun = $2
     LEFT JOIN (
       SELECT jenis_sampah, SUM(berat_awal) AS berat_masuk
       FROM transaksi_setor
       GROUP BY jenis_sampah
     ) s ON s.jenis_sampah = h.jenis_sampah
     LEFT JOIN (
       SELECT
         jenis_sampah,
         SUM(berat_gudang) AS berat_keluar_gudang,
         SUM(berat_jual) AS berat_terjual,
         SUM(berat_susut) AS total_susut
       FROM detail_penjualan
       GROUP BY jenis_sampah
     ) j ON j.jenis_sampah = h.jenis_sampah
     ORDER BY h.id_harga`,
    [now.month, now.year]
  );

  return rows.map(row => ({
    ...row,
    harga_per_kg: num(row.harga_per_kg),
    berat_masuk: round3(row.berat_masuk),
    berat_keluar: round3(row.berat_keluar),
    berat_terjual: round3(row.berat_terjual),
    total_susut_kg: round3(row.total_susut_kg),
    stok_kg: round3(row.stok_kg)
  }));
}

async function getAvailableStockForType(client, jenisSampah) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT SUM(berat_awal) FROM transaksi_setor WHERE jenis_sampah = $1), 0)
       - COALESCE((SELECT SUM(berat_gudang) FROM detail_penjualan WHERE jenis_sampah = $1), 0)
       AS stok_kg`,
    [jenisSampah]
  );

  return round3(rows[0]?.stok_kg || 0);
}

async function getPenjualanScheduleStatus(referenceDate = today(), db = pool) {
  const exec = db === pool ? queryWithRetry : (sql, params) => db.query(sql, params);
  const { rows } = await exec(
    `SELECT TO_CHAR(MAX(tanggal), 'YYYY-MM-DD') AS last_sale
     FROM transaksi_penjualan`
  );
  return computePenjualanSchedule(
    rows[0]?.last_sale || null,
    referenceDate,
    PENJUALAN_SIKLUS_HARI
  );
}

async function getPenjualanWithDetails(limit = 120) {
  const headers = await q(
    `SELECT
       p.id_penjualan,
       p.id_pengepul,
       TO_CHAR(p.tanggal, 'YYYY-MM-DD') AS tanggal,
       p.jenis_sampah,
       p.berat_jual,
       COALESCE(NULLIF(p.total_berat_gudang, 0), p.berat_jual) AS total_berat_gudang,
       COALESCE(p.total_susut, 0) AS total_susut,
       p.harga_jual,
       p.total,
       p.pembeli,
       COALESCE(p.catatan, '') AS catatan,
       COALESCE(p.diluar_jadwal, FALSE) AS diluar_jadwal,
       p.created_at,
       g.nama AS nama_pengepul
     FROM transaksi_penjualan p
     LEFT JOIN pengepul g ON g.id_pengepul = p.id_pengepul
     ORDER BY p.tanggal DESC, p.id_penjualan DESC
     LIMIT $1`,
    [limit]
  );

  if (!headers.length) return [];

  const ids = headers.map(h => Number(h.id_penjualan));
  const details = await q(
    `SELECT
       id_detail,
       id_penjualan,
       id_harga,
       jenis_sampah,
       berat_gudang,
       berat_jual,
       berat_susut,
       harga_jual,
       subtotal
     FROM detail_penjualan
     WHERE id_penjualan = ANY($1::bigint[])
     ORDER BY id_detail ASC`,
    [ids]
  );

  const byParent = new Map();
  for (const d of details) {
    const pid = Number(d.id_penjualan);
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push({
      ...d,
      berat_gudang: round3(d.berat_gudang),
      berat_jual: round3(d.berat_jual),
      berat_susut: round3(d.berat_susut),
      harga_jual: round2(d.harga_jual),
      subtotal: round2(d.subtotal)
    });
  }

  return headers.map(h => ({
    ...h,
    berat_jual: round3(h.berat_jual),
    total_berat_gudang: round3(h.total_berat_gudang),
    total_susut: round3(h.total_susut),
    total: round2(h.total),
    items: byParent.get(Number(h.id_penjualan)) || []
  }));
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id_user BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK (
        role IN ('Ketua','Bendahara','Petugas Timbang','Nasabah')
      ),
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

    CREATE TABLE IF NOT EXISTS transaksi_setor (
      id_setor BIGSERIAL PRIMARY KEY,
      id_nasabah BIGINT NOT NULL REFERENCES nasabah(id_nasabah),
      id_harga BIGINT REFERENCES harga_sampah(id_harga) ON DELETE SET NULL,
      tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
      jenis_sampah TEXT NOT NULL,
      berat_awal NUMERIC(16,3) NOT NULL CHECK (berat_awal > 0),
      harga NUMERIC(16,2) NOT NULL CHECK (harga >= 0),
      nilai_setor NUMERIC(16,2) NOT NULL CHECK (nilai_setor >= 0),
      petugas TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transaksi_penarikan (
      id_penarikan BIGSERIAL PRIMARY KEY,
      id_nasabah BIGINT NOT NULL REFERENCES nasabah(id_nasabah),
      id_user BIGINT REFERENCES users(id_user) ON DELETE SET NULL,
      tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
      jumlah NUMERIC(16,2) NOT NULL CHECK (jumlah > 0),
      keterangan TEXT DEFAULT '',
      petugas TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pengepul (
      id_pengepul BIGSERIAL PRIMARY KEY,
      nama TEXT NOT NULL,
      kontak TEXT DEFAULT '',
      alamat TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS transaksi_penjualan (
      id_penjualan BIGSERIAL PRIMARY KEY,
      id_pengepul BIGINT REFERENCES pengepul(id_pengepul) ON DELETE SET NULL,
      tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
      jenis_sampah TEXT NOT NULL,
      berat_jual NUMERIC(16,3) NOT NULL CHECK (berat_jual > 0),
      harga_jual NUMERIC(16,2) NOT NULL CHECK (harga_jual > 0),
      total NUMERIC(16,2) NOT NULL CHECK (total > 0),
      pembeli TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
      audience TEXT NOT NULL DEFAULT 'staff',
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
  `);

  await pool.query(
    `INSERT INTO pengaturan(key, value)
     VALUES('min_penarikan', $1)
     ON CONFLICT(key) DO NOTHING`,
    [String(DEFAULT_MIN_PENARIKAN)]
  );

  // Idempotent schema upgrades for existing production tables (H1–H4)
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

    ALTER TABLE transaksi_setor ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE transaksi_setor ADD COLUMN IF NOT EXISTS id_periode BIGINT REFERENCES harga_periode(id_periode) ON DELETE SET NULL;
    ALTER TABLE transaksi_setor ADD COLUMN IF NOT EXISTS nilai_kotor NUMERIC(16,2);
    ALTER TABLE transaksi_setor ADD COLUMN IF NOT EXISTS persen_potongan NUMERIC(5,2) NOT NULL DEFAULT 10;
    ALTER TABLE transaksi_setor ADD COLUMN IF NOT EXISTS potongan_kas NUMERIC(16,2) NOT NULL DEFAULT 0;
    ALTER TABLE transaksi_setor ADD COLUMN IF NOT EXISTS nilai_nasabah NUMERIC(16,2);

    ALTER TABLE transaksi_penarikan ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE transaksi_penarikan ADD COLUMN IF NOT EXISTS is_penarikan_desember BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE pengepul ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

    ALTER TABLE transaksi_penjualan ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE transaksi_penjualan ADD COLUMN IF NOT EXISTS total_berat_gudang NUMERIC(16,3) NOT NULL DEFAULT 0;
    ALTER TABLE transaksi_penjualan ADD COLUMN IF NOT EXISTS total_susut NUMERIC(16,3) NOT NULL DEFAULT 0;
    ALTER TABLE transaksi_penjualan ADD COLUMN IF NOT EXISTS catatan TEXT DEFAULT '';
    ALTER TABLE transaksi_penjualan ADD COLUMN IF NOT EXISTS diluar_jadwal BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE laporan_bulanan ADD COLUMN IF NOT EXISTS total_potongan_kas NUMERIC(16,2) NOT NULL DEFAULT 0;
    ALTER TABLE laporan_bulanan ADD COLUMN IF NOT EXISTS total_susut NUMERIC(16,3) NOT NULL DEFAULT 0;

    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS audience TEXT NOT NULL DEFAULT 'staff';
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS id_nasabah BIGINT REFERENCES nasabah(id_nasabah) ON DELETE CASCADE;
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;

    -- Backfill aman untuk data transaksi_setor lama (pertahankan saldo nasabah historis)
    UPDATE transaksi_setor
    SET nilai_kotor = nilai_setor,
        persen_potongan = 0,
        potongan_kas = 0,
        nilai_nasabah = nilai_setor
    WHERE nilai_kotor IS NULL;

    -- Backfill aman untuk relasi M:N detail_penjualan dari data penjualan lama
    INSERT INTO detail_penjualan
      (id_penjualan, id_harga, jenis_sampah, berat_gudang, berat_jual, berat_susut, harga_jual, subtotal)
    SELECT
      p.id_penjualan,
      h.id_harga,
      p.jenis_sampah,
      p.berat_jual,
      p.berat_jual,
      0,
      p.harga_jual,
      p.total
    FROM transaksi_penjualan p
    LEFT JOIN harga_sampah h ON h.jenis_sampah = p.jenis_sampah
    WHERE NOT EXISTS (
      SELECT 1 FROM detail_penjualan d WHERE d.id_penjualan = p.id_penjualan
    );

    UPDATE transaksi_penjualan
    SET total_berat_gudang = berat_jual,
        total_susut = 0
    WHERE total_berat_gudang = 0;

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
  `);

  // AKUN DEMO AWAL (hanya saat tabel users kosong)
  const userCount = Number(
    (await one("SELECT COUNT(*)::int AS n FROM users")).n
  );

  if (!userCount) {
    const demo = [
      ["ketua", "lestari", "Ketua", "Meiske Rondonuwu"],
      ["bendahara", "lestari", "Bendahara", "Bendahara Lestari"],
      ["petugas", "lestari", "Petugas Timbang", "Petugas Timbang"],
      ["nasabah", "lestari", "Nasabah", "Andi Pratama"]
    ];

    for (const [username, password, role, nama_user] of demo) {
      const hash = await bcrypt.hash(
        process.env.DEMO_PASSWORD || password,
        12
      );

      await q(
        `INSERT INTO users(username, password, role, nama_user, must_change_password)
         VALUES($1, $2, $3, $4, $5)
         ON CONFLICT(username) DO NOTHING`,
        [username, hash, role, nama_user, !process.env.DEMO_PASSWORD]
      );
    }
  }

  // HARGA AWAL
  const priceCount = Number(
    (await one("SELECT COUNT(*)::int AS n FROM harga_sampah")).n
  );

  if (!priceCount) {
    const prices = [
      ["Plastik", 3000],
      ["Kertas", 2000],
      ["Kaca", 1000],
      ["Logam", 5000],
      ["Minyak Jelantah", 4000],
      ["Kardus", 2500],
      ["Lainnya", 1000]
    ];

    const tgl = today();
    for (const [jenis, harga] of prices) {
      await q(
        `INSERT INTO harga_sampah(jenis_sampah, harga_per_kg, tgl_mulai)
         VALUES($1, $2, $3)
         ON CONFLICT(jenis_sampah) DO NOTHING`,
        [jenis, harga, tgl]
      );
    }
  }

  // DATA KETUA
  const ketua = await one("SELECT id_ketua FROM ketua LIMIT 1");
  if (!ketua) {
    await q(
      "INSERT INTO ketua(nama, jabatan) VALUES($1, $2)",
      ["Meiske Rondonuwu", "Ketua"]
    );
  }

  // DATA NASABAH AWAL
  const customerCount = Number(
    (await one("SELECT COUNT(*)::int AS n FROM nasabah")).n
  );

  if (!customerCount) {
    const u = await one("SELECT id_user FROM users WHERE username='nasabah'");

    if (u) {
      await q(
        `INSERT INTO nasabah(id_user, no_buku, nama, alamat, no_hp, saldo)
         VALUES($1, $2, $3, $4, $5, $6)
         ON CONFLICT(no_buku) DO NOTHING`,
        [u.id_user, "NSB-001", "Andi Pratama", "Manado", "081234567890", 248000]
      );
    }

    await q(
      `INSERT INTO nasabah(no_buku, nama, alamat, no_hp, saldo)
       VALUES($1, $2, $3, $4, $5)
       ON CONFLICT(no_buku) DO NOTHING`,
      ["NSB-002", "Siti Lestari", "Manado", "081298765432", 175000]
    );

    await q(
      `INSERT INTO nasabah(no_buku, nama, alamat, no_hp, saldo)
       VALUES($1, $2, $3, $4, $5)
       ON CONFLICT(no_buku) DO NOTHING`,
      ["NSB-003", "Budi Santoso", "Minahasa", "081277788899", 92000]
    );
  }

  // DATA SETORAN AWAL
  const setorCount = Number(
    (await one("SELECT COUNT(*)::int AS n FROM transaksi_setor")).n
  );

  if (!setorCount) {
    const n = await one("SELECT id_nasabah FROM nasabah WHERE no_buku='NSB-001'");
    const h = await one(
      "SELECT id_harga, harga_per_kg FROM harga_sampah WHERE jenis_sampah='Plastik'"
    );

    if (n && h) {
      await q(
        `INSERT INTO transaksi_setor
         (id_nasabah, id_harga, tanggal, jenis_sampah, berat_awal, harga, nilai_setor, petugas)
         VALUES($1, $2, $3, 'Plastik', 25, $4, $5, 'Petugas Timbang')`,
        [n.id_nasabah, h.id_harga, today(), h.harga_per_kg, round2(25 * num(h.harga_per_kg))]
      );
    }
  }

  console.log("Database Bank Sampah Lestari siap.");
}

// AUTHENTICATION MIDDLEWARE (dengan verifikasi status aktif & revokasi token_version)
async function auth(req, res, next) {
  const rawHeader = req.headers.authorization || "";
  const match = rawHeader.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : "";

  if (!token) {
    return res.status(401).json({
      error: "Silakan login terlebih dahulu."
    });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER
    });
  } catch {
    return res.status(401).json({
      error: "Sesi berakhir atau tidak valid. Silakan login kembali."
    });
  }

  const dbUser = await one(
    `SELECT id_user, username, role, nama_user, is_active, token_version,
            must_change_password, last_login_at
     FROM users
     WHERE id_user = $1`,
    [decoded.id]
  );

  if (!dbUser || !dbUser.is_active) {
    return res.status(401).json({
      error: "Akun tidak aktif atau tidak ditemukan. Hubungi admin."
    });
  }

  if (Number(decoded.tv) !== Number(dbUser.token_version)) {
    return res.status(401).json({
      error: "Sesi telah berakhir karena pembaruan keamanan. Silakan login kembali."
    });
  }

  req.user = {
    id: Number(dbUser.id_user),
    username: dbUser.username,
    role: dbUser.role,
    nama_user: dbUser.nama_user,
    must_change_password: Boolean(dbUser.must_change_password),
    token_version: Number(dbUser.token_version),
    last_login_at: dbUser.last_login_at
  };

  next();
}

function allow(...allowed) {
  return (req, res, next) =>
    allowed.includes(req.user.role)
      ? next()
      : res.status(403).json({
          error: "Role Anda tidak memiliki akses ke fitur ini."
        });
}

// ===========================
// AUTH & KEAMANAN AKUN
// ===========================

app.post("/api/login", loginLimiter, async (req, res) => {
  const rawUsername = cleanText(req.body?.username, 64);
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!rawUsername || !password || password.length > 128) {
    return res.status(400).json({
      error: "Username dan password wajib diisi."
    });
  }

  const clientIp = getClientIp(req);
  const lockout = await checkLoginLockout(pool, rawUsername, clientIp);

  if (lockout.locked) {
    await recordAudit(pool, {
      req,
      user: { username: rawUsername, role: "anonymous" },
      action: "LOGIN_LOCKED",
      entity: "auth",
      detail: `Percobaan login diblokir sementara (${lockout.remainingMin} menit tersisa)`
    });

    return res.status(429).json({
      error: `Terlalu banyak percobaan login gagal. Coba lagi dalam ${lockout.remainingMin} menit.`
    });
  }

  const user = await one(
    `SELECT id_user, username, password, role, nama_user, is_active,
            token_version, must_change_password
     FROM users
     WHERE LOWER(username) = LOWER($1)`,
    [rawUsername]
  );

  const valid = await safeBcryptCompare(password, user?.password);

  if (!user || !valid) {
    await recordFailedLogin(pool, rawUsername, clientIp);
    await recordAudit(pool, {
      req,
      user: { username: rawUsername, role: user?.role || "anonymous" },
      action: "LOGIN_FAILED",
      entity: "auth",
      detail: "Username atau password tidak cocok"
    });

    return res.status(401).json({
      error: "Username atau password salah."
    });
  }

  if (!user.is_active) {
    return res.status(403).json({
      error: "Akun Anda dinonaktifkan. Hubungi Ketua Bank Sampah."
    });
  }

  await clearFailedLogin(pool, rawUsername);
  await q("UPDATE users SET last_login_at = NOW() WHERE id_user = $1", [user.id_user]);

  const safeUser = {
    id: Number(user.id_user),
    username: user.username,
    role: user.role,
    nama_user: user.nama_user,
    must_change_password: Boolean(user.must_change_password)
  };

  const token = signUserToken(user);

  await recordAudit(pool, {
    req,
    user: safeUser,
    action: "LOGIN_SUCCESS",
    entity: "auth",
    entityId: safeUser.id,
    detail: `Login berhasil (${safeUser.role})`
  });

  res.json({ token, user: safeUser });
});

app.get("/api/me", auth, async (req, res) => {
  let id_nasabah = null;
  let unreadCount = 0;

  if (req.user.role === "Nasabah") {
    const cust = await one(
      "SELECT id_nasabah, no_buku, saldo FROM nasabah WHERE id_user = $1",
      [req.user.id]
    );
    if (cust) {
      id_nasabah = Number(cust.id_nasabah);
      const cnt = await one(
        "SELECT COUNT(*)::int AS n FROM notifications WHERE id_nasabah = $1 AND is_read = FALSE",
        [id_nasabah]
      );
      unreadCount = cnt?.n || 0;
    }
  } else {
    const cnt = await one(
      "SELECT COUNT(*)::int AS n FROM notifications WHERE audience IN ('staff', 'all') AND is_read = FALSE"
    );
    unreadCount = cnt?.n || 0;
  }

  res.json({
    ...req.user,
    id_nasabah,
    unreadCount
  });
});

app.post("/api/logout-all", auth, async (req, res) => {
  await q(
    "UPDATE users SET token_version = token_version + 1 WHERE id_user = $1",
    [req.user.id]
  );

  await recordAudit(pool, {
    req,
    action: "LOGOUT_ALL",
    entity: "auth",
    entityId: req.user.id,
    detail: "Semua sesi aktif pengguna dicabut"
  });

  res.json({ ok: true, message: "Semua sesi aktif telah diakhiri." });
});

app.put("/api/me/password", auth, async (req, res) => {
  const currentPassword =
    typeof req.body?.current_password === "string" ? req.body.current_password : "";
  const newPassword =
    typeof req.body?.new_password === "string" ? req.body.new_password : "";

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      error: "Kata sandi lama dan kata sandi baru wajib diisi."
    });
  }

  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    return res.status(400).json({ error: strengthError });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({
      error: "Kata sandi baru tidak boleh sama dengan kata sandi lama."
    });
  }

  const dbUser = await one(
    `SELECT id_user, username, password, role, nama_user, token_version
     FROM users
     WHERE id_user = $1`,
    [req.user.id]
  );

  if (!dbUser || !(await bcrypt.compare(currentPassword, dbUser.password))) {
    return res.status(400).json({
      error: "Kata sandi lama tidak sesuai."
    });
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  const updated = await one(
    `UPDATE users
     SET password = $1,
         token_version = token_version + 1,
         must_change_password = FALSE
     WHERE id_user = $2
     RETURNING id_user, username, role, nama_user, token_version, must_change_password`,
    [newHash, req.user.id]
  );

  const token = signUserToken(updated);

  await recordAudit(pool, {
    req,
    action: "PASSWORD_CHANGE",
    entity: "users",
    entityId: req.user.id,
    detail: "Pengguna mengganti kata sandi sendiri; token sesi lama dicabut"
  });

  res.json({
    ok: true,
    message: "Kata sandi berhasil diperbarui.",
    token,
    user: {
      id: Number(updated.id_user),
      username: updated.username,
      role: updated.role,
      nama_user: updated.nama_user,
      must_change_password: false
    }
  });
});

// ===========================
// MANAJEMEN PENGGUNA (KETUA)
// ===========================

app.get("/api/users", auth, allow("Ketua"), async (_req, res) => {
  const rows = await q(`
    SELECT
      u.id_user,
      u.username,
      u.role,
      u.nama_user,
      u.is_active,
      u.must_change_password,
      u.created_at,
      u.last_login_at,
      n.id_nasabah,
      n.no_buku,
      n.nama AS nama_nasabah
    FROM users u
    LEFT JOIN nasabah n ON n.id_user = u.id_user
    ORDER BY u.id_user ASC
  `);

  res.json(rows);
});

app.post("/api/users", auth, allow("Ketua"), async (req, res) => {
  const username = cleanText(req.body?.username, 32).toLowerCase();
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const role = cleanText(req.body?.role, 32);
  const nama_user = cleanText(req.body?.nama_user, 120);
  const idNasabahRaw = req.body?.id_nasabah;

  if (!validUsername(username)) {
    return res.status(400).json({
      error: "Username harus 3–32 karakter (huruf, angka, titik, garis bawah, atau tanda hubung)."
    });
  }

  const strengthError = validatePasswordStrength(password);
  if (strengthError) {
    return res.status(400).json({ error: strengthError });
  }

  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: "Role tidak valid." });
  }

  if (!nama_user) {
    return res.status(400).json({ error: "Nama lengkap wajib diisi." });
  }

  let linkedNasabahId = null;
  if (role === "Nasabah" && idNasabahRaw !== undefined && idNasabahRaw !== null && idNasabahRaw !== "") {
    linkedNasabahId = parsePositiveInt(idNasabahRaw);
    if (!linkedNasabahId) {
      return res.status(400).json({ error: "ID nasabah tidak valid." });
    }
  }

  const hash = await bcrypt.hash(password, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      "SELECT id_user FROM users WHERE LOWER(username) = LOWER($1)",
      [username]
    );
    if (existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Username sudah digunakan." });
    }

    if (linkedNasabahId) {
      const custRes = await client.query(
        "SELECT id_nasabah, id_user, nama FROM nasabah WHERE id_nasabah = $1 FOR UPDATE",
        [linkedNasabahId]
      );
      if (!custRes.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Data nasabah tidak ditemukan." });
      }
      if (custRes.rows[0].id_user) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Nasabah tersebut sudah memiliki akun login." });
      }
    }

    const inserted = await client.query(
      `INSERT INTO users(username, password, role, nama_user, must_change_password)
       VALUES($1, $2, $3, $4, TRUE)
       RETURNING id_user, username, role, nama_user, is_active, must_change_password`,
      [username, hash, role, nama_user]
    );

    const createdUser = inserted.rows[0];

    if (linkedNasabahId) {
      await client.query(
        "UPDATE nasabah SET id_user = $1 WHERE id_nasabah = $2",
        [createdUser.id_user, linkedNasabahId]
      );
    }

    await recordAudit(client, {
      req,
      action: "USER_CREATE",
      entity: "users",
      entityId: createdUser.id_user,
      detail: `Membuat akun ${username} (${role})${linkedNasabahId ? ` ditautkan ke nasabah #${linkedNasabahId}` : ""}`
    });

    await client.query("COMMIT");

    res.status(201).json({
      ok: true,
      message: "Akun pengguna berhasil dibuat.",
      data: createdUser
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.put("/api/users/:id", auth, allow("Ketua"), async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "ID pengguna tidak valid." });
  }

  const nama_user = cleanText(req.body?.nama_user, 120);
  const role = cleanText(req.body?.role, 32);
  const is_active =
    typeof req.body?.is_active === "boolean" ? req.body.is_active : undefined;

  if (!nama_user) {
    return res.status(400).json({ error: "Nama lengkap wajib diisi." });
  }

  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: "Role tidak valid." });
  }

  if (id === req.user.id) {
    if (is_active === false) {
      return res.status(400).json({
        error: "Anda tidak dapat menonaktifkan akun sendiri."
      });
    }
    if (role !== "Ketua") {
      return res.status(400).json({
        error: "Anda tidak dapat mengubah role Ketua milik sendiri."
      });
    }
  }

  const existing = await one(
    "SELECT id_user, username, role, is_active FROM users WHERE id_user = $1",
    [id]
  );

  if (!existing) {
    return res.status(404).json({ error: "Pengguna tidak ditemukan." });
  }

  const nextActive = is_active === undefined ? existing.is_active : is_active;
  const shouldRevoke = nextActive === false || role !== existing.role;

  const updated = await one(
    `UPDATE users
     SET nama_user = $1,
         role = $2,
         is_active = $3,
         token_version = token_version + $4
     WHERE id_user = $5
     RETURNING id_user, username, role, nama_user, is_active, must_change_password`,
    [nama_user, role, nextActive, shouldRevoke ? 1 : 0, id]
  );

  await recordAudit(pool, {
    req,
    action: "USER_UPDATE",
    entity: "users",
    entityId: id,
    detail: `Memperbarui ${existing.username}: nama="${nama_user}", role=${role}, aktif=${nextActive}`
  });

  res.json({
    ok: true,
    message: "Data pengguna berhasil diperbarui.",
    data: updated
  });
});

app.post("/api/users/:id/reset-password", auth, allow("Ketua"), async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (!id) {
    return res.status(400).json({ error: "ID pengguna tidak valid." });
  }

  const newPassword =
    typeof req.body?.new_password === "string" ? req.body.new_password : "";
  const strengthError = validatePasswordStrength(newPassword);
  if (strengthError) {
    return res.status(400).json({ error: strengthError });
  }

  const existing = await one(
    "SELECT id_user, username FROM users WHERE id_user = $1",
    [id]
  );
  if (!existing) {
    return res.status(404).json({ error: "Pengguna tidak ditemukan." });
  }

  const hash = await bcrypt.hash(newPassword, 12);

  await q(
    `UPDATE users
     SET password = $1,
         token_version = token_version + 1,
         must_change_password = TRUE
     WHERE id_user = $2`,
    [hash, id]
  );

  await clearFailedLogin(pool, existing.username);

  await recordAudit(pool, {
    req,
    action: "USER_RESET_PASSWORD",
    entity: "users",
    entityId: id,
    detail: `Reset kata sandi untuk akun ${existing.username}`
  });

  res.json({
    ok: true,
    message: `Kata sandi ${existing.username} berhasil direset. Sesi lama telah dicabut.`
  });
});

// ===========================
// STOK & DASHBOARD
// ===========================

app.get(
  "/api/stok",
  auth,
  allow("Ketua", "Bendahara", "Petugas Timbang"),
  async (_req, res) => {
    const items = await getWasteStock();
    const totalStokKg = round3(items.reduce((sum, item) => sum + item.stok_kg, 0));
    res.json({ items, totalStokKg });
  }
);

app.get(
  "/api/dashboard",
  auth,
  allow("Ketua", "Bendahara", "Petugas Timbang"),
  async (_req, res) => {
    const { year, month } = witaNowParts();
    // 6 bulan terakhir (termasuk bulan berjalan)
    const monthsList = [];
    for (let i = 5; i >= 0; i -= 1) {
      const dt = new Date(Date.UTC(year, month - 1 - i, 1));
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth() + 1;
      const key = `${y}-${String(m).padStart(2, "0")}`;
      const label = new Intl.DateTimeFormat("id-ID", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC"
      }).format(dt);
      monthsList.push({ key, label });
    }
    const earliestDate = `${monthsList[0].key}-01`;

    const [
      nasabah,
      setor,
      penjualan,
      penarikan,
      stok,
      recent,
      trendSetor,
      trendJual,
      trendTarik
    ] = await Promise.all([
      one(
        `SELECT COUNT(*)::int AS total,
                COALESCE(SUM(saldo), 0) AS total_saldo
         FROM nasabah`
      ),
      one(
        `SELECT COALESCE(SUM(COALESCE(nilai_kotor, nilai_setor)), 0) AS total_kotor,
                COALESCE(SUM(COALESCE(potongan_kas, 0)), 0) AS total_potongan_kas,
                COALESCE(SUM(COALESCE(nilai_nasabah, nilai_setor)), 0) AS total,
                COALESCE(SUM(berat_awal), 0) AS berat
         FROM transaksi_setor`
      ),
      one(
        `SELECT COALESCE(SUM(total), 0) AS total,
                COALESCE(SUM(berat_jual), 0) AS berat,
                COALESCE(SUM(COALESCE(total_susut, 0)), 0) AS total_susut
         FROM transaksi_penjualan`
      ),
      one(
        "SELECT COALESCE(SUM(jumlah), 0) AS total FROM transaksi_penarikan"
      ),
      getWasteStock(),
      q(`
        SELECT * FROM (
          SELECT
            'setor-' || t.id_setor AS uid,
            t.id_setor AS id,
            TO_CHAR(t.tanggal, 'YYYY-MM-DD') AS tanggal,
            t.created_at,
            t.jenis_sampah AS keterangan,
            t.berat_awal AS berat,
            t.nilai_setor AS nilai,
            n.nama,
            'Setoran' AS tipe
          FROM transaksi_setor t
          JOIN nasabah n ON n.id_nasabah = t.id_nasabah

          UNION ALL

          SELECT
            'tarik-' || p.id_penarikan AS uid,
            p.id_penarikan AS id,
            TO_CHAR(p.tanggal, 'YYYY-MM-DD') AS tanggal,
            p.created_at,
            COALESCE(NULLIF(p.keterangan, ''), 'Penarikan saldo') AS keterangan,
            0 AS berat,
            p.jumlah AS nilai,
            n.nama,
            'Penarikan' AS tipe
          FROM transaksi_penarikan p
          JOIN nasabah n ON n.id_nasabah = p.id_nasabah

          UNION ALL

          SELECT
            'jual-' || j.id_penjualan AS uid,
            j.id_penjualan AS id,
            TO_CHAR(j.tanggal, 'YYYY-MM-DD') AS tanggal,
            j.created_at,
            j.jenis_sampah AS keterangan,
            j.berat_jual AS berat,
            j.total AS nilai,
            COALESCE(g.nama, NULLIF(j.pembeli, ''), 'Pengepul') AS nama,
            'Penjualan' AS tipe
          FROM transaksi_penjualan j
          LEFT JOIN pengepul g ON g.id_pengepul = j.id_pengepul
        ) combined
        ORDER BY tanggal DESC, created_at DESC, id DESC
        LIMIT 8
      `),
      q(
        `SELECT TO_CHAR(tanggal, 'YYYY-MM') AS ym, COALESCE(SUM(nilai_setor), 0) AS total
         FROM transaksi_setor
         WHERE tanggal >= $1
         GROUP BY 1`,
        [earliestDate]
      ),
      q(
        `SELECT TO_CHAR(tanggal, 'YYYY-MM') AS ym, COALESCE(SUM(total), 0) AS total
         FROM transaksi_penjualan
         WHERE tanggal >= $1
         GROUP BY 1`,
        [earliestDate]
      ),
      q(
        `SELECT TO_CHAR(tanggal, 'YYYY-MM') AS ym, COALESCE(SUM(jumlah), 0) AS total
         FROM transaksi_penarikan
         WHERE tanggal >= $1
         GROUP BY 1`,
        [earliestDate]
      )
    ]);

    const setorMap = Object.fromEntries(trendSetor.map(r => [r.ym, num(r.total)]));
    const jualMap = Object.fromEntries(trendJual.map(r => [r.ym, num(r.total)]));
    const tarikMap = Object.fromEntries(trendTarik.map(r => [r.ym, num(r.total)]));

    const monthlyTrend = monthsList.map(m => ({
      key: m.key,
      label: m.label,
      setor: round2(setorMap[m.key] || 0),
      penjualan: round2(jualMap[m.key] || 0),
      penarikan: round2(tarikMap[m.key] || 0)
    }));

    const totalSetor = round2(setor.total);
    const totalSetorKotor = round2(setor.total_kotor);
    const kasOperasional = round2(setor.total_potongan_kas);
    const totalPenjualan = round2(penjualan.total);
    const totalPenarikan = round2(penarikan.total);
    const totalSaldoNasabah = round2(nasabah.total_saldo);
    // H3: Kas Operasional bersumber dari potongan 10% setoran; Arus Kas Penjualan = Penjualan - Penarikan
    const arusKasPenjualan = round2(totalPenjualan - totalPenarikan);
    const saldoKas = kasOperasional;
    const marginKotor = round2(totalPenjualan - totalSetorKotor);
    const totalStokKg = round3(stok.reduce((sum, item) => sum + item.stok_kg, 0));
    const totalSusutKg = round3(penjualan.total_susut || 0);
    const schedule = await getPenjualanScheduleStatus();

    const chart = stok
      .filter(item => item.berat_masuk > 0 || item.stok_kg > 0)
      .map(item => ({
        jenis: item.jenis_sampah,
        berat: item.berat_masuk,
        stok: item.stok_kg,
        susut: item.total_susut_kg
      }));

    res.json({
      nasabah: nasabah.total,
      setor: totalSetor,
      setorKotor: totalSetorKotor,
      potonganKasPersen: POTONGAN_KAS_PERSEN,
      kasOperasional,
      beratSetor: round3(setor.berat),
      penjualan: totalPenjualan,
      beratJual: round3(penjualan.berat),
      totalSusutKg,
      penarikan: totalPenarikan,
      totalSaldoNasabah,
      saldoKas,
      arusKasPenjualan,
      marginKotor,
      totalStokKg,
      schedule,
      stok,
      recent,
      chart,
      monthlyTrend
    });
  }
);

// ===========================
// NASABAH CRUD
// ===========================

app.get(
  "/api/nasabah",
  auth,
  allow("Ketua", "Bendahara", "Petugas Timbang"),
  async (_req, res) => {
    const rows = await q(`
      SELECT
        n.id_nasabah,
        n.id_user,
        n.no_buku,
        n.nama,
        n.alamat,
        n.no_hp,
        n.saldo,
        n.created_at,
        u.username,
        u.is_active AS user_active,
        COALESCE(s.cnt, 0)::int AS jumlah_setoran,
        COALESCE(p.cnt, 0)::int AS jumlah_penarikan
      FROM nasabah n
      LEFT JOIN users u ON u.id_user = n.id_user
      LEFT JOIN (
        SELECT id_nasabah, COUNT(*) AS cnt FROM transaksi_setor GROUP BY id_nasabah
      ) s ON s.id_nasabah = n.id_nasabah
      LEFT JOIN (
        SELECT id_nasabah, COUNT(*) AS cnt FROM transaksi_penarikan GROUP BY id_nasabah
      ) p ON p.id_nasabah = n.id_nasabah
      ORDER BY n.id_nasabah DESC
    `);

    res.json(rows);
  }
);

app.post(
  "/api/nasabah",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const no_buku = cleanText(req.body?.no_buku, 40);
    const nama = cleanText(req.body?.nama, 120);
    const alamat = cleanText(req.body?.alamat, 255);
    const no_hp = cleanText(req.body?.no_hp, 24);
    const createAccount = Boolean(req.body?.create_account);
    const username = cleanText(req.body?.username, 32).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!no_buku || !nama) {
      return res.status(400).json({
        error: "Nomor buku dan nama nasabah wajib diisi."
      });
    }

    if (!validPhone(no_hp)) {
      return res.status(400).json({
        error: "Format nomor HP tidak valid."
      });
    }

    if (createAccount) {
      if (!validUsername(username)) {
        return res.status(400).json({
          error: "Username akun nasabah harus 3–32 karakter (huruf, angka, titik, _, -)."
        });
      }
      const strengthError = validatePasswordStrength(password);
      if (strengthError) {
        return res.status(400).json({ error: strengthError });
      }
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      let newUserId = null;
      if (createAccount) {
        const dupUser = await client.query(
          "SELECT id_user FROM users WHERE LOWER(username) = LOWER($1)",
          [username]
        );
        if (dupUser.rows.length) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: "Username akun nasabah sudah digunakan."
          });
        }

        const hash = await bcrypt.hash(password, 12);
        const userRes = await client.query(
          `INSERT INTO users(username, password, role, nama_user, must_change_password)
           VALUES($1, $2, 'Nasabah', $3, TRUE)
           RETURNING id_user`,
          [username, hash, nama]
        );
        newUserId = userRes.rows[0].id_user;
      }

      const nasabahRes = await client.query(
        `INSERT INTO nasabah(id_user, no_buku, nama, alamat, no_hp)
         VALUES($1, $2, $3, $4, $5)
         RETURNING *`,
        [newUserId, no_buku, nama, alamat, no_hp]
      );

      const created = nasabahRes.rows[0];

      await recordAudit(client, {
        req,
        action: "NASABAH_CREATE",
        entity: "nasabah",
        entityId: created.id_nasabah,
        detail: `Tambah nasabah ${nama} (${no_buku})${createAccount ? ` + akun login "${username}"` : ""}`
      });

      await client.query("COMMIT");

      res.status(201).json({
        ok: true,
        message: createAccount
          ? "Nasabah dan akun login berhasil ditambahkan."
          : "Nasabah berhasil ditambahkan.",
        data: created
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        return res.status(409).json({
          error: "Nomor buku atau username sudah digunakan."
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }
);

app.put(
  "/api/nasabah/:id",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID nasabah tidak valid." });
    }

    const no_buku = cleanText(req.body?.no_buku, 40);
    const nama = cleanText(req.body?.nama, 120);
    const alamat = cleanText(req.body?.alamat, 255);
    const no_hp = cleanText(req.body?.no_hp, 24);
    const createAccount = Boolean(req.body?.create_account);
    const username = cleanText(req.body?.username, 32).toLowerCase();
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!no_buku || !nama) {
      return res.status(400).json({
        error: "Nomor buku dan nama nasabah wajib diisi."
      });
    }

    if (!validPhone(no_hp)) {
      return res.status(400).json({ error: "Format nomor HP tidak valid." });
    }

    if (createAccount) {
      if (!validUsername(username)) {
        return res.status(400).json({
          error: "Username akun nasabah harus 3–32 karakter (huruf, angka, titik, _, -)."
        });
      }
      const strengthError = validatePasswordStrength(password);
      if (strengthError) {
        return res.status(400).json({ error: strengthError });
      }
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const currentRes = await client.query(
        "SELECT * FROM nasabah WHERE id_nasabah = $1 FOR UPDATE",
        [id]
      );
      const current = currentRes.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Nasabah tidak ditemukan." });
      }

      let linkedUserId = current.id_user;

      if (createAccount && !linkedUserId) {
        const dupUser = await client.query(
          "SELECT id_user FROM users WHERE LOWER(username) = LOWER($1)",
          [username]
        );
        if (dupUser.rows.length) {
          await client.query("ROLLBACK");
          return res.status(409).json({ error: "Username sudah digunakan." });
        }

        const hash = await bcrypt.hash(password, 12);
        const userRes = await client.query(
          `INSERT INTO users(username, password, role, nama_user, must_change_password)
           VALUES($1, $2, 'Nasabah', $3, TRUE)
           RETURNING id_user`,
          [username, hash, nama]
        );
        linkedUserId = userRes.rows[0].id_user;
      } else if (linkedUserId) {
        await client.query(
          "UPDATE users SET nama_user = $1 WHERE id_user = $2",
          [nama, linkedUserId]
        );
      }

      const updatedRes = await client.query(
        `UPDATE nasabah
         SET no_buku = $1, nama = $2, alamat = $3, no_hp = $4, id_user = $5
         WHERE id_nasabah = $6
         RETURNING *`,
        [no_buku, nama, alamat, no_hp, linkedUserId, id]
      );

      await recordAudit(client, {
        req,
        action: "NASABAH_UPDATE",
        entity: "nasabah",
        entityId: id,
        detail: `Ubah data nasabah ${nama} (${no_buku})`
      });

      await client.query("COMMIT");

      res.json({
        ok: true,
        message: "Data nasabah berhasil diperbarui.",
        data: updatedRes.rows[0]
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        return res.status(409).json({
          error: "Nomor buku sudah digunakan oleh nasabah lain."
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/nasabah/:id",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID nasabah tidak valid." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const currentRes = await client.query(
        "SELECT * FROM nasabah WHERE id_nasabah = $1 FOR UPDATE",
        [id]
      );
      const current = currentRes.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Nasabah tidak ditemukan." });
      }

      if (num(current.saldo) > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Nasabah masih memiliki saldo aktif. Tarik/kosongkan saldo terlebih dahulu."
        });
      }

      const txCheck = await client.query(
        `SELECT
           (SELECT COUNT(*)::int FROM transaksi_setor WHERE id_nasabah = $1) AS setor_cnt,
           (SELECT COUNT(*)::int FROM transaksi_penarikan WHERE id_nasabah = $1) AS tarik_cnt`,
        [id]
      );

      if (txCheck.rows[0].setor_cnt > 0 || txCheck.rows[0].tarik_cnt > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: "Nasabah yang sudah memiliki riwayat transaksi tidak dapat dihapus demi integritas pembukuan."
        });
      }

      await client.query("DELETE FROM nasabah WHERE id_nasabah = $1", [id]);

      await recordAudit(client, {
        req,
        action: "NASABAH_DELETE",
        entity: "nasabah",
        entityId: id,
        detail: `Hapus nasabah ${current.nama} (${current.no_buku})`
      });

      await client.query("COMMIT");

      res.json({ ok: true, message: "Data nasabah berhasil dihapus." });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

app.get(
  "/api/nasabah/:id/riwayat",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID nasabah tidak valid." });
    }

    const customer = await one(
      `SELECT n.*, u.username
       FROM nasabah n
       LEFT JOIN users u ON u.id_user = n.id_user
       WHERE n.id_nasabah = $1`,
      [id]
    );

    if (!customer) {
      return res.status(404).json({ error: "Nasabah tidak ditemukan." });
    }

    const items = await q(
      `SELECT
         id_setor AS id,
         TO_CHAR(tanggal, 'YYYY-MM-DD') AS tanggal,
         created_at,
         jenis_sampah,
         berat_awal AS berat,
         nilai_setor AS nilai,
         petugas,
         '' AS keterangan,
         'Setoran' AS tipe
       FROM transaksi_setor
       WHERE id_nasabah = $1

       UNION ALL

       SELECT
         id_penarikan AS id,
         TO_CHAR(tanggal, 'YYYY-MM-DD') AS tanggal,
         created_at,
         '-' AS jenis_sampah,
         0 AS berat,
         jumlah AS nilai,
         petugas,
         keterangan,
         'Penarikan' AS tipe
       FROM transaksi_penarikan
       WHERE id_nasabah = $1

       ORDER BY tanggal DESC, created_at DESC, id DESC`,
      [id]
    );

    res.json({ customer, items });
  }
);

// ===========================
// H1: HARGA SAMPAH & HARGA PERIODE BULANAN
// ===========================

app.get("/api/harga", auth, async (req, res) => {
  const now = witaNowParts();
  await ensurePeriodPrices(now.year, now.month);

  if (req.user.role === "Nasabah") {
    const rows = await q(
      `SELECT
         h.id_harga,
         h.jenis_sampah,
         COALESCE(hp.harga_per_kg, h.harga_per_kg) AS harga_per_kg,
         hp.bulan,
         hp.tahun,
         TO_CHAR(COALESCE(hp.ditetapkan_pada::date, h.tgl_mulai), 'YYYY-MM-DD') AS tgl_mulai
       FROM harga_sampah h
       LEFT JOIN harga_periode hp
         ON hp.id_harga = h.id_harga AND hp.bulan = $1 AND hp.tahun = $2
       ORDER BY h.id_harga`,
      [now.month, now.year]
    );
    return res.json(rows);
  }

  const rows = await getWasteStock();
  res.json(rows);
});

app.get(
  "/api/harga-periode",
  auth,
  allow("Ketua", "Bendahara", "Petugas Timbang"),
  async (req, res) => {
    const now = witaNowParts();
    const mVal = Number(req.query.month);
    const yVal = Number(req.query.year);
    const month = Number.isInteger(mVal) && mVal >= 1 && mVal <= 12 ? mVal : now.month;
    const year = Number.isInteger(yVal) && yVal >= 2000 && yVal <= 2100 ? yVal : now.year;

    const { hasTransactions, txCount } = await ensurePeriodPrices(year, month);

    const rows = await q(
      `SELECT
         hp.id_periode,
         hp.id_harga,
         h.jenis_sampah,
         hp.bulan,
         hp.tahun,
         hp.harga_per_kg,
         hp.status,
         hp.ditetapkan_oleh,
         hp.ditetapkan_pada,
         GREATEST(
           0,
           COALESCE(s.berat_masuk, 0) - COALESCE(j.berat_keluar_gudang, 0)
         ) AS stok_kg
       FROM harga_periode hp
       JOIN harga_sampah h ON h.id_harga = hp.id_harga
       LEFT JOIN (
         SELECT jenis_sampah, SUM(berat_awal) AS berat_masuk
         FROM transaksi_setor
         GROUP BY jenis_sampah
       ) s ON s.jenis_sampah = h.jenis_sampah
       LEFT JOIN (
         SELECT jenis_sampah, SUM(berat_gudang) AS berat_keluar_gudang
         FROM detail_penjualan
         GROUP BY jenis_sampah
       ) j ON j.jenis_sampah = h.jenis_sampah
       WHERE hp.bulan = $1 AND hp.tahun = $2
       ORDER BY h.id_harga`,
      [month, year]
    );

    const isPastPeriod =
      year < now.year || (year === now.year && month < now.month);
    const isLocked =
      isPastPeriod ||
      hasTransactions ||
      rows.some(r => r.status === "terkunci");

    const historyPeriods = await q(`
      SELECT
        tahun,
        bulan,
        CASE WHEN BOOL_OR(status = 'terkunci') THEN 'terkunci' ELSE 'draft' END AS status,
        COUNT(*)::int AS jumlah_jenis,
        MAX(ditetapkan_oleh) AS ditetapkan_oleh,
        MAX(ditetapkan_pada) AS ditetapkan_pada
      FROM harga_periode
      GROUP BY tahun, bulan
      ORDER BY tahun DESC, bulan DESC
      LIMIT 24
    `);

    res.json({
      month,
      year,
      currentMonth: now.month,
      currentYear: now.year,
      isPastPeriod,
      hasTransactions,
      txCount,
      isLocked,
      rows: rows.map(r => ({
        ...r,
        harga_per_kg: num(r.harga_per_kg),
        stok_kg: round3(r.stok_kg)
      })),
      historyPeriods
    });
  }
);

app.put(
  "/api/harga-periode",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const now = witaNowParts();
    const month = Number(req.body?.month);
    const year = Number(req.body?.year);
    const items = req.body?.items;
    const lock = Boolean(req.body?.lock);

    if (
      !Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(year) || year < 2000 || year > 2100
    ) {
      return res.status(400).json({ error: "Periode bulan dan tahun tidak valid." });
    }

    if (year < now.year || (year === now.year && month < now.month)) {
      return res.status(400).json({
        error: "Harga periode bulan yang sudah lewat tidak dapat diubah demi integritas setoran lama."
      });
    }

    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: "Daftar harga periode wajib diisi." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { hasTransactions } = await ensurePeriodPrices(
        year,
        month,
        client,
        req.user.nama_user
      );

      const lockedCheck = await client.query(
        `SELECT COUNT(*)::int AS cnt
         FROM harga_periode
         WHERE bulan = $1 AND tahun = $2 AND status = 'terkunci'`,
        [month, year]
      );

      const periodName = `${MONTH_NAMES_ID[month - 1]} ${year}`;

      if (hasTransactions || Number(lockedCheck.rows[0]?.cnt || 0) > 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Harga periode ${periodName} sudah ditetapkan/terkunci dan tidak dapat diubah lagi. Silakan tetapkan harga baru pada periode awal bulan berikutnya.`
        });
      }

      const nextStatus = lock ? "terkunci" : "draft";
      const isCurrentMonth = year === now.year && month === now.month;
      const changes = [];

      for (const item of items) {
        const idHarga = parsePositiveInt(item?.id_harga);
        const priceValue = item?.harga_per_kg;
        if (
          !idHarga ||
          !validNumber(priceValue) ||
          Number(priceValue) < 0 ||
          Number(priceValue) > 100_000_000
        ) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Terdapat nilai harga yang tidak valid." });
        }

        const nextPrice = round2(priceValue);
        const updated = await client.query(
          `UPDATE harga_periode
           SET harga_per_kg = $1,
               status = $2,
               ditetapkan_oleh = $3,
               ditetapkan_pada = NOW()
           WHERE id_harga = $4 AND bulan = $5 AND tahun = $6
           RETURNING jenis_sampah`,
          [nextPrice, nextStatus, req.user.nama_user, idHarga, month, year]
        );

        if (updated.rows.length) {
          changes.push(`${updated.rows[0].jenis_sampah}: Rp ${formatRupiah(nextPrice)}`);
          if (isCurrentMonth) {
            await client.query(
              "UPDATE harga_sampah SET harga_per_kg = $1, tgl_mulai = $2 WHERE id_harga = $3",
              [nextPrice, today(), idHarga]
            );
          }
        }
      }

      await notify(
        {
          message: lock
            ? `Harga sampah periode ${periodName} resmi ditetapkan & dikunci oleh ${req.user.nama_user}.`
            : `Draft harga sampah periode ${periodName} diperbarui oleh ${req.user.nama_user}.`,
          type: "info",
          audience: "staff"
        },
        client
      );

      await recordAudit(client, {
        req,
        action: lock ? "HARGA_PERIODE_LOCK" : "HARGA_PERIODE_SET",
        entity: "harga_periode",
        entityId: `${year}-${String(month).padStart(2, "0")}`,
        detail: `Periode ${periodName} (${nextStatus}): ${changes.slice(0, 6).join(", ")}`
      });

      await client.query("COMMIT");

      res.json({
        ok: true,
        message: lock
          ? `Harga periode ${periodName} berhasil ditetapkan dan dikunci.`
          : `Draft harga periode ${periodName} berhasil disimpan.`
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

app.post(
  "/api/harga",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const jenis_sampah = cleanText(req.body?.jenis_sampah, 80);
    const priceValue = req.body?.harga_per_kg;

    if (!jenis_sampah) {
      return res.status(400).json({ error: "Nama jenis sampah wajib diisi." });
    }

    if (!validNumber(priceValue) || Number(priceValue) < 0 || Number(priceValue) > 100_000_000) {
      return res.status(400).json({ error: "Harga per kilogram tidak valid." });
    }

    const now = witaNowParts();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const createdRes = await client.query(
        `INSERT INTO harga_sampah(jenis_sampah, harga_per_kg, tgl_mulai)
         VALUES($1, $2, $3)
         RETURNING id_harga, jenis_sampah, harga_per_kg, TO_CHAR(tgl_mulai, 'YYYY-MM-DD') AS tgl_mulai`,
        [jenis_sampah, round2(priceValue), today()]
      );
      const created = createdRes.rows[0];

      // Tambahkan langsung ke harga_periode bulan berjalan agar segera bisa dipakai
      const lockCheck = await client.query(
        `SELECT BOOL_OR(status = 'terkunci') AS locked
         FROM harga_periode
         WHERE bulan = $1 AND tahun = $2`,
        [now.month, now.year]
      );
      const curStatus = lockCheck.rows[0]?.locked ? "terkunci" : "draft";

      await client.query(
        `INSERT INTO harga_periode(id_harga, jenis_sampah, bulan, tahun, harga_per_kg, status, ditetapkan_oleh)
         VALUES($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id_harga, bulan, tahun) DO NOTHING`,
        [created.id_harga, jenis_sampah, now.month, now.year, round2(priceValue), curStatus, req.user.nama_user]
      );

      await notify(
        {
          message: `Jenis sampah baru "${jenis_sampah}" ditambahkan dengan harga Rp ${formatRupiah(priceValue)}/kg.`,
          type: "info",
          audience: "staff"
        },
        client
      );

      await recordAudit(client, {
        req,
        action: "HARGA_CREATE",
        entity: "harga_sampah",
        entityId: created.id_harga,
        detail: `Tambah jenis sampah "${jenis_sampah}" Rp ${formatRupiah(priceValue)}/kg`
      });

      await client.query("COMMIT");

      res.status(201).json({
        ok: true,
        message: "Jenis sampah berhasil ditambahkan.",
        data: created
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        return res.status(409).json({
          error: "Jenis sampah dengan nama tersebut sudah ada."
        });
      }
      throw error;
    } finally {
      client.release();
    }
  }
);

app.put(
  "/api/harga/:id",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const priceValue = req.body?.harga_per_kg;
    const now = witaNowParts();
    const month = Number.isInteger(Number(req.body?.month)) && Number(req.body?.month) >= 1 && Number(req.body?.month) <= 12
      ? Number(req.body?.month)
      : now.month;
    const year = Number.isInteger(Number(req.body?.year)) && Number(req.body?.year) >= 2000 && Number(req.body?.year) <= 2100
      ? Number(req.body?.year)
      : now.year;

    if (!id) {
      return res.status(400).json({ error: "ID harga tidak valid." });
    }

    if (!validNumber(priceValue) || Number(priceValue) < 0 || Number(priceValue) > 100_000_000) {
      return res.status(400).json({ error: "Harga tidak valid." });
    }

    if (year < now.year || (year === now.year && month < now.month)) {
      return res.status(400).json({
        error: "Harga periode bulan lalu tidak dapat diubah."
      });
    }

    const { hasTransactions } = await ensurePeriodPrices(year, month);
    const periodRow = await one(
      `SELECT id_periode, jenis_sampah, harga_per_kg, status
       FROM harga_periode
       WHERE id_harga = $1 AND bulan = $2 AND tahun = $3`,
      [id, month, year]
    );

    if (!periodRow) {
      return res.status(404).json({
        error: "Data harga sampah tidak ditemukan."
      });
    }

    const periodName = `${MONTH_NAMES_ID[month - 1]} ${year}`;
    if (hasTransactions || periodRow.status === "terkunci") {
      return res.status(400).json({
        error: `Harga periode ${periodName} sudah terkunci. Tetapkan harga baru pada periode awal bulan berikutnya.`
      });
    }

    const nextPrice = round2(priceValue);
    await q(
      `UPDATE harga_periode
       SET harga_per_kg = $1, ditetapkan_oleh = $2, ditetapkan_pada = NOW()
       WHERE id_periode = $3`,
      [nextPrice, req.user.nama_user, periodRow.id_periode]
    );

    if (year === now.year && month === now.month) {
      await q(
        "UPDATE harga_sampah SET harga_per_kg = $1, tgl_mulai = $2 WHERE id_harga = $3",
        [nextPrice, today(), id]
      );
    }

    await notify({
      message: `Draft harga ${periodRow.jenis_sampah} (${periodName}) diubah dari Rp ${formatRupiah(periodRow.harga_per_kg)} menjadi Rp ${formatRupiah(nextPrice)}/kg.`,
      type: "info",
      audience: "staff"
    });

    await recordAudit(pool, {
      req,
      action: "HARGA_UPDATE",
      entity: "harga_periode",
      entityId: periodRow.id_periode,
      detail: `${periodRow.jenis_sampah} (${periodName}): Rp ${formatRupiah(periodRow.harga_per_kg)} -> Rp ${formatRupiah(nextPrice)}/kg`
    });

    res.json({
      ok: true,
      message: `Harga ${periodRow.jenis_sampah} periode ${periodName} diperbarui.`
    });
  }
);

app.delete(
  "/api/harga/:id",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID harga tidak valid." });
    }

    const current = await one(
      "SELECT id_harga, jenis_sampah FROM harga_sampah WHERE id_harga = $1",
      [id]
    );
    if (!current) {
      return res.status(404).json({ error: "Data harga sampah tidak ditemukan." });
    }

    const used = await one(
      `SELECT
         (SELECT COUNT(*)::int FROM transaksi_setor WHERE id_harga = $1 OR jenis_sampah = $2) AS setor_cnt,
         (SELECT COUNT(*)::int FROM detail_penjualan WHERE id_harga = $1 OR jenis_sampah = $2) AS jual_cnt`,
      [id, current.jenis_sampah]
    );

    if (used.setor_cnt > 0 || used.jual_cnt > 0) {
      return res.status(400).json({
        error: `Jenis sampah "${current.jenis_sampah}" sudah pernah dipakai dalam transaksi dan tidak dapat dihapus.`
      });
    }

    await q("DELETE FROM harga_sampah WHERE id_harga = $1", [id]);

    await recordAudit(pool, {
      req,
      action: "HARGA_DELETE",
      entity: "harga_sampah",
      entityId: id,
      detail: `Hapus jenis sampah "${current.jenis_sampah}"`
    });

    res.json({ ok: true, message: "Jenis sampah berhasil dihapus." });
  }
);

// ===========================
// H1 & H3: SETORAN SAMPAH (HARGA PERIODE + POTONGAN 10% KAS : 90% NASABAH)
// ===========================

app.get(
  "/api/setoran",
  auth,
  allow("Ketua", "Bendahara", "Petugas Timbang"),
  async (_req, res) => {
    const rows = await q(`
      SELECT
        t.id_setor,
        t.id_nasabah,
        t.id_periode,
        n.no_buku,
        n.nama AS nama_nasabah,
        TO_CHAR(t.tanggal, 'YYYY-MM-DD') AS tanggal,
        t.jenis_sampah,
        t.berat_awal,
        t.harga,
        COALESCE(t.nilai_kotor, t.nilai_setor) AS nilai_kotor,
        COALESCE(t.persen_potongan, 0) AS persen_potongan,
        COALESCE(t.potongan_kas, 0) AS potongan_kas,
        COALESCE(t.nilai_nasabah, t.nilai_setor) AS nilai_nasabah,
        t.nilai_setor,
        t.petugas,
        t.created_at
      FROM transaksi_setor t
      JOIN nasabah n ON n.id_nasabah = t.id_nasabah
      ORDER BY t.tanggal DESC, t.id_setor DESC
      LIMIT 120
    `);

    res.json(rows);
  }
);

app.post(
  "/api/setoran",
  auth,
  allow("Ketua", "Petugas Timbang", "Bendahara"),
  async (req, res) => {
    const id_nasabah = parsePositiveInt(req.body?.id_nasabah);
    const tanggal = cleanText(req.body?.tanggal || "", 10);
    const items = req.body?.items;

    if (!id_nasabah || !Array.isArray(items) || !items.length || !validDate(tanggal)) {
      return res.status(400).json({
        error: "Data setoran tidak valid."
      });
    }

    const validItems = [];
    for (const item of items) {
      const beratInput = item?.berat;
      if (!validNumber(beratInput)) {
        return res.status(400).json({
          error: "Berat sampah harus berupa angka yang valid."
        });
      }

      const berat = round3(beratInput);
      if (berat < 0) {
        return res.status(400).json({
          error: "Berat sampah tidak boleh negatif."
        });
      }
      if (berat === 0) continue;
      if (berat > 100_000) {
        return res.status(400).json({
          error: "Berat sampah melebihi batas wajar (maks. 100.000 kg per item)."
        });
      }

      const jenis = cleanText(item?.jenis, 80);
      if (!jenis) {
        return res.status(400).json({ error: "Jenis sampah wajib dipilih." });
      }

      validItems.push({ jenis, berat });
    }

    if (!validItems.length) {
      return res.status(400).json({
        error: "Masukkan minimal satu berat sampah lebih dari 0 kg."
      });
    }

    const transactionDate = tanggal || today();
    const { year: txYear, month: txMonth } = extractYearMonth(transactionDate);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const customerResult = await client.query(
        "SELECT * FROM nasabah WHERE id_nasabah = $1 FOR UPDATE",
        [id_nasabah]
      );

      const customer = customerResult.rows[0];
      if (!customer) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Nasabah tidak ditemukan." });
      }

      // H1: Pastikan harga_periode tersedia untuk bulan/tahun transaksi & kunci periode tersebut
      await ensurePeriodPrices(txYear, txMonth, client, req.user.nama_user);

      let totalKotor = 0;
      let totalPotonganKas = 0;
      let totalNasabah = 0;
      const recordedItems = [];

      for (const item of validItems) {
        const priceResult = await client.query(
          `SELECT
             h.id_harga,
             hp.id_periode,
             COALESCE(hp.harga_per_kg, h.harga_per_kg) AS harga_per_kg
           FROM harga_sampah h
           LEFT JOIN harga_periode hp
             ON hp.id_harga = h.id_harga AND hp.bulan = $2 AND hp.tahun = $3
           WHERE h.jenis_sampah = $1`,
          [item.jenis, txMonth, txYear]
        );
        const price = priceResult.rows[0];

        if (!price) {
          throw new Error(`Harga untuk jenis sampah "${item.jenis}" belum tersedia.`);
        }

        // H3: Pembagian 10% Kas Operasional : 90% Saldo Nasabah
        const split = computeSetoranSplit(item.berat, price.harga_per_kg, POTONGAN_KAS_PERSEN);

        if (!Number.isFinite(split.nilai_kotor) || !Number.isFinite(totalKotor + split.nilai_kotor)) {
          throw new Error("Perhitungan nilai setoran tidak valid.");
        }

        totalKotor = round2(totalKotor + split.nilai_kotor);
        totalPotonganKas = round2(totalPotonganKas + split.potongan_kas);
        totalNasabah = round2(totalNasabah + split.nilai_nasabah);

        const inserted = await client.query(
          `INSERT INTO transaksi_setor
           (
             id_nasabah, id_harga, id_periode, tanggal, jenis_sampah, berat_awal, harga,
             nilai_kotor, persen_potongan, potongan_kas, nilai_nasabah, nilai_setor, petugas
           )
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING id_setor`,
          [
            id_nasabah,
            price.id_harga,
            price.id_periode || null,
            transactionDate,
            item.jenis,
            split.berat,
            split.harga,
            split.nilai_kotor,
            split.persen_potongan,
            split.potongan_kas,
            split.nilai_nasabah,
            split.nilai_nasabah,
            req.user.nama_user
          ]
        );

        recordedItems.push({
          id_setor: inserted.rows[0].id_setor,
          jenis_sampah: item.jenis,
          berat: split.berat,
          harga: split.harga,
          nilai_kotor: split.nilai_kotor,
          potongan_kas: split.potongan_kas,
          nilai_nasabah: split.nilai_nasabah,
          nilai: split.nilai_nasabah
        });
      }

      // H1: Kunci harga periode bulan transaksi karena sudah dipakai pada setoran
      await client.query(
        `UPDATE harga_periode
         SET status = 'terkunci'
         WHERE bulan = $1 AND tahun = $2 AND status <> 'terkunci'`,
        [txMonth, txYear]
      );

      // H3: Hanya 90% (totalNasabah) yang masuk menambah saldo nasabah
      const saldoRes = await client.query(
        `UPDATE nasabah
         SET saldo = saldo + $1
         WHERE id_nasabah = $2
         RETURNING saldo`,
        [totalNasabah, id_nasabah]
      );

      const newSaldo = round2(saldoRes.rows[0].saldo);
      const summaryJenis = recordedItems
        .map(i => `${i.jenis_sampah} ${i.berat} kg`)
        .join(", ");

      await notify(
        {
          message: `Setoran ${customer.nama} (${summaryJenis}) berhasil. Kotor Rp ${formatRupiah(totalKotor)} · Kas 10% Rp ${formatRupiah(totalPotonganKas)} · Saldo Nasabah (90%) +Rp ${formatRupiah(totalNasabah)}.`,
          type: "success",
          audience: "all",
          id_nasabah
        },
        client
      );

      await recordAudit(client, {
        req,
        action: "SETORAN_CREATE",
        entity: "transaksi_setor",
        entityId: recordedItems[0]?.id_setor || "",
        detail: `${customer.nama} (${customer.no_buku}): ${summaryJenis} | Kotor Rp ${formatRupiah(totalKotor)} | Kas 10% Rp ${formatRupiah(totalPotonganKas)} | Nasabah 90% Rp ${formatRupiah(totalNasabah)}`
      });

      await client.query("COMMIT");

      res.status(201).json({
        ok: true,
        total: totalNasabah,
        total_kotor: totalKotor,
        potongan_kas: totalPotonganKas,
        total_nasabah: totalNasabah,
        receipt: {
          tipe: "Setoran Sampah",
          tanggal: transactionDate,
          periode: `${MONTH_NAMES_ID[txMonth - 1]} ${txYear}`,
          no_buku: customer.no_buku,
          nama_nasabah: customer.nama,
          petugas: req.user.nama_user,
          items: recordedItems,
          persen_potongan: POTONGAN_KAS_PERSEN,
          total_kotor: totalKotor,
          total_potongan_kas: totalPotonganKas,
          total_nasabah: totalNasabah,
          total: totalNasabah,
          saldo_akhir: newSaldo
        }
      });
    } catch (error) {
      await client.query("ROLLBACK");

      if (
        error.message?.startsWith("Harga untuk jenis sampah") ||
        error.message === "Perhitungan nilai setoran tidak valid."
      ) {
        return res.status(400).json({ error: error.message });
      }

      throw error;
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/setoran/:id",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID setoran tidak valid." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const txRes = await client.query(
        "SELECT * FROM transaksi_setor WHERE id_setor = $1 FOR UPDATE",
        [id]
      );
      const tx = txRes.rows[0];
      if (!tx) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Transaksi setoran tidak ditemukan." });
      }

      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`stok:${tx.jenis_sampah}`]
      );

      const availableStock = await getAvailableStockForType(client, tx.jenis_sampah);
      if (availableStock + 0.0005 < num(tx.berat_awal)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Setoran tidak dapat dibatalkan karena sebagian stok ${tx.jenis_sampah} (${tx.berat_awal} kg) sudah dijual ke pengepul. Stok tersisa: ${availableStock} kg.`
        });
      }

      const custRes = await client.query(
        "SELECT * FROM nasabah WHERE id_nasabah = $1 FOR UPDATE",
        [tx.id_nasabah]
      );
      const customer = custRes.rows[0];
      const nasabahCredit = round2(tx.nilai_nasabah ?? tx.nilai_setor);

      if (num(customer.saldo) < nasabahCredit) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Setoran tidak dapat dibatalkan karena saldo ${customer.nama} (Rp ${formatRupiah(customer.saldo)}) lebih kecil dari hak nasabah pada setoran ini (Rp ${formatRupiah(nasabahCredit)}).`
        });
      }

      await client.query(
        "UPDATE nasabah SET saldo = saldo - $1 WHERE id_nasabah = $2",
        [nasabahCredit, tx.id_nasabah]
      );

      await client.query("DELETE FROM transaksi_setor WHERE id_setor = $1", [id]);

      await notify(
        {
          message: `Setoran ${tx.jenis_sampah} ${tx.berat_awal} kg milik ${customer.nama} (hak nasabah Rp ${formatRupiah(nasabahCredit)}) dibatalkan oleh ${req.user.nama_user}.`,
          type: "warning",
          audience: "all",
          id_nasabah: tx.id_nasabah
        },
        client
      );

      await recordAudit(client, {
        req,
        action: "SETORAN_VOID",
        entity: "transaksi_setor",
        entityId: id,
        detail: `Batalkan setoran #${id} (${customer.nama}, ${tx.jenis_sampah} ${tx.berat_awal} kg, hak nasabah Rp ${formatRupiah(nasabahCredit)})`
      });

      await client.query("COMMIT");

      res.json({
        ok: true,
        message: "Transaksi setoran berhasil dibatalkan dan saldo nasabah serta kas 10% telah disesuaikan."
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

// ===========================
// PENGATURAN KEBIJAKAN OPERASIONAL
// ===========================

app.get("/api/settings", auth, async (_req, res) => {
  const minPenarikan = await getMinPenarikan();
  res.json({ min_penarikan: minPenarikan });
});

app.put(
  "/api/settings/penarikan",
  auth,
  allow("Ketua"),
  async (req, res) => {
    const rawMin = req.body?.min_penarikan;
    if (!validNumber(rawMin) || Number(rawMin) < 0 || Number(rawMin) > 100_000_000) {
      return res.status(400).json({
        error: "Nominal minimum penarikan tidak valid (minimal Rp 0)."
      });
    }

    const nextMin = round2(rawMin);
    const prevMin = await getMinPenarikan();

    await q(
      `INSERT INTO pengaturan(key, value, updated_at)
       VALUES('min_penarikan', $1, NOW())
       ON CONFLICT(key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [String(nextMin)]
    );

    await notify({
      message: `Batas minimum penarikan saldo diperbarui dari Rp ${formatRupiah(prevMin)} menjadi Rp ${formatRupiah(nextMin)}.`,
      type: "info",
      audience: "staff"
    });

    await recordAudit(pool, {
      req,
      action: "SETTINGS_UPDATE",
      entity: "pengaturan",
      entityId: "min_penarikan",
      detail: `Minimum penarikan: Rp ${formatRupiah(prevMin)} -> Rp ${formatRupiah(nextMin)}`
    });

    res.json({
      ok: true,
      message: `Batas minimum penarikan berhasil diperbarui menjadi Rp ${formatRupiah(nextMin)}.`,
      min_penarikan: nextMin
    });
  }
);

// ===========================
// H2: PENARIKAN SALDO (MIN Rp50.000, MAKS 1x/BULAN, PENGECUALIAN DESEMBER)
// ===========================

app.get(
  "/api/penarikan",
  auth,
  allow("Ketua", "Bendahara"),
  async (_req, res) => {
    const rows = await q(`
      SELECT
        p.id_penarikan,
        p.id_nasabah,
        n.no_buku,
        n.nama AS nama_nasabah,
        TO_CHAR(p.tanggal, 'YYYY-MM-DD') AS tanggal,
        p.jumlah,
        p.keterangan,
        p.petugas,
        COALESCE(p.is_penarikan_desember, FALSE) AS is_penarikan_desember,
        p.created_at
      FROM transaksi_penarikan p
      JOIN nasabah n ON n.id_nasabah = p.id_nasabah
      ORDER BY p.tanggal DESC, p.id_penarikan DESC
      LIMIT 120
    `);

    res.json(rows);
  }
);

app.post(
  "/api/penarikan",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const id_nasabah = parsePositiveInt(req.body?.id_nasabah);
    const jumlah = req.body?.jumlah;
    const tanggal = cleanText(req.body?.tanggal || "", 10);
    const keterangan = cleanText(req.body?.keterangan || "", 300);

    if (!validNumber(jumlah) || !validDate(tanggal)) {
      return res.status(400).json({
        error: "Jumlah atau tanggal penarikan tidak valid."
      });
    }

    const amount = round2(jumlah);
    if (!id_nasabah || amount <= 0 || amount > 1_000_000_000) {
      return res.status(400).json({
        error: "Data penarikan tidak valid."
      });
    }

    const transactionDate = tanggal || today();
    const { year: txYear, month: txMonth } = extractYearMonth(transactionDate);
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const customerResult = await client.query(
        "SELECT * FROM nasabah WHERE id_nasabah = $1 FOR UPDATE",
        [id_nasabah]
      );

      const customer = customerResult.rows[0];
      if (!customer) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Nasabah tidak ditemukan." });
      }

      const minPenarikan = await getMinPenarikan(client);

      // H2: Cek frekuensi penarikan pada bulan & tahun transaksi (maks. 1x per bulan)
      const freqRes = await client.query(
        `SELECT COUNT(*)::int AS cnt
         FROM transaksi_penarikan
         WHERE id_nasabah = $1
           AND EXTRACT(YEAR FROM tanggal) = $2
           AND EXTRACT(MONTH FROM tanggal) = $3`,
        [id_nasabah, txYear, txMonth]
      );
      const alreadyWithdrawnThisMonth = Number(freqRes.rows[0]?.cnt || 0);

      const ruleCheck = validatePenarikanRules({
        amount,
        saldo: customer.saldo,
        transactionDate,
        minPenarikan,
        alreadyWithdrawnThisMonth
      });

      if (!ruleCheck.ok) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: ruleCheck.error });
      }

      const finalKeterangan =
        keterangan ||
        (ruleCheck.isFullDecemberWithdraw
          ? "Penarikan akhir tahun (pengecualian bulan Desember)"
          : "");

      const inserted = await client.query(
        `INSERT INTO transaksi_penarikan
         (id_nasabah, id_user, tanggal, jumlah, keterangan, petugas, is_penarikan_desember)
         VALUES($1, $2, $3, $4, $5, $6, $7)
         RETURNING id_penarikan`,
        [
          id_nasabah,
          req.user.id,
          transactionDate,
          amount,
          finalKeterangan,
          req.user.nama_user,
          ruleCheck.isDesember
        ]
      );

      const saldoRes = await client.query(
        `UPDATE nasabah
         SET saldo = saldo - $1
         WHERE id_nasabah = $2
         RETURNING saldo`,
        [amount, id_nasabah]
      );

      const saldoSisa = round2(saldoRes.rows[0].saldo);

      await notify(
        {
          message: `Penarikan saldo Rp ${formatRupiah(amount)} untuk ${customer.nama}${ruleCheck.isDesember ? " (Desember)" : ""} berhasil dicatat.`,
          type: "success",
          audience: "all",
          id_nasabah
        },
        client
      );

      await recordAudit(client, {
        req,
        action: "PENARIKAN_CREATE",
        entity: "transaksi_penarikan",
        entityId: inserted.rows[0].id_penarikan,
        detail: `${customer.nama} (${customer.no_buku}): Rp ${formatRupiah(amount)}${ruleCheck.isDesember ? " [Pengecualian Desember]" : ""}${finalKeterangan ? ` (${finalKeterangan})` : ""}`
      });

      await client.query("COMMIT");

      res.status(201).json({
        ok: true,
        receipt: {
          id_penarikan: inserted.rows[0].id_penarikan,
          tipe: "Penarikan Saldo",
          tanggal: transactionDate,
          no_buku: customer.no_buku,
          nama_nasabah: customer.nama,
          petugas: req.user.nama_user,
          jumlah: amount,
          keterangan: finalKeterangan,
          is_penarikan_desember: ruleCheck.isDesember,
          saldo_akhir: saldoSisa
        }
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/penarikan/:id",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID penarikan tidak valid." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const txRes = await client.query(
        "SELECT * FROM transaksi_penarikan WHERE id_penarikan = $1 FOR UPDATE",
        [id]
      );
      const tx = txRes.rows[0];
      if (!tx) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Transaksi penarikan tidak ditemukan." });
      }

      const custRes = await client.query(
        "SELECT * FROM nasabah WHERE id_nasabah = $1 FOR UPDATE",
        [tx.id_nasabah]
      );
      const customer = custRes.rows[0];

      await client.query(
        "UPDATE nasabah SET saldo = saldo + $1 WHERE id_nasabah = $2",
        [round2(tx.jumlah), tx.id_nasabah]
      );

      await client.query("DELETE FROM transaksi_penarikan WHERE id_penarikan = $1", [id]);

      await notify(
        {
          message: `Penarikan saldo Rp ${formatRupiah(tx.jumlah)} milik ${customer.nama} dibatalkan dan saldo dikembalikan.`,
          type: "warning",
          audience: "all",
          id_nasabah: tx.id_nasabah
        },
        client
      );

      await recordAudit(client, {
        req,
        action: "PENARIKAN_VOID",
        entity: "transaksi_penarikan",
        entityId: id,
        detail: `Batalkan penarikan #${id} (${customer.nama}, Rp ${formatRupiah(tx.jumlah)})`
      });

      await client.query("COMMIT");

      res.json({
        ok: true,
        message: "Transaksi penarikan dibatalkan dan saldo nasabah telah dikembalikan."
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

// ===========================
// PENGEPUL & PENJUALAN
// ===========================

app.get(
  "/api/pengepul",
  auth,
  allow("Ketua", "Bendahara"),
  async (_req, res) => {
    res.json(await q("SELECT * FROM pengepul ORDER BY nama ASC"));
  }
);

app.post(
  "/api/pengepul",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const nama = cleanText(req.body?.nama, 120);
    const kontak = cleanText(req.body?.kontak, 40);
    const alamat = cleanText(req.body?.alamat, 255);

    if (!nama) {
      return res.status(400).json({ error: "Nama pengepul wajib diisi." });
    }

    const created = await one(
      `INSERT INTO pengepul(nama, kontak, alamat)
       VALUES($1, $2, $3)
       RETURNING *`,
      [nama, kontak, alamat]
    );

    await recordAudit(pool, {
      req,
      action: "PENGEPUL_CREATE",
      entity: "pengepul",
      entityId: created.id_pengepul,
      detail: `Tambah pengepul "${nama}"`
    });

    res.status(201).json({
      ok: true,
      message: "Pengepul berhasil ditambahkan.",
      data: created
    });
  }
);

app.put(
  "/api/pengepul/:id",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID pengepul tidak valid." });
    }

    const nama = cleanText(req.body?.nama, 120);
    const kontak = cleanText(req.body?.kontak, 40);
    const alamat = cleanText(req.body?.alamat, 255);

    if (!nama) {
      return res.status(400).json({ error: "Nama pengepul wajib diisi." });
    }

    const updated = await one(
      `UPDATE pengepul
       SET nama = $1, kontak = $2, alamat = $3
       WHERE id_pengepul = $4
       RETURNING *`,
      [nama, kontak, alamat, id]
    );

    if (!updated) {
      return res.status(404).json({ error: "Data pengepul tidak ditemukan." });
    }

    await recordAudit(pool, {
      req,
      action: "PENGEPUL_UPDATE",
      entity: "pengepul",
      entityId: id,
      detail: `Perbarui pengepul "${nama}"`
    });

    res.json({
      ok: true,
      message: "Data pengepul berhasil diperbarui.",
      data: updated
    });
  }
);

app.delete(
  "/api/pengepul/:id",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID pengepul tidak valid." });
    }

    const current = await one("SELECT * FROM pengepul WHERE id_pengepul = $1", [id]);
    if (!current) {
      return res.status(404).json({ error: "Data pengepul tidak ditemukan." });
    }

    const used = await one(
      "SELECT COUNT(*)::int AS cnt FROM transaksi_penjualan WHERE id_pengepul = $1",
      [id]
    );
    if (used.cnt > 0) {
      return res.status(400).json({
        error: "Pengepul sudah tercatat pada riwayat penjualan sehingga tidak dapat dihapus."
      });
    }

    await q("DELETE FROM pengepul WHERE id_pengepul = $1", [id]);

    await recordAudit(pool, {
      req,
      action: "PENGEPUL_DELETE",
      entity: "pengepul",
      entityId: id,
      detail: `Hapus pengepul "${current.nama}"`
    });

    res.json({ ok: true, message: "Pengepul berhasil dihapus." });
  }
);

// ===========================
// H4: PENJUALAN MULTI-ITEM (M:N), STOK GUDANG, SUSUT & SIKLUS 2 MINGGU
// ===========================

app.get(
  "/api/penjualan",
  auth,
  allow("Ketua", "Bendahara"),
  async (_req, res) => {
    const rows = await getPenjualanWithDetails(120);
    res.json(rows);
  }
);

app.post(
  "/api/penjualan",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const idPengepulRaw = req.body?.id_pengepul;
    const pembeli = cleanText(req.body?.pembeli || "", 120);
    const tanggal = cleanText(req.body?.tanggal || "", 10);
    const catatan = cleanText(req.body?.catatan || "", 300);
    const diluarJadwalReq = Boolean(req.body?.diluar_jadwal);

    let id_pengepul = null;
    if (idPengepulRaw !== undefined && idPengepulRaw !== null && idPengepulRaw !== "") {
      id_pengepul = parsePositiveInt(idPengepulRaw);
      if (!id_pengepul) {
        return res.status(400).json({ error: "ID pengepul tidak valid." });
      }
    }

    if (!id_pengepul && !pembeli) {
      return res.status(400).json({
        error: "Pilih pengepul terdaftar atau isi nama pembeli."
      });
    }

    if (!validDate(tanggal)) {
      return res.status(400).json({ error: "Format tanggal penjualan tidak valid." });
    }

    // Dukung payload multi-item M:N (`items[]`) maupun legacy single-item
    const rawItems = Array.isArray(req.body?.items) && req.body.items.length
      ? req.body.items
      : req.body?.jenis_sampah
        ? [
            {
              jenis_sampah: req.body.jenis_sampah,
              berat_gudang: req.body.berat_gudang ?? req.body.berat_jual,
              berat_jual: req.body.berat_jual,
              harga_jual: req.body.harga_jual
            }
          ]
        : [];

    if (!rawItems.length) {
      return res.status(400).json({
        error: "Tambahkan minimal satu jenis sampah yang akan dijual."
      });
    }

    const parsedItems = [];
    const seenJenis = new Set();

    for (const raw of rawItems) {
      const jenis_sampah = cleanText(raw?.jenis_sampah, 80);
      if (!jenis_sampah) {
        return res.status(400).json({ error: "Jenis sampah pada setiap baris wajib dipilih." });
      }
      if (seenJenis.has(jenis_sampah.toLowerCase())) {
        return res.status(400).json({
          error: `Jenis sampah "${jenis_sampah}" tidak boleh duplikat dalam satu transaksi penjualan.`
        });
      }
      seenJenis.add(jenis_sampah.toLowerCase());

      const bgInput = raw?.berat_gudang ?? raw?.berat_jual;
      const bjInput = raw?.berat_jual;
      const hjInput = raw?.harga_jual;

      if (!validNumber(bgInput) || !validNumber(bjInput) || !validNumber(hjInput)) {
        return res.status(400).json({
          error: `Lengkapi berat gudang, berat timbangan pengepul, dan harga jual untuk "${jenis_sampah}".`
        });
      }

      const calc = computePenjualanItem({
        berat_gudang: bgInput,
        berat_jual: bjInput,
        harga_jual: hjInput
      });

      if (!calc.ok) {
        return res.status(400).json({ error: `${jenis_sampah}: ${calc.error}` });
      }

      parsedItems.push({
        jenis_sampah,
        ...calc
      });
    }

    const transactionDate = tanggal || today();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Kunci stok secara deterministik (urutan alfabetis) agar bebas deadlock
      const sortedJenis = [...parsedItems]
        .map(i => i.jenis_sampah)
        .sort((a, b) => a.localeCompare(b));

      for (const j of sortedJenis) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`stok:${j}`]);
      }

      // H4: Cek siklus jadwal 2 mingguan (14 hari)
      const schedule = await getPenjualanScheduleStatus(transactionDate, client);
      const isOutsideSchedule = Boolean(schedule.lastSaleDate && !schedule.isDue);

      if (isOutsideSchedule && (!diluarJadwalReq || !catatan)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Jadwal penjualan ke pengepul ditetapkan setiap ${PENJUALAN_SIKLUS_HARI} hari (2 minggu). Penjualan terakhir pada ${schedule.lastSaleDate} (jadwal berikutnya ${schedule.nextScheduleDate}). Centang opsi "Penjualan di luar jadwal 2 minggu" dan isi alasan di kolom catatan jika mendesak.`
        });
      }

      let buyerLabel = pembeli;
      if (id_pengepul) {
        const pengepulRes = await client.query(
          "SELECT id_pengepul, nama FROM pengepul WHERE id_pengepul = $1",
          [id_pengepul]
        );
        if (!pengepulRes.rows.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Pengepul tidak ditemukan." });
        }
        if (!buyerLabel) {
          buyerLabel = pengepulRes.rows[0].nama;
        }
      }

      // Validasi stok gudang per jenis (berkurang sebesar berat_gudang) & ambil id_harga
      const enrichedItems = [];
      for (const item of parsedItems) {
        const masterRes = await client.query(
          "SELECT id_harga FROM harga_sampah WHERE jenis_sampah = $1",
          [item.jenis_sampah]
        );
        const availableStock = await getAvailableStockForType(client, item.jenis_sampah);
        if (item.berat_gudang > availableStock + 0.0005) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            error: `Stok ${item.jenis_sampah} tidak mencukupi. Berat keluar gudang (${item.berat_gudang} kg) melebihi stok tersedia (${availableStock.toLocaleString("id-ID")} kg).`
          });
        }
        enrichedItems.push({
          ...item,
          id_harga: masterRes.rows[0]?.id_harga || null
        });
      }

      const totalBeratGudang = round3(
        enrichedItems.reduce((sum, i) => sum + i.berat_gudang, 0)
      );
      const totalBeratJual = round3(
        enrichedItems.reduce((sum, i) => sum + i.berat_jual, 0)
      );
      const totalSusut = round3(
        enrichedItems.reduce((sum, i) => sum + i.berat_susut, 0)
      );
      const grandTotal = round2(
        enrichedItems.reduce((sum, i) => sum + i.subtotal, 0)
      );
      const avgPrice = round2(grandTotal / totalBeratJual);
      const summaryJenis = enrichedItems.map(i => i.jenis_sampah).join(", ");

      const insertedHeader = await client.query(
        `INSERT INTO transaksi_penjualan
         (
           id_pengepul, tanggal, jenis_sampah, berat_jual, total_berat_gudang,
           total_susut, harga_jual, total, pembeli, catatan, diluar_jadwal
         )
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id_penjualan`,
        [
          id_pengepul,
          transactionDate,
          summaryJenis,
          totalBeratJual,
          totalBeratGudang,
          totalSusut,
          avgPrice,
          grandTotal,
          pembeli,
          catatan,
          isOutsideSchedule
        ]
      );

      const saleId = insertedHeader.rows[0].id_penjualan;

      for (const item of enrichedItems) {
        await client.query(
          `INSERT INTO detail_penjualan
           (id_penjualan, id_harga, jenis_sampah, berat_gudang, berat_jual, berat_susut, harga_jual, subtotal)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            saleId,
            item.id_harga,
            item.jenis_sampah,
            item.berat_gudang,
            item.berat_jual,
            item.berat_susut,
            item.harga_jual,
            item.subtotal
          ]
        );
      }

      const itemSummaryText = enrichedItems
        .map(
          i =>
            `${i.jenis_sampah} (gudang ${i.berat_gudang} kg → jual ${i.berat_jual} kg, susut ${i.berat_susut} kg)`
        )
        .join("; ");

      await notify(
        {
          message: `Penjualan #${saleId} ke ${buyerLabel} (${summaryJenis}, terjual ${totalBeratJual} kg, susut ${totalSusut} kg) senilai Rp ${formatRupiah(grandTotal)} berhasil dicatat.`,
          type: "success",
          audience: "staff"
        },
        client
      );

      await recordAudit(client, {
        req,
        action: "PENJUALAN_CREATE",
        entity: "transaksi_penjualan",
        entityId: saleId,
        detail: `${buyerLabel}: ${itemSummaryText} | Total Rp ${formatRupiah(grandTotal)}${isOutsideSchedule ? ` [Di luar jadwal 2 minggu: ${catatan}]` : ""}`
      });

      await client.query("COMMIT");

      res.status(201).json({
        ok: true,
        id_penjualan: saleId,
        total: grandTotal,
        total_berat_gudang: totalBeratGudang,
        total_berat_jual: totalBeratJual,
        total_susut: totalSusut,
        items: enrichedItems
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

app.delete(
  "/api/penjualan/:id",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "ID penjualan tidak valid." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const txRes = await client.query(
        "SELECT * FROM transaksi_penjualan WHERE id_penjualan = $1 FOR UPDATE",
        [id]
      );
      const tx = txRes.rows[0];
      if (!tx) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Transaksi penjualan tidak ditemukan." });
      }

      await client.query("DELETE FROM transaksi_penjualan WHERE id_penjualan = $1", [id]);

      await notify(
        {
          message: `Penjualan ${tx.berat_jual} kg ${tx.jenis_sampah} (Rp ${formatRupiah(tx.total)}) dibatalkan; stok sampah dikembalikan.`,
          type: "warning",
          audience: "staff"
        },
        client
      );

      await recordAudit(client, {
        req,
        action: "PENJUALAN_VOID",
        entity: "transaksi_penjualan",
        entityId: id,
        detail: `Batalkan penjualan #${id} (${tx.jenis_sampah} ${tx.berat_jual} kg, Rp ${formatRupiah(tx.total)})`
      });

      await client.query("COMMIT");

      res.json({
        ok: true,
        message: "Transaksi penjualan berhasil dibatalkan dan stok dikembalikan."
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
);

// ===========================
// LAPORAN BULANAN
// ===========================

app.get(
  "/api/laporan",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const now = witaNowParts();
    const monthValue = Number(req.query.month);
    const yearValue = Number(req.query.year);

    const month =
      Number.isInteger(monthValue) && monthValue >= 1 && monthValue <= 12
        ? monthValue
        : now.month;

    const year =
      Number.isInteger(yearValue) && yearValue >= 2000 && yearValue <= 2100
        ? yearValue
        : now.year;

    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

    const [
      setor,
      tarik,
      jual,
      detail,
      detailJual,
      saldoNasabah,
      stok,
      transaksi,
      hargaPeriode
    ] = await Promise.all([
      one(
        `SELECT
           COALESCE(SUM(COALESCE(nilai_kotor, nilai_setor)), 0) AS total_kotor,
           COALESCE(SUM(COALESCE(potongan_kas, 0)), 0) AS potongan_kas,
           COALESCE(SUM(COALESCE(nilai_nasabah, nilai_setor)), 0) AS total,
           COALESCE(SUM(berat_awal), 0) AS berat,
           COUNT(*)::int AS jumlah_transaksi
         FROM transaksi_setor
         WHERE tanggal BETWEEN $1 AND $2`,
        [start, end]
      ),
      one(
        `SELECT
           COALESCE(SUM(jumlah), 0) AS total,
           COUNT(*)::int AS jumlah_transaksi
         FROM transaksi_penarikan
         WHERE tanggal BETWEEN $1 AND $2`,
        [start, end]
      ),
      one(
        `SELECT
           COALESCE(SUM(total), 0) AS total,
           COALESCE(SUM(COALESCE(NULLIF(total_berat_gudang, 0), berat_jual)), 0) AS berat_gudang,
           COALESCE(SUM(berat_jual), 0) AS berat,
           COALESCE(SUM(COALESCE(total_susut, 0)), 0) AS total_susut,
           COUNT(*)::int AS jumlah_transaksi
         FROM transaksi_penjualan
         WHERE tanggal BETWEEN $1 AND $2`,
        [start, end]
      ),
      q(
        `SELECT
           jenis_sampah AS jenis,
           SUM(berat_awal) AS berat,
           SUM(COALESCE(nilai_kotor, nilai_setor)) AS kotor,
           SUM(COALESCE(potongan_kas, 0)) AS potongan_kas,
           SUM(COALESCE(nilai_nasabah, nilai_setor)) AS total
         FROM transaksi_setor
         WHERE tanggal BETWEEN $1 AND $2
         GROUP BY jenis_sampah
         ORDER BY kotor DESC`,
        [start, end]
      ),
      q(
        `SELECT
           d.jenis_sampah AS jenis,
           SUM(d.berat_gudang) AS berat_gudang,
           SUM(d.berat_jual) AS berat,
           SUM(d.berat_susut) AS berat_susut,
           SUM(d.subtotal) AS total
         FROM detail_penjualan d
         JOIN transaksi_penjualan p ON p.id_penjualan = d.id_penjualan
         WHERE p.tanggal BETWEEN $1 AND $2
         GROUP BY d.jenis_sampah
         ORDER BY total DESC`,
        [start, end]
      ),
      one("SELECT COALESCE(SUM(saldo), 0) AS total FROM nasabah"),
      getWasteStock(),
      q(
        `SELECT * FROM (
           SELECT
             TO_CHAR(t.tanggal, 'YYYY-MM-DD') AS tanggal,
             'Setoran' AS tipe,
             n.nama AS pihak,
             t.jenis_sampah AS kategori,
             t.berat_awal AS berat,
             COALESCE(t.nilai_kotor, t.nilai_setor) AS nilai_kotor,
             COALESCE(t.potongan_kas, 0) AS potongan_kas,
             COALESCE(t.nilai_nasabah, t.nilai_setor) AS nominal,
             t.petugas AS petugas
           FROM transaksi_setor t
           JOIN nasabah n ON n.id_nasabah = t.id_nasabah
           WHERE t.tanggal BETWEEN $1 AND $2

           UNION ALL

           SELECT
             TO_CHAR(p.tanggal, 'YYYY-MM-DD') AS tanggal,
             'Penarikan' AS tipe,
             n.nama AS pihak,
             COALESCE(NULLIF(p.keterangan, ''), 'Penarikan saldo') AS kategori,
             0 AS berat,
             p.jumlah AS nilai_kotor,
             0 AS potongan_kas,
             p.jumlah AS nominal,
             p.petugas AS petugas
           FROM transaksi_penarikan p
           JOIN nasabah n ON n.id_nasabah = p.id_nasabah
           WHERE p.tanggal BETWEEN $1 AND $2

           UNION ALL

           SELECT
             TO_CHAR(j.tanggal, 'YYYY-MM-DD') AS tanggal,
             'Penjualan' AS tipe,
             COALESCE(g.nama, NULLIF(j.pembeli, ''), 'Pengepul') AS pihak,
             j.jenis_sampah AS kategori,
             j.berat_jual AS berat,
             j.total AS nilai_kotor,
             0 AS potongan_kas,
             j.total AS nominal,
             '-' AS petugas
           FROM transaksi_penjualan j
           LEFT JOIN pengepul g ON g.id_pengepul = j.id_pengepul
           WHERE j.tanggal BETWEEN $1 AND $2
         ) ledger
         ORDER BY tanggal DESC`,
        [start, end]
      ),
      q(
        `SELECT jenis_sampah, harga_per_kg, status, ditetapkan_oleh
         FROM harga_periode
         WHERE bulan = $1 AND tahun = $2
         ORDER BY id_harga`,
        [month, year]
      )
    ]);

    const ketua = await one(
      "SELECT id_ketua, nama FROM ketua ORDER BY id_ketua LIMIT 1"
    );

    if (ketua) {
      await q(
        `INSERT INTO laporan_bulanan
         (id_ketua, bulan, tahun, total_setor, total_potongan_kas, total_penarikan, total_penjualan, total_susut)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT(id_ketua, bulan, tahun)
         DO UPDATE SET
           total_setor = EXCLUDED.total_setor,
           total_potongan_kas = EXCLUDED.total_potongan_kas,
           total_penarikan = EXCLUDED.total_penarikan,
           total_penjualan = EXCLUDED.total_penjualan,
           total_susut = EXCLUDED.total_susut`,
        [
          ketua.id_ketua,
          month,
          year,
          setor.total_kotor,
          setor.potongan_kas,
          tarik.total,
          jual.total,
          jual.total_susut
        ]
      );
    }

    const totalSetorKotor = round2(setor.total_kotor);
    const totalPotonganKas = round2(setor.potongan_kas);
    const totalSetorNasabah = round2(setor.total);
    const totalTarik = round2(tarik.total);
    const totalJual = round2(jual.total);

    res.json({
      month,
      year,
      ketuaNama: ketua?.nama || "Ketua Bank Sampah Lestari",
      potonganKasPersen: POTONGAN_KAS_PERSEN,
      setor: {
        total: totalSetorNasabah,
        totalKotor: totalSetorKotor,
        potonganKas: totalPotonganKas,
        totalNasabah: totalSetorNasabah,
        berat: round3(setor.berat),
        jumlah_transaksi: setor.jumlah_transaksi
      },
      tarik: {
        total: totalTarik,
        jumlah_transaksi: tarik.jumlah_transaksi
      },
      jual: {
        total: totalJual,
        beratGudang: round3(jual.berat_gudang),
        berat: round3(jual.berat),
        totalSusut: round3(jual.total_susut),
        jumlah_transaksi: jual.jumlah_transaksi
      },
      kasOperasionalPeriode: totalPotonganKas,
      arusKasPeriode: round2(totalJual - totalTarik),
      estimasiMargin: round2(totalJual - totalSetorKotor),
      totalSaldoNasabah: round2(saldoNasabah.total),
      detail: detail.map(d => ({
        jenis: d.jenis,
        berat: round3(d.berat),
        kotor: round2(d.kotor),
        potongan_kas: round2(d.potongan_kas),
        total: round2(d.total)
      })),
      detailJual: detailJual.map(d => ({
        jenis: d.jenis,
        berat_gudang: round3(d.berat_gudang),
        berat: round3(d.berat),
        berat_susut: round3(d.berat_susut),
        total: round2(d.total)
      })),
      hargaPeriode,
      stok,
      transaksi
    });
  }
);

// ===========================
// NOTIFIKASI (TERISOLASI PER ROLE & NASABAH)
// ===========================

app.get("/api/notifications", auth, async (req, res) => {
  if (req.user.role === "Nasabah") {
    const customer = await one(
      "SELECT id_nasabah FROM nasabah WHERE id_user = $1",
      [req.user.id]
    );

    if (!customer) {
      return res.json({ rows: [], unreadCount: 0 });
    }

    const rows = await q(
      `SELECT id, message, type, is_read, created_at
       FROM notifications
       WHERE id_nasabah = $1
       ORDER BY id DESC
       LIMIT 40`,
      [customer.id_nasabah]
    );

    const unreadCount = rows.filter(r => !r.is_read).length;
    return res.json({ rows, unreadCount });
  }

  const rows = await q(
    `SELECT id, message, type, is_read, created_at
     FROM notifications
     WHERE audience IN ('staff', 'all')
     ORDER BY id DESC
     LIMIT 40`
  );

  const unreadCount = rows.filter(r => !r.is_read).length;
  res.json({ rows, unreadCount });
});

app.post("/api/notifications/read-all", auth, async (req, res) => {
  if (req.user.role === "Nasabah") {
    const customer = await one(
      "SELECT id_nasabah FROM nasabah WHERE id_user = $1",
      [req.user.id]
    );
    if (customer) {
      await q(
        "UPDATE notifications SET is_read = TRUE WHERE id_nasabah = $1 AND is_read = FALSE",
        [customer.id_nasabah]
      );
    }
    return res.json({ ok: true });
  }

  await q(
    "UPDATE notifications SET is_read = TRUE WHERE audience IN ('staff', 'all') AND is_read = FALSE"
  );
  res.json({ ok: true });
});

// ===========================
// LOG AUDIT (KETUA & BENDAHARA)
// ===========================

app.get(
  "/api/audit-logs",
  auth,
  allow("Ketua", "Bendahara"),
  async (req, res) => {
    const actionFilter = cleanText(req.query.action || "", 64);
    const search = cleanText(req.query.q || "", 80);

    const conditions = [];
    const params = [];

    if (actionFilter) {
      params.push(actionFilter);
      conditions.push(`action = $${params.length}`);
    }

    if (search) {
      params.push(`%${search}%`);
      conditions.push(
        `(username ILIKE $${params.length} OR detail ILIKE $${params.length} OR entity ILIKE $${params.length})`
      );
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const rows = await q(
      `SELECT id, username, role, action, entity, entity_id, detail, ip_address, created_at
       FROM audit_logs
       ${whereClause}
       ORDER BY id DESC
       LIMIT 100`,
      params
    );

    res.json(rows);
  }
);

// ===========================
// RIWAYAT NASABAH
// ===========================

app.get(
  "/api/riwayat-saya",
  auth,
  allow("Nasabah"),
  async (req, res) => {
    const now = witaNowParts();
    await ensurePeriodPrices(now.year, now.month);

    const [customer, prices, minPenarikan] = await Promise.all([
      one("SELECT * FROM nasabah WHERE id_user = $1", [req.user.id]),
      q(
        `SELECT
           h.id_harga,
           h.jenis_sampah,
           COALESCE(hp.harga_per_kg, h.harga_per_kg) AS harga_per_kg,
           TO_CHAR(COALESCE(hp.ditetapkan_pada::date, h.tgl_mulai), 'YYYY-MM-DD') AS tgl_mulai
         FROM harga_sampah h
         LEFT JOIN harga_periode hp
           ON hp.id_harga = h.id_harga AND hp.bulan = $1 AND hp.tahun = $2
         ORDER BY h.id_harga`,
        [now.month, now.year]
      ),
      getMinPenarikan()
    ]);

    if (!customer) {
      return res.json({
        customer: null,
        items: [],
        summary: { totalSetor: 0, totalTarik: 0, totalBeratKg: 0, jumlahTransaksi: 0 },
        prices,
        minPenarikan,
        sudahTarikBulanIni: false,
        isDesember: now.month === 12,
        potonganKasPersen: POTONGAN_KAS_PERSEN,
        periodeLabel: `${MONTH_NAMES_ID[now.month - 1]} ${now.year}`
      });
    }

    const items = await q(
      `SELECT
         id_setor AS id,
         TO_CHAR(tanggal, 'YYYY-MM-DD') AS tanggal,
         created_at,
         jenis_sampah,
         berat_awal AS berat,
         COALESCE(nilai_kotor, nilai_setor) AS nilai_kotor,
         COALESCE(potongan_kas, 0) AS potongan_kas,
         COALESCE(nilai_nasabah, nilai_setor) AS nilai,
         petugas,
         '' AS keterangan,
         'Setoran' AS tipe
       FROM transaksi_setor
       WHERE id_nasabah = $1

       UNION ALL

       SELECT
         id_penarikan AS id,
         TO_CHAR(tanggal, 'YYYY-MM-DD') AS tanggal,
         created_at,
         '-' AS jenis_sampah,
         0 AS berat,
         jumlah AS nilai_kotor,
         0 AS potongan_kas,
         jumlah AS nilai,
         petugas,
         keterangan,
         'Penarikan' AS tipe
       FROM transaksi_penarikan
       WHERE id_nasabah = $1

       ORDER BY tanggal DESC, created_at DESC, id DESC`,
      [customer.id_nasabah]
    );

    const ymNow = `${now.year}-${String(now.month).padStart(2, "0")}`;
    const sudahTarikBulanIni = items.some(
      i => i.tipe === "Penarikan" && String(i.tanggal || "").startsWith(ymNow)
    );

    const summary = items.reduce(
      (acc, item) => {
        if (item.tipe === "Setoran") {
          acc.totalSetor = round2(acc.totalSetor + num(item.nilai));
          acc.totalBeratKg = round3(acc.totalBeratKg + num(item.berat));
        } else {
          acc.totalTarik = round2(acc.totalTarik + num(item.nilai));
        }
        acc.jumlahTransaksi += 1;
        return acc;
      },
      { totalSetor: 0, totalTarik: 0, totalBeratKg: 0, jumlahTransaksi: 0 }
    );

    res.json({
      customer,
      items,
      summary,
      prices,
      minPenarikan,
      sudahTarikBulanIni,
      isDesember: now.month === 12,
      potonganKasPersen: POTONGAN_KAS_PERSEN,
      periodeLabel: `${MONTH_NAMES_ID[now.month - 1]} ${now.year}`
    });
  }
);

// ===========================
// ENDPOINT TERPADU PER HALAMAN (1 KONEKSI SERVERLESS)
// ===========================

app.get(
  "/api/page/setoran",
  auth,
  allow("Ketua", "Bendahara", "Petugas Timbang"),
  async (_req, res) => {
    const now = witaNowParts();
    const customers = await q(
      "SELECT id_nasabah, no_buku, nama, saldo FROM nasabah ORDER BY nama ASC"
    );
    const prices = await getWasteStock();
    const history = await q(`
      SELECT
        t.id_setor,
        t.id_nasabah,
        t.id_periode,
        n.no_buku,
        n.nama AS nama_nasabah,
        TO_CHAR(t.tanggal, 'YYYY-MM-DD') AS tanggal,
        t.jenis_sampah,
        t.berat_awal,
        t.harga,
        COALESCE(t.nilai_kotor, t.nilai_setor) AS nilai_kotor,
        COALESCE(t.persen_potongan, 0) AS persen_potongan,
        COALESCE(t.potongan_kas, 0) AS potongan_kas,
        COALESCE(t.nilai_nasabah, t.nilai_setor) AS nilai_nasabah,
        t.nilai_setor,
        t.petugas,
        t.created_at
      FROM transaksi_setor t
      JOIN nasabah n ON n.id_nasabah = t.id_nasabah
      ORDER BY t.tanggal DESC, t.id_setor DESC
      LIMIT 120
    `);
    res.json({
      customers,
      prices,
      history,
      potonganKasPersen: POTONGAN_KAS_PERSEN,
      periodeLabel: `${MONTH_NAMES_ID[now.month - 1]} ${now.year}`
    });
  }
);

app.get(
  "/api/page/penarikan",
  auth,
  allow("Ketua", "Bendahara"),
  async (_req, res) => {
    const customers = await q(
      "SELECT id_nasabah, no_buku, nama, saldo FROM nasabah ORDER BY nama ASC"
    );
    const history = await q(`
      SELECT
        p.id_penarikan,
        p.id_nasabah,
        n.no_buku,
        n.nama AS nama_nasabah,
        TO_CHAR(p.tanggal, 'YYYY-MM-DD') AS tanggal,
        p.jumlah,
        p.keterangan,
        p.petugas,
        COALESCE(p.is_penarikan_desember, FALSE) AS is_penarikan_desember,
        p.created_at
      FROM transaksi_penarikan p
      JOIN nasabah n ON n.id_nasabah = p.id_nasabah
      ORDER BY p.tanggal DESC, p.id_penarikan DESC
      LIMIT 120
    `);
    const withdrawnMonths = await q(`
      SELECT DISTINCT
        id_nasabah,
        TO_CHAR(tanggal, 'YYYY-MM') AS ym
      FROM transaksi_penarikan
    `);
    const minPenarikan = await getMinPenarikan();
    res.json({ customers, history, minPenarikan, withdrawnMonths });
  }
);

app.get(
  "/api/page/penjualan",
  auth,
  allow("Ketua", "Bendahara"),
  async (_req, res) => {
    const rows = await getPenjualanWithDetails(120);
    const prices = await getWasteStock();
    const collectors = await q("SELECT * FROM pengepul ORDER BY nama ASC");
    const schedule = await getPenjualanScheduleStatus();
    res.json({ rows, prices, collectors, schedule });
  }
);

app.get("/api/page/users", auth, allow("Ketua"), async (_req, res) => {
  const users = await q(`
    SELECT
      u.id_user,
      u.username,
      u.role,
      u.nama_user,
      u.is_active,
      u.must_change_password,
      u.created_at,
      u.last_login_at,
      n.id_nasabah,
      n.no_buku,
      n.nama AS nama_nasabah
    FROM users u
    LEFT JOIN nasabah n ON n.id_user = u.id_user
    ORDER BY u.id_user ASC
  `);
  const nasabah = await q(
    "SELECT id_nasabah, id_user, no_buku, nama FROM nasabah ORDER BY nama ASC"
  );
  res.json({ users, nasabah });
});

// 404 API
app.use("/api", (_req, res) => {
  res.status(404).json({
    error: "Endpoint API tidak ditemukan."
  });
});

// ERROR HANDLER
app.use((err, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({
      error: "Format JSON pada permintaan tidak valid."
    });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: "Ukuran data permintaan terlalu besar."
    });
  }

  if (err?.status === 403) {
    return res.status(403).json({
      error: err.message || "Akses ditolak."
    });
  }

  if (err?.code === "22P02") {
    return res.status(400).json({
      error: "Format parameter atau angka tidak valid."
    });
  }

  if (err?.code === "23505") {
    return res.status(409).json({
      error: "Data duplikat terdeteksi."
    });
  }

  if (err?.code === "23503" || err?.code === "23514") {
    return res.status(400).json({
      error: "Data melanggar batasan integritas database."
    });
  }

  console.error("Server error:", err);

  res.status(500).json({
    error: "Terjadi kesalahan pada server. Periksa log backend."
  });
});

// VERCEL + LOCAL SERVER
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

let dbInitPromise;

async function ensureDb() {
  if (!dbInitPromise) {
    dbInitPromise = initDb().catch(error => {
      dbInitPromise = null;
      throw error;
    });
  }

  return dbInitPromise;
}

if (isDirectRun) {
  ensureDb()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`API Bank Sampah Lestari berjalan pada port ${PORT}`);
      });
    })
    .catch(error => {
      console.error("Gagal menjalankan API Bank Sampah Lestari:", error);
      process.exit(1);
    });
}

export default app;
