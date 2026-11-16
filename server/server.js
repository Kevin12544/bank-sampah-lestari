import "express-async-errors";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL belum diatur.");
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error("JWT_SECRET wajib diisi minimal 32 karakter.");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

const allowedOrigins = (process.env.CLIENT_URL || "").split(",").map(x => x.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin tidak diizinkan oleh CORS."));
  }
}));
app.use(express.json({ limit: "1mb" }));

const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0] || null;
const num = n => Number(n || 0);
const today = () => new Date().toISOString().slice(0, 10);
const roles = ["Ketua", "Bendahara", "Petugas Timbang", "Nasabah"];

async function initDb() {
  await pool.query(`
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
  `);

  const userCount = Number((await one("SELECT COUNT(*)::int AS n FROM users")).n);
  if (!userCount) {
    const demo = [
      ["ketua", "lestari", "Ketua", "Meiske Rondonuwu"],
      ["bendahara", "lestari", "Bendahara", "Bendahara Lestari"],
      ["petugas", "lestari", "Petugas Timbang", "Petugas Timbang"],
      ["nasabah", "lestari", "Nasabah", "Andi Pratama"]
    ];
    for (const [username, password, role, nama_user] of demo) {
      const hash = await bcrypt.hash(process.env.DEMO_PASSWORD || password, 12);
      await q("INSERT INTO users(username,password,role,nama_user) VALUES($1,$2,$3,$4)", [username, hash, role, nama_user]);
    }
  }

  const priceCount = Number((await one("SELECT COUNT(*)::int AS n FROM harga_sampah")).n);
  if (!priceCount) {
    const prices = [["Plastik",3000],["Kertas",2000],["Kaca",1000],["Logam",5000],["Minyak Jelantah",4000],["Kardus",2500],["Lainnya",1000]];
    for (const [jenis, harga] of prices) await q("INSERT INTO harga_sampah(jenis_sampah,harga_per_kg,tgl_mulai) VALUES($1,$2,CURRENT_DATE)",[jenis,harga]);
  }
  const ketua = await one("SELECT id_ketua FROM ketua LIMIT 1");
  if (!ketua) await q("INSERT INTO ketua(nama,jabatan) VALUES($1,$2)",["Meiske Rondonuwu","Ketua"]);
  const customerCount = Number((await one("SELECT COUNT(*)::int AS n FROM nasabah")).n);
  if (!customerCount) {
    const u = await one("SELECT id_user FROM users WHERE username='nasabah'");
    await q("INSERT INTO nasabah(id_user,no_buku,nama,alamat,no_hp,saldo) VALUES($1,$2,$3,$4,$5,$6)",
      [u.id_user,"NSB-001","Andi Pratama","Manado","081234567890",248000]);
    await q("INSERT INTO nasabah(no_buku,nama,alamat,no_hp,saldo) VALUES($1,$2,$3,$4,$5)",
      ["NSB-002","Siti Lestari","Manado","081298765432",175000]);
    await q("INSERT INTO nasabah(no_buku,nama,alamat,no_hp,saldo) VALUES($1,$2,$3,$4,$5)",
      ["NSB-003","Budi Santoso","Minahasa","081277788899",92000]);
  }
  const setorCount = Number((await one("SELECT COUNT(*)::int AS n FROM transaksi_setor")).n);
  if (!setorCount) {
    const n = await one("SELECT id_nasabah FROM nasabah WHERE no_buku='NSB-001'");
    const h = await one("SELECT id_harga,harga_per_kg FROM harga_sampah WHERE jenis_sampah='Plastik'");
    await q(`INSERT INTO transaksi_setor(id_nasabah,id_harga,tanggal,jenis_sampah,berat_awal,harga,nilai_setor,petugas)
      VALUES($1,$2,CURRENT_DATE,'Plastik',25,$3,75000,'Petugas Timbang')`,[n.id_nasabah,h.id_harga,h.harga_per_kg]);
  }
}

function auth(req,res,next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({error:"Silakan login terlebih dahulu."});
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({error:"Sesi berakhir. Silakan login kembali."});
  }
}
function allow(...allowed) {
  return (req,res,next) => allowed.includes(req.user.role)
    ? next() : res.status(403).json({error:"Role Anda tidak memiliki akses ke fitur ini."});
}
async function notify(message,type="info") {
  await q("INSERT INTO notifications(message,type) VALUES($1,$2)",[message,type]);
}

app.get("/api/health", async (_req,res) => {
  try { await pool.query("SELECT 1"); res.json({ok:true,app:"Bank Sampah Lestari",database:"connected"}); }
  catch { res.status(503).json({ok:false,database:"disconnected"}); }
});

app.post("/api/login", async (req,res) => {
  const {username,password} = req.body || {};
  if (!username || !password) return res.status(400).json({error:"Username dan password wajib diisi."});
  const user = await one("SELECT id_user,username,password,role,nama_user FROM users WHERE username=$1",[username]);
  if (!user || !(await bcrypt.compare(password,user.password))) return res.status(401).json({error:"Username atau password salah."});
  const safeUser = {id:user.id_user,username:user.username,role:user.role,nama_user:user.nama_user};
  const token = jwt.sign(safeUser,JWT_SECRET,{expiresIn:"8h"});
  res.json({token,user:safeUser});
});
app.get("/api/me",auth,(req,res)=>res.json(req.user));

app.get("/api/dashboard",auth,allow("Ketua","Bendahara","Petugas Timbang"),async (_req,res)=>{
  const nasabah = await one("SELECT COUNT(*)::int AS total FROM nasabah");
  const setor = await one("SELECT COALESCE(SUM(nilai_setor),0) AS total FROM transaksi_setor");
  const penjualan = await one("SELECT COALESCE(SUM(total),0) AS total FROM transaksi_penjualan");
  const penarikan = await one("SELECT COALESCE(SUM(jumlah),0) AS total FROM transaksi_penarikan");
  const recent = await q(`SELECT t.id_setor AS id,t.tanggal,t.jenis_sampah,t.berat_awal AS berat,t.nilai_setor AS nilai,n.nama,'Setoran' AS tipe
    FROM transaksi_setor t JOIN nasabah n ON n.id_nasabah=t.id_nasabah ORDER BY t.id_setor DESC LIMIT 6`);
  const chart = await q("SELECT jenis_sampah AS jenis,SUM(berat_awal) AS berat FROM transaksi_setor GROUP BY jenis_sampah");
  res.json({nasabah:nasabah.total,setor:setor.total,penjualan:penjualan.total,penarikan:penarikan.total,
    saldoKas:num(setor.total)-num(penarikan.total),recent,chart});
});

app.get("/api/nasabah",auth,allow("Ketua","Bendahara","Petugas Timbang"),async (_req,res)=>res.json(await q("SELECT * FROM nasabah ORDER BY id_nasabah DESC")));
app.post("/api/nasabah",auth,allow("Ketua","Bendahara"),async (req,res)=>{
  const {no_buku,nama,alamat,no_hp} = req.body || {};
  if (!no_buku || !nama) return res.status(400).json({error:"Nomor buku dan nama wajib diisi."});
  try {
    await q("INSERT INTO nasabah(no_buku,nama,alamat,no_hp) VALUES($1,$2,$3,$4)",[no_buku,nama,alamat||"",no_hp||""]);
    res.json({ok:true});
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({error:"Nomor buku sudah digunakan."});
    throw e;
  }
});

app.get("/api/harga",auth,async (_req,res)=>res.json(await q("SELECT * FROM harga_sampah ORDER BY id_harga")));
app.put("/api/harga/:id",auth,allow("Ketua","Bendahara"),async (req,res)=>{
  const price=num(req.body?.harga_per_kg);
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({error:"Harga tidak valid."});
  await q("UPDATE harga_sampah SET harga_per_kg=$1,tgl_mulai=CURRENT_DATE WHERE id_harga=$2",[price,req.params.id]);
  res.json({ok:true});
});

app.post("/api/setoran",auth,allow("Ketua","Petugas Timbang","Bendahara"),async (req,res)=>{
  const {id_nasabah,tanggal,items} = req.body || {};
  if (!id_nasabah || !Array.isArray(items) || !items.some(x=>num(x.berat)>0))
    return res.status(400).json({error:"Pilih nasabah dan masukkan minimal satu berat sampah."});
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const customer = (await client.query("SELECT * FROM nasabah WHERE id_nasabah=$1 FOR UPDATE",[id_nasabah])).rows[0];
    if (!customer) { await client.query("ROLLBACK"); return res.status(404).json({error:"Nasabah tidak ditemukan."}); }
    let total=0;
    for (const item of items) {
      const berat=num(item.berat); if (berat<=0) continue;
      const price=(await client.query("SELECT id_harga,harga_per_kg FROM harga_sampah WHERE jenis_sampah=$1",[item.jenis])).rows[0];
      if (!price) continue;
      const value=berat*num(price.harga_per_kg); total+=value;
      await client.query(`INSERT INTO transaksi_setor(id_nasabah,id_harga,tanggal,jenis_sampah,berat_awal,harga,nilai_setor,petugas)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id_nasabah,price.id_harga,tanggal||today(),item.jenis,berat,price.harga_per_kg,value,req.user.nama_user]);
    }
    await client.query("UPDATE nasabah SET saldo=saldo+$1 WHERE id_nasabah=$2",[total,id_nasabah]);
    await client.query("INSERT INTO notifications(message,type) VALUES($1,$2)",
      [`Setoran berhasil untuk ${customer.nama}. Saldo bertambah Rp ${total.toLocaleString("id-ID")}`,"success"]);
    await client.query("COMMIT");
    res.json({ok:true,total});
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
});

app.post("/api/penarikan",auth,allow("Ketua","Bendahara"),async (req,res)=>{
  const {id_nasabah,jumlah,keterangan} = req.body || {};
  const amount=num(jumlah);
  if (!id_nasabah || !Number.isFinite(amount) || amount<=0) return res.status(400).json({error:"Data penarikan tidak valid."});
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const customer=(await client.query("SELECT * FROM nasabah WHERE id_nasabah=$1 FOR UPDATE",[id_nasabah])).rows[0];
    if (!customer) { await client.query("ROLLBACK"); return res.status(400).json({error:"Data penarikan tidak valid."}); }
    if (amount>num(customer.saldo)) { await client.query("ROLLBACK"); return res.status(400).json({error:"Saldo nasabah tidak mencukupi."}); }
    await client.query(`INSERT INTO transaksi_penarikan(id_nasabah,id_user,tanggal,jumlah,keterangan,petugas)
      VALUES($1,$2,CURRENT_DATE,$3,$4,$5)`,
      [id_nasabah,req.user.id,amount,keterangan||"",req.user.nama_user]);
    await client.query("UPDATE nasabah SET saldo=saldo-$1 WHERE id_nasabah=$2",[amount,id_nasabah]);
    await client.query("INSERT INTO notifications(message,type) VALUES($1,$2)",
      [`Penarikan berhasil untuk ${customer.nama}: Rp ${amount.toLocaleString("id-ID")}`,"success"]);
    await client.query("COMMIT");
    res.json({ok:true});
  } catch(e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
});

app.get("/api/penjualan",auth,allow("Ketua","Bendahara"),async (_req,res)=>res.json(await q(`SELECT p.*,g.nama AS nama_pengepul FROM transaksi_penjualan p
  LEFT JOIN pengepul g ON g.id_pengepul=p.id_pengepul ORDER BY p.id_penjualan DESC`)));
app.get("/api/pengepul",auth,allow("Ketua","Bendahara"),async (_req,res)=>res.json(await q("SELECT * FROM pengepul ORDER BY nama")));
app.post("/api/pengepul",auth,allow("Ketua","Bendahara"),async (req,res)=>{
  const {nama,kontak,alamat}=req.body||{};
  if(!nama)return res.status(400).json({error:"Nama pengepul wajib diisi."});
  await q("INSERT INTO pengepul(nama,kontak,alamat) VALUES($1,$2,$3)",[nama,kontak||"",alamat||""]);
  res.json({ok:true});
});
app.post("/api/penjualan",auth,allow("Ketua","Bendahara"),async (req,res)=>{
  const {id_pengepul,jenis_sampah,berat_jual,harga_jual,pembeli}=req.body||{};
  const berat=num(berat_jual),harga=num(harga_jual);
  if(!jenis_sampah||berat<=0||harga<=0)return res.status(400).json({error:"Lengkapi jenis sampah, berat, dan harga jual."});
  const total=berat*harga;
  await q(`INSERT INTO transaksi_penjualan(id_pengepul,tanggal,jenis_sampah,berat_jual,harga_jual,total,pembeli)
    VALUES($1,CURRENT_DATE,$2,$3,$4,$5,$6)`,[id_pengepul||null,jenis_sampah,berat,harga,total,pembeli||""]);
  await notify(`Penjualan ${berat} kg ${jenis_sampah} berhasil dicatat.`,"success");
  res.json({ok:true,total});
});

app.get("/api/laporan",auth,allow("Ketua","Bendahara"),async (req,res)=>{
  const month=Math.min(12,Math.max(1,Number(req.query.month)||new Date().getMonth()+1));
  const year=Number(req.query.year)||new Date().getFullYear();
  const start=`${year}-${String(month).padStart(2,"0")}-01`;
  const end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  const [setor,tarik,jual,detail]=await Promise.all([
    one("SELECT COALESCE(SUM(nilai_setor),0) AS total,COALESCE(SUM(berat_awal),0) AS berat FROM transaksi_setor WHERE tanggal BETWEEN $1 AND $2",[start,end]),
    one("SELECT COALESCE(SUM(jumlah),0) AS total FROM transaksi_penarikan WHERE tanggal BETWEEN $1 AND $2",[start,end]),
    one("SELECT COALESCE(SUM(total),0) AS total,COALESCE(SUM(berat_jual),0) AS berat FROM transaksi_penjualan WHERE tanggal BETWEEN $1 AND $2",[start,end]),
    q("SELECT jenis_sampah AS jenis,SUM(berat_awal) AS berat,SUM(nilai_setor) AS total FROM transaksi_setor WHERE tanggal BETWEEN $1 AND $2 GROUP BY jenis_sampah",[start,end])
  ]);
  const ketua = await one("SELECT id_ketua FROM ketua ORDER BY id_ketua LIMIT 1");
  if (ketua) {
    await q(`INSERT INTO laporan_bulanan(id_ketua,bulan,tahun,total_setor,total_penarikan,total_penjualan)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(id_ketua,bulan,tahun) DO UPDATE SET
        total_setor=EXCLUDED.total_setor,
        total_penarikan=EXCLUDED.total_penarikan,
        total_penjualan=EXCLUDED.total_penjualan`,
      [ketua.id_ketua,month,year,setor.total,tarik.total,jual.total]);
  }
  res.json({month,year,setor,tarik,jual,detail});
});

app.get("/api/notifications",auth,async (_req,res)=>res.json(await q("SELECT * FROM notifications ORDER BY id DESC LIMIT 20")));
app.get("/api/riwayat-saya",auth,allow("Nasabah"),async (req,res)=>{
  const customer=await one("SELECT * FROM nasabah WHERE id_user=$1",[req.user.id]);
  if(!customer)return res.json({customer:null,items:[]});
  const items=await q(`SELECT tanggal,jenis_sampah,berat_awal AS berat,nilai_setor AS nilai,'Setoran' AS tipe
    FROM transaksi_setor WHERE id_nasabah=$1
    UNION ALL
    SELECT tanggal,'-' AS jenis_sampah,0 AS berat,jumlah AS nilai,'Penarikan' AS tipe
    FROM transaksi_penarikan WHERE id_nasabah=$1 ORDER BY tanggal DESC`,[customer.id_nasabah]);
  res.json({customer,items});
});

app.use((err,_req,res,_next)=>{
  console.error(err);
  res.status(500).json({error:"Terjadi kesalahan pada server. Periksa log backend."});
});

await initDb();
app.listen(PORT,()=>console.log(`API Bank Sampah Lestari berjalan pada port ${PORT}`));
