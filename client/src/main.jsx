function App() {
  const [token, setToken] = useState(localStorage.getItem('bsl_token') || '');
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
    password: 'lestari'
  });

  async function api(path, opts = {}) {
    const r = await fetch(API + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(opts.headers || {})
      }
    });

    const j = await r.json();

    if (!r.ok) {
      throw new Error(j.error || 'Terjadi kesalahan');
    }

    return j;
  }

  function message(t) {
    setToast(t);
    setTimeout(() => setToast(''), 3000);
  }

  async function load() {
    if (!token) return;

    try {
      if (page === 'dashboard') {
        setData(await api('/dashboard'));
      } else if (page === 'nasabah') {
        setData({ rows: await api('/nasabah') });
      } else if (page === 'harga') {
        setData({ rows: await api('/harga') });
      } else if (page === 'setoran') {
        setData({
          customers: await api('/nasabah'),
          prices: await api('/harga')
        });
      } else if (page === 'penarikan') {
        setData({ customers: await api('/nasabah') });
      } else if (page === 'penjualan') {
        setData({
          rows: await api('/penjualan'),
          prices: await api('/harga'),
          collectors: await api('/pengepul')
        });
      } else if (page === 'laporan') {
        setData(await api('/laporan'));
      } else if (page === 'notifikasi') {
        setData({ rows: await api('/notifications') });
      } else if (page === 'saldo') {
        setData(await api('/riwayat-saya'));
      }
    } catch (e) {
      message(e.message);
    }
  }

  useEffect(() => {
    load();
  }, [token, page]);

  async function doLogin(e) {
    e.preventDefault();
    setBusy(true);

    try {
      const d = await api('/login', {
        method: 'POST',
        body: JSON.stringify(login)
      });

      setToken(d.token);
      setUser(d.user);

      localStorage.setItem('bsl_token', d.token);
      localStorage.setItem('bsl_user', JSON.stringify(d.user));

      message('Selamat datang, ' + d.user.nama_user);
    } catch (e) {
      message(e.message);
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    setToken('');
    setUser(null);
    localStorage.removeItem('bsl_token');
    localStorage.removeItem('bsl_user');
    setPage('dashboard');
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
    ['notifikasi', 'Notifikasi', Bell, ['Ketua', 'Bendahara', 'Petugas Timbang', 'Nasabah']]
  ];

  const visible = nav.filter(n => n[3].includes(user?.role));

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
          <span className="brand-icon"><Recycle size={27} /></span>
          <span>Bank Sampah<strong>Lestari</strong></span>
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
            <div className="avatar">{user.nama_user?.[0]}</div>
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
            <h1>{nav.find(n => n[0] === page)?.[1] || 'Dasbor'}</h1>
          </div>

          <div className="top-actions">
            <button className="icon-btn" onClick={() => setPage('notifikasi')}>
              <Bell size={19} />
              <i />
            </button>

            <div className="profile">
              <div className="avatar">{user.nama_user?.[0]}</div>
              <span>
                <b>{user.nama_user}</b>
                <small>{user.role}</small>
              </span>
              <ChevronDown size={15} />
            </div>
          </div>
        </header>

        <div className="content">
          {page === 'dashboard' && <Dashboard data={data} setPage={setPage} />}
          {page === 'nasabah' && <Nasabah data={data} api={api} message={message} reload={load} />}
          {page === 'harga' && <Harga data={data} api={api} message={message} reload={load} />}
          {page === 'setoran' && <Setoran data={data} api={api} message={message} reload={load} />}
          {page === 'penarikan' && <Penarikan data={data} api={api} message={message} reload={load} />}
          {page === 'penjualan' && <Penjualan data={data} api={api} message={message} reload={load} />}
          {page === 'laporan' && <Laporan data={data} api={api} setData={setData} />}
          {page === 'notifikasi' && <Notifications data={data} />}
          {page === 'saldo' && <Saldo data={data} />}
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