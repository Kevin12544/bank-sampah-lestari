import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  LayoutDashboard, Recycle, Wallet, Users, Scale, ShoppingCart,
  FileText, Bell, LogOut, Search, Plus, Printer, Leaf, ChevronDown,
  CheckCircle2, AlertCircle,
} from 'lucide-react';
import './style.css';

const API = (
  import.meta.env.VITE_API_URL ||
  'https://bank-sampah-lestari.vercel.app/api'
).replace(/\/$/, '');

const fmt = (value) =>
  'Rp ' + Number(value || 0).toLocaleString('id-ID');

const fmtDate = (value) => {
  if (!value) return '-';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';

  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Makassar',
  }).format(date);
};

const dateNow = () => {
  const now = new Date();
  const localDate = new Date(
    now.getTime() - now.getTimezoneOffset() * 60000
  );

  return localDate.toISOString().slice(0, 10);
};

function App() {
  const [token, setToken] = useState(
    localStorage.getItem('bsl_token') || ''
  );

  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('bsl_user') || 'null');
    } catch {
      return null;
    }
  });

  const [page, setPage] = useState('dashboard');
  const [data, setData] = useState({});
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState({
    username: 'ketua',
    password: 'lestari',
  });

  const loadRequestRef = useRef(0);
  const toastTimerRef = useRef(null);

  async function api(path, opts = {}) {
    const response = await fetch(API + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(opts.headers || {}),
      },
    });

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error('Server memberikan respons yang tidak valid.');
    }

    if (!response.ok) {
      if (response.status === 401 && path !== '/login') {
        logout();
      }

      throw new Error(
        result?.error || 'Terjadi kesalahan saat menghubungi server.'
      );
    }

    return result;
  }

  function message(text) {
    setToast(text);

    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = setTimeout(() => {
      setToast('');
      toastTimerRef.current = null;
    }, 3000);
  }

  async function load() {
    const requestId = ++loadRequestRef.current;

    if (!token) return;

    try {
      let result = {};

      if (page === 'dashboard') {
        result = await api('/dashboard');
      } else if (page === 'nasabah') {
        result = { rows: await api('/nasabah') };
      } else if (page === 'harga') {
        result = { rows: await api('/harga') };
      } else if (page === 'setoran') {
        const [customers, prices] = await Promise.all([
          api('/nasabah'),
          api('/harga'),
        ]);

        result = { customers, prices };
      } else if (page === 'penarikan') {
        result = { customers: await api('/nasabah') };
      } else if (page === 'penjualan') {
        const [rows, prices, collectors] = await Promise.all([
          api('/penjualan'),
          api('/harga'),
          api('/pengepul'),
        ]);

        result = { rows, prices, collectors };
      } else if (page === 'laporan') {
        result = await api('/laporan');
      } else if (page === 'notifikasi') {
        result = { rows: await api('/notifications') };
      } else if (page === 'saldo') {
        result = await api('/riwayat-saya');
      }

      if (requestId === loadRequestRef.current) {
        setData(result);
      }
    } catch (error) {
      if (requestId === loadRequestRef.current) {
        message(error.message);
      }
    }
  }

  useEffect(() => {
    load();

    return () => {
      loadRequestRef.current++;
    };
  }, [token, page]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  async function doLogin(e) {
    e.preventDefault();

    if (busy) return;

    setBusy(true);

    try {
      const result = await api('/login', {
        method: 'POST',
        body: JSON.stringify(login),
      });

      setToken(result.token);
      setUser(result.user);

      localStorage.setItem('bsl_token', result.token);
      localStorage.setItem(
        'bsl_user',
        JSON.stringify(result.user)
      );

      message('Selamat datang, ' + result.user.nama_user);
    } catch (error) {
      message(error.message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    loadRequestRef.current++;

    setToken('');
    setUser(null);
    setData({});
    setPage('dashboard');

    localStorage.removeItem('bsl_token');
    localStorage.removeItem('bsl_user');
  }

  const nav = [
    ['dashboard', 'Dasbor', LayoutDashboard, ['Ketua', 'Bendahara', 'Petugas Timbang']],
    ['laporan', 'Laporan', FileText, ['Ketua', 'Bendahara']],
    ['harga', 'Kelola Harga Sampah', Scale, ['Ketua', 'Bendahara']],
    ['nasabah', 'Data Nasabah', Users, ['Ketua', 'Bendahara']],
    ['setoran', 'Setoran Sampah', Recycle, ['Ketua', 'Petugas Timbang', 'Bendahara']],
    ['penarikan', 'Penarikan Saldo', Wallet, ['Ketua', 'Bendahara']],
    ['penjualan', 'Penjualan', ShoppingCart, ['Ketua', 'Bendahara']],
    ['saldo', 'Saldo Saya', Wallet, ['Nasabah']],
    ['notifikasi', 'Notifikasi', Bell, ['Ketua', 'Bendahara', 'Petugas Timbang', 'Nasabah']],
  ];

  const visible = nav.filter((item) =>
    item[3].includes(user?.role)
  );

  if (!token || !user) {
    return (
      <Login
        login={login}
        setLogin={setLogin}
        submit={doLogin}
        busy={busy}
        toast={toast}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <Recycle size={27} />
          </span>
          <span>
            Bank Sampah<strong>Lestari</strong>
          </span>
        </div>

        <div className="side-caption">MENU UTAMA</div>

        <nav>
          {visible.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? 'nav-item active' : 'nav-item'}
              onClick={() => setPage(id)}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>

        <div className="side-bottom">
          <div className="user-mini">
            <div className="avatar">
              {user.nama_user?.[0] || '?'}
            </div>
            <div>
              <b>{user.nama_user}</b>
              <small>{user.role}</small>
            </div>
          </div>

          <button className="nav-item" onClick={logout}>
            <LogOut size={18} />
            Keluar
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <span className="eyebrow">SISTEM INFORMASI</span>
            <h1>
              {nav.find((item) => item[0] === page)?.[1] || 'Dasbor'}
            </h1>
          </div>

          <div className="top-actions">
            <button
              className="icon-btn"
              onClick={() => setPage('notifikasi')}
              aria-label="Buka notifikasi"
            >
              <Bell size={19} />
              <i />
            </button>

            <div className="profile">
              <div className="avatar">
                {user.nama_user?.[0] || '?'}
              </div>
              <span>
                <b>{user.nama_user}</b>
                <small>{user.role}</small>
              </span>
              <ChevronDown size={15} />
            </div>
          </div>
        </header>

        <div className="content">
          {page === 'dashboard' && (
            <Dashboard
              data={data}
              user={user}
              setPage={setPage}
            />
          )}

          {page === 'nasabah' && (
            <Nasabah
              data={data}
              api={api}
              message={message}
              reload={load}
            />
          )}

          {page === 'harga' && (
            <Harga
              data={data}
              api={api}
              message={message}
              reload={load}
            />
          )}

          {page === 'setoran' && (
            <Setoran
              data={data}
              api={api}
              message={message}
              reload={load}
            />
          )}

          {page === 'penarikan' && (
            <Penarikan
              data={data}
              api={api}
              message={message}
              reload={load}
            />
          )}

          {page === 'penjualan' && (
            <Penjualan
              data={data}
              api={api}
              message={message}
              reload={load}
            />
          )}

          {page === 'laporan' && (
            <Laporan
              data={data}
              api={api}
              setData={setData}
            />
          )}

          {page === 'notifikasi' && (
            <Notifications data={data} />
          )}

          {page === 'saldo' && (
            <Saldo data={data} />
          )}
        </div>

        <footer>
          © 2026 Bank Sampah Lestari · Menjaga Lingkungan, Menambah Manfaat
        </footer>
      </main>

      {toast && (
        <div className="toast">
          <CheckCircle2 size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function Login({ login, setLogin, submit, busy, toast }) {
  return (
    <div className="login-page">
      <div className="login-art">
        <div className="art-logo">
          <Recycle size={78} />
        </div>

        <h1>
          Bank Sampah<br />
          <b>Lestari</b>
        </h1>

        <p>Menjaga Lingkungan, Menambah Manfaat</p>
        <div className="art-leaves">♻　🌱　♻</div>
        <small>Mulai langkah kecil untuk bumi yang lebih baik.</small>
      </div>

      <form className="login-form" onSubmit={submit}>
        <div className="form-brand">
          <Recycle color="#13834d" size={32} />
          <span>
            Bank Sampah <b>Lestari</b>
          </span>
        </div>

        <span className="eyebrow">SELAMAT DATANG</span>
        <h2>Masuk ke Akun</h2>
        <p>Masuk untuk melanjutkan ke sistem.</p>

        <label>
          Nama Pengguna
          <input
            value={login.username}
            onChange={(e) =>
              setLogin({ ...login, username: e.target.value })
            }
            placeholder="Masukkan nama pengguna"
            autoComplete="username"
            required
          />
        </label>

        <label>
          Kata Sandi
          <input
            type="password"
            value={login.password}
            onChange={(e) =>
              setLogin({ ...login, password: e.target.value })
            }
            placeholder="Masukkan kata sandi"
            autoComplete="current-password"
            required
          />
        </label>

        <button className="primary full" disabled={busy}>
          {busy ? 'Memproses...' : 'Masuk ke Akun'}
        </button>

        <div className="demo-accounts">
          <b>Akun contoh</b>
          <span>Ketua: ketua / lestari</span>
          <span>Bendahara: bendahara / lestari</span>
          <span>Petugas: petugas / lestari</span>
          <span>Nasabah: nasabah / lestari</span>
        </div>

        {toast && (
          <div className="inline-error">
            <AlertCircle size={15} />
            {toast}
          </div>
        )}
      </form>
    </div>
  );
}

function Heading({ title, desc, action }) {
  return (
    <div className="page-heading">
      <div>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
      {action}
    </div>
  );
}

function Card({ children, className = '' }) {
  return (
    <section className={'card ' + className}>
      {children}
    </section>
  );
}

function Dashboard({ data, user, setPage }) {
  const cards = [
    ['Total Nasabah', data.nasabah || 0, 'orang', Users, 'green'],
    ['Total Setoran', fmt(data.setor), 'akumulasi', Recycle, 'blue'],
    ['Total Penjualan', fmt(data.penjualan), 'akumulasi', ShoppingCart, 'orange'],
    ['Saldo Kas', fmt(data.saldoKas), 'perkiraan kas', Wallet, 'purple'],
  ];

  return (
    <>
      <div className="welcome">
        <div>
          <span className="eyebrow light">RINGKASAN OPERASIONAL</span>
          <h2>
            Selamat datang, {user?.nama_user || 'Pengguna'}!
          </h2>
          <p>
            Lihat ringkasan kegiatan Bank Sampah Lestari hari ini.
          </p>
        </div>

        <div className="welcome-mark">
          <Leaf size={66} />
        </div>
      </div>

      <div className="stat-grid">
        {cards.map(([label, value, sub, Icon, color]) => (
          <Card className="stat-card" key={label}>
            <div className={'stat-icon ' + color}>
              <Icon size={22} />
            </div>
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{sub}</small>
          </Card>
        ))}
      </div>

      <div className="two-col">
        <Card>
          <div className="card-title">
            <div>
              <h3>Setoran Sampah</h3>
              <p>
                Jumlah berat sampah yang terkumpul berdasarkan jenisnya
              </p>
            </div>

            <button
              className="text-button"
              onClick={() => setPage('setoran')}
            >
              Catat setoran →
            </button>
          </div>

          <div className="chart">
            {(data.chart || []).map((item) => {
              const maxWeight = Math.max(
                1,
                ...(data.chart || []).map((row) =>
                  Number(row.berat) || 0
                )
              );

              return (
                <div className="bar-row" key={item.jenis}>
                  <span>{item.jenis}</span>
                  <div className="bar-track">
                    <i
                      style={{
                        width:
                          Math.min(
                            100,
                            (Number(item.berat || 0) / maxWeight) * 100
                          ) + '%',
                      }}
                    />
                  </div>
                  <b>
                    {Number(item.berat || 0).toLocaleString('id-ID')} kg
                  </b>
                </div>
              );
            })}

            {!data.chart?.length && (
              <p className="empty">Belum ada data setoran.</p>
            )}
          </div>
        </Card>

        <Card>
          <div className="card-title">
            <div>
              <h3>Menu Pintas</h3>
              <p>Pilih kegiatan yang ingin Anda lakukan</p>
            </div>
          </div>

          <div className="quick-grid">
            <button onClick={() => setPage('setoran')}>
              <Recycle />Setoran Sampah
            </button>
            <button onClick={() => setPage('penarikan')}>
              <Wallet />Penarikan Saldo
            </button>
            <button onClick={() => setPage('nasabah')}>
              <Users />Data Nasabah
            </button>
            <button onClick={() => setPage('laporan')}>
              <FileText />Laporan Bulanan
            </button>
          </div>
        </Card>
      </div>

      <Card>
        <div className="card-title">
          <div>
            <h3>Transaksi Setoran Terbaru</h3>
            <p>Catatan setoran sampah terbaru</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nasabah</th>
                <th>Tanggal</th>
                <th>Jenis Sampah</th>
                <th>Berat</th>
                <th>Nilai Setoran</th>
              </tr>
            </thead>

            <tbody>
              {(data.recent || []).map((item) => (
                <tr key={item.id}>
                  <td><b>{item.nama}</b></td>
                  <td>{fmtDate(item.tanggal)}</td>
                  <td>{item.jenis_sampah}</td>
                  <td>{item.berat} kg</td>
                  <td className="positive">{fmt(item.nilai)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {!data.recent?.length && (
            <p className="empty">Belum ada transaksi.</p>
          )}
        </div>
      </Card>
    </>
  );
}

function Nasabah({ data, api, message, reload }) {
  const [form, setForm] = useState({
    no_buku: '',
    nama: '',
    alamat: '',
    no_hp: '',
  });

  const [show, setShow] = useState(false);
  const [q, setQ] = useState('');

  const rows = (data.rows || []).filter((item) =>
    `${item.nama || ''} ${item.no_buku || ''}`
      .toLowerCase()
      .includes(q.toLowerCase())
  );

  async function save(e) {
    e.preventDefault();

    try {
      await api('/nasabah', {
        method: 'POST',
        body: JSON.stringify(form),
      });

      message('Nasabah berhasil ditambahkan.');
      setForm({
        no_buku: '',
        nama: '',
        alamat: '',
        no_hp: '',
      });
      setShow(false);
      await reload();
    } catch (error) {
      message(error.message);
    }
  }

  return (
    <>
      <Heading
        title="Data Nasabah"
        desc="Kelola data anggota Bank Sampah Lestari."
        action={
          <button
            className="primary"
            onClick={() => setShow(!show)}
          >
            <Plus size={17} /> Tambah Nasabah
          </button>
        }
      />

      {show && (
        <Card>
          <form className="form-grid" onSubmit={save}>
            {[
              ['no_buku', 'Nomor Buku'],
              ['nama', 'Nama Nasabah'],
              ['alamat', 'Alamat'],
              ['no_hp', 'Nomor HP'],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  required={key === 'no_buku' || key === 'nama'}
                  value={form[key]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      [key]: e.target.value,
                    })
                  }
                />
              </label>
            ))}

            <button className="primary">Simpan Nasabah</button>
          </form>
        </Card>
      )}

      <Card>
        <div className="table-toolbar">
          <h3>
            Daftar Nasabah <span className="count">{rows.length}</span>
          </h3>

          <div className="search">
            <Search size={16} />
            <input
              placeholder="Cari nama atau nomor buku..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <Table
          headers={['No. Buku', 'Nama', 'Alamat', 'No. HP', 'Saldo']}
          rows={rows.map((item) => [
            item.no_buku,
            item.nama,
            item.alamat,
            item.no_hp,
            <b>{fmt(item.saldo)}</b>,
          ])}
        />
      </Card>
    </>
  );
}

function Table({ headers, rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((value, cellIndex) => (
                <td key={cellIndex}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {!rows.length && (
        <p className="empty">
          Belum ada data yang dapat ditampilkan.
        </p>
      )}
    </div>
  );
}

function Harga({ data, api, message, reload }) {
  const [values, setValues] = useState({});

  async function save(id, current) {
    const value = values[id] ?? current;

    if (
      value === '' ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0
    ) {
      message('Masukkan harga yang valid.');
      return;
    }

    try {
      await api('/harga/' + id, {
        method: 'PUT',
        body: JSON.stringify({
          harga_per_kg: Number(value),
        }),
      });

      message('Harga sampah berhasil diperbarui.');
      await reload();
    } catch (error) {
      message(error.message);
    }
  }

  return (
    <>
      <Heading
        title="Kelola Harga Sampah"
        desc="Tentukan harga pembelian setiap jenis sampah per kilogram. Harga ini digunakan secara otomatis saat setoran dicatat."
      />

      <Card>
        <div className="table-toolbar">
          <h3>Daftar Harga Sampah</h3>
          <span className="status">● Harga saat ini</span>
        </div>

        <Table
          headers={[
            'Jenis Sampah',
            'Harga per Kilogram',
            'Terakhir Diperbarui',
            'Tindakan',
          ]}
          rows={(data.rows || []).map((item) => [
            <b>{item.jenis_sampah}</b>,
            <div className="price-input">
              Rp
              <input
                type="number"
                min="0"
                value={values[item.id_harga] ?? item.harga_per_kg}
                onChange={(e) =>
                  setValues({
                    ...values,
                    [item.id_harga]: e.target.value,
                  })
                }
              />
            </div>,
            fmtDate(item.tgl_mulai),
            <button
              className="small-primary"
              onClick={() =>
                save(item.id_harga, item.harga_per_kg)
              }
            >
              Simpan
            </button>,
          ])}
        />
      </Card>
    </>
  );
}

function Setoran({ data, api, message, reload }) {
  const [customer, setCustomer] = useState('');
  const [items, setItems] = useState({});
  const [tanggal, setTanggal] = useState(dateNow());
  const [saving, setSaving] = useState(false);

  const prices = data.prices || [];

  const total = prices.reduce(
    (sum, price) =>
      sum +
      Number(items[price.jenis_sampah] || 0) *
      Number(price.harga_per_kg || 0),
    0
  );

  async function save(e) {
    e.preventDefault();

    if (saving) return;

    const hasWeight = prices.some(
      (price) => Number(items[price.jenis_sampah] || 0) > 0
    );

    if (!hasWeight) {
      message('Masukkan berat minimal satu jenis sampah.');
      return;
    }

    setSaving(true);

    try {
      const result = await api('/setoran', {
        method: 'POST',
        body: JSON.stringify({
          id_nasabah: customer,
          tanggal,
          items: prices.map((price) => ({
            jenis: price.jenis_sampah,
            berat: Number(items[price.jenis_sampah] || 0),
          })),
        }),
      });

      message('Setoran tersimpan. Nilai: ' + fmt(result.total));
      setItems({});
      await reload();
    } catch (error) {
      message(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Heading
        title="Pencatatan Setoran Sampah"
        desc="Catat berat sampah nasabah. Saldo akan bertambah otomatis berdasarkan harga aktif."
      />

      <form onSubmit={save}>
        <div className="transaction-layout">
          <Card>
            <h3>Detail Setoran</h3>

            <div className="field">
              <label>Nama Nasabah</label>
              <select
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
                required
              >
                <option value="">Pilih nasabah</option>
                {(data.customers || []).map((item) => (
                  <option
                    value={item.id_nasabah}
                    key={item.id_nasabah}
                  >
                    {item.nama} — {item.no_buku}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Tanggal Setoran</label>
              <input
                type="date"
                value={tanggal}
                onChange={(e) => setTanggal(e.target.value)}
                required
              />
            </div>

            <div className="section-label">
              Jenis dan Berat Sampah
            </div>

            <div className="weight-grid">
              {prices.map((price) => (
                <label key={price.id_harga}>
                  <span>
                    {price.jenis_sampah}
                    <small>
                      {fmt(price.harga_per_kg)}/kg
                    </small>
                  </span>

                  <div>
                    <input
                      type="number"
                      min="0"
                      step=".1"
                      placeholder="0"
                      value={items[price.jenis_sampah] || ''}
                      onChange={(e) =>
                        setItems({
                          ...items,
                          [price.jenis_sampah]: e.target.value,
                        })
                      }
                    />
                    kg
                  </div>
                </label>
              ))}
            </div>

            <button
              className="primary full"
              disabled={saving}
            >
              <Recycle size={17} />
              {saving ? 'Menyimpan...' : 'Simpan Setoran'}
            </button>
          </Card>

          <Card className="summary-card">
            <div className="stat-icon green">
              <Wallet />
            </div>

            <h3>Ringkasan Setoran</h3>
            <p>Total estimasi nilai setoran</p>
            <strong>{fmt(total)}</strong>

            <div className="summary-note">
              Nilai akhir dihitung otomatis dari berat sampah dikalikan harga aktif.
            </div>
          </Card>
        </div>
      </form>
    </>
  );
}

function Penarikan({ data, api, message, reload }) {
  const [form, setForm] = useState({
    id_nasabah: '',
    jumlah: '',
    keterangan: '',
  });

  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();

    if (saving) return;

    setSaving(true);

    try {
      await api('/penarikan', {
        method: 'POST',
        body: JSON.stringify(form),
      });

      message('Penarikan berhasil dicatat.');

      setForm({
        id_nasabah: '',
        jumlah: '',
        keterangan: '',
      });

      await reload();
    } catch (error) {
      message(error.message);
    } finally {
      setSaving(false);
    }
  }

  const selected = (data.customers || []).find(
    (item) =>
      String(item.id_nasabah) === String(form.id_nasabah)
  );

  return (
    <>
      <Heading
        title="Penarikan Saldo"
        desc="Catat penarikan saldo oleh nasabah. Sistem akan memeriksa saldo sebelum transaksi."
      />

      <Card className="narrow-card">
        <form className="stack-form" onSubmit={save}>
          <label>
            Nama Nasabah
            <select
              required
              value={form.id_nasabah}
              onChange={(e) =>
                setForm({
                  ...form,
                  id_nasabah: e.target.value,
                })
              }
            >
              <option value="">Pilih nasabah</option>

              {(data.customers || []).map((item) => (
                <option
                  value={item.id_nasabah}
                  key={item.id_nasabah}
                >
                  {item.nama}
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <div className="balance-hint">
              Saldo tersedia <b>{fmt(selected.saldo)}</b>
            </div>
          )}

          <label>
            Jumlah Penarikan
            <input
              type="number"
              min="1"
              step="1"
              value={form.jumlah}
              onChange={(e) =>
                setForm({
                  ...form,
                  jumlah: e.target.value,
                })
              }
              required
              placeholder="Masukkan jumlah penarikan"
            />
          </label>

          <label>
            Keterangan
            <textarea
              value={form.keterangan}
              onChange={(e) =>
                setForm({
                  ...form,
                  keterangan: e.target.value,
                })
              }
              placeholder="Keterangan penarikan (opsional)"
            />
          </label>

          <button className="primary full" disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Penarikan'}
          </button>
        </form>
      </Card>
    </>
  );
}

function Penjualan({ data, api, message, reload }) {
  const [form, setForm] = useState({
    id_pengepul: '',
    jenis_sampah: 'Plastik',
    berat_jual: '',
    harga_jual: '',
    pembeli: '',
  });

  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();

    if (saving) return;

    setSaving(true);

    try {
      await api('/penjualan', {
        method: 'POST',
        body: JSON.stringify(form),
      });

      message('Penjualan berhasil dicatat.');

      setForm({
        ...form,
        berat_jual: '',
        harga_jual: '',
      });

      await reload();
    } catch (error) {
      message(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Heading
        title="Penjualan ke Pengepul"
        desc="Catat penjualan sampah yang sudah terkumpul kepada pengepul."
      />

      <div className="two-col">
        <Card>
          <form className="stack-form" onSubmit={save}>
            <h3>Transaksi Penjualan</h3>

            <label>
              Pengepul
              <select
                value={form.id_pengepul}
                onChange={(e) =>
                  setForm({
                    ...form,
                    id_pengepul: e.target.value,
                  })
                }
              >
                <option value="">
                  Pilih pengepul (tidak wajib)
                </option>

                {(data.collectors || []).map((item) => (
                  <option
                    value={item.id_pengepul}
                    key={item.id_pengepul}
                  >
                    {item.nama}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Jenis Sampah
              <select
                value={form.jenis_sampah}
                onChange={(e) =>
                  setForm({
                    ...form,
                    jenis_sampah: e.target.value,
                  })
                }
                required
              >
                {(data.prices || []).map((item) => (
                  <option
                    key={item.id_harga}
                    value={item.jenis_sampah}
                  >
                    {item.jenis_sampah}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Berat yang Dijual (kg)
              <input
                type="number"
                min=".1"
                step=".1"
                required
                value={form.berat_jual}
                onChange={(e) =>
                  setForm({
                    ...form,
                    berat_jual: e.target.value,
                  })
                }
              />
            </label>

            <label>
              Harga Jual per Kilogram (Rp)
              <input
                type="number"
                min="1"
                step="1"
                required
                value={form.harga_jual}
                onChange={(e) =>
                  setForm({
                    ...form,
                    harga_jual: e.target.value,
                  })
                }
              />
            </label>

            <label>
              Nama Pembeli
              <input
                value={form.pembeli}
                onChange={(e) =>
                  setForm({
                    ...form,
                    pembeli: e.target.value,
                  })
                }
              />
            </label>

            <button className="primary full" disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan Penjualan'}
            </button>
          </form>
        </Card>

        <Card className="summary-card">
          <div className="stat-icon orange">
            <ShoppingCart />
          </div>

          <h3>Perkiraan Total Penjualan</h3>

          <strong>
            {fmt(
              Number(form.berat_jual || 0) *
              Number(form.harga_jual || 0)
            )}
          </strong>

          <p>Berat dikalikan harga jual per kilogram.</p>
        </Card>
      </div>

      <Card>
        <h3>Riwayat Penjualan</h3>

        <Table
          headers={[
            'Tanggal',
            'Jenis Sampah',
            'Berat',
            'Harga/kg',
            'Total',
            'Pengepul',
          ]}
          rows={(data.rows || []).map((item) => [
            fmtDate(item.tanggal),
            item.jenis_sampah,
            item.berat_jual + ' kg',
            fmt(item.harga_jual),
            fmt(item.total),
            item.nama_pengepul || item.pembeli || '-',
          ])}
        />
      </Card>
    </>
  );
}

function Laporan({ data, api, setData }) {
  const [month, setMonth] = useState(
    new Date().getMonth() + 1
  );

  const [year, setYear] = useState(
    new Date().getFullYear()
  );

  const [loading, setLoading] = useState(false);

  async function show() {
    if (loading) return;

    setLoading(true);

    try {
      const result = await api(
        `/laporan?month=${month}&year=${year}`
      );

      setData(result);
    } catch (error) {
      alert(error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Heading
        title="Laporan Bulanan"
        desc="Rangkuman setoran, penarikan, dan penjualan pada periode yang dipilih."
        action={
          <button
            className="primary"
            onClick={() => window.print()}
          >
            <Printer size={17} /> Cetak Laporan
          </button>
        }
      />

      <Card>
        <div className="filters">
          <label>
            Bulan
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {[
                'Januari', 'Februari', 'Maret', 'April',
                'Mei', 'Juni', 'Juli', 'Agustus',
                'September', 'Oktober', 'November', 'Desember',
              ].map((name, index) => (
                <option value={index + 1} key={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Tahun
            <input
              type="number"
              min="2000"
              max="2100"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            />
          </label>

          <button
            className="primary"
            onClick={show}
            disabled={loading}
          >
            {loading ? 'Memuat...' : 'Tampilkan Laporan'}
          </button>
        </div>

        <div className="report-stats">
          <div>
            <small>Total Setoran</small>
            <b>{fmt(data.setor?.total)}</b>
            <span>{Number(data.setor?.berat || 0)} kg</span>
          </div>

          <div>
            <small>Total Penarikan</small>
            <b>{fmt(data.tarik?.total)}</b>
          </div>

          <div>
            <small>Total Penjualan</small>
            <b>{fmt(data.jual?.total)}</b>
            <span>{Number(data.jual?.berat || 0)} kg</span>
          </div>
        </div>

        <h3>Rincian Setoran Berdasarkan Jenis Sampah</h3>

        <Table
          headers={[
            'Jenis Sampah',
            'Berat Terkumpul',
            'Total Nilai',
          ]}
          rows={(data.detail || []).map((item) => [
            item.jenis,
            item.berat + ' kg',
            fmt(item.total),
          ])}
        />
      </Card>
    </>
  );
}

function Notifications({ data }) {
  return (
    <>
      <Heading
        title="Notifikasi"
        desc="Informasi terbaru mengenai aktivitas dan transaksi."
      />

      <div className="notification-list">
        {(data.rows || []).map((item) => (
          <Card className="notification" key={item.id}>
            <div className="notice-icon">
              <Bell size={19} />
            </div>

            <div>
              <b>{item.message}</b>
              <small>{fmtDate(item.created_at)}</small>
            </div>

            <span className="status">Informasi</span>
          </Card>
        ))}
      </div>

      {!data.rows?.length && (
        <Card>
          <p className="empty">Belum ada notifikasi.</p>
        </Card>
      )}
    </>
  );
}

function Saldo({ data }) {
  return (
    <>
      <Heading
        title="Saldo Saya"
        desc="Lihat saldo dan riwayat transaksi rekening nasabah."
      />

      <Card className="my-balance">
        <div className="stat-icon green">
          <Wallet />
        </div>

        <span>Saldo tersedia</span>
        <strong>{fmt(data.customer?.saldo)}</strong>

        <small>
          {data.customer?.nama || 'Data nasabah belum tersedia.'}
        </small>
      </Card>

      <Card>
        <h3>Riwayat Transaksi</h3>

        <Table
          headers={['Tanggal', 'Jenis', 'Kategori', 'Nilai']}
          rows={(data.items || []).map((item) => [
            fmtDate(item.tanggal),
            item.tipe,
            item.jenis_sampah,
            item.tipe === 'Setoran'
              ? <b className="positive">+ {fmt(item.nilai)}</b>
              : <b className="negative">- {fmt(item.nilai)}</b>,
          ])}
        />
      </Card>
    </>
  );
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Elemen root tidak ditemukan pada index.html.');
}

createRoot(rootElement).render(<App />);