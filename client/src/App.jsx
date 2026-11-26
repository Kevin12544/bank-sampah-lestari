import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LayoutDashboard,
  Recycle,
  Wallet,
  Users,
  Scale,
  ShoppingCart,
  FileText,
  Bell,
  LogOut,
  ChevronDown,
  Shield,
  KeyRound,
  UserCog,
  Menu,
  X,
  AlertTriangle,
} from 'lucide-react';
import { apiRequest } from './api.js';
import { defaultPageForRole } from './utils/format.js';
import { PasswordModal, SkeletonPage, ToastContainer } from './components/UI.jsx';

import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import NasabahPage from './pages/NasabahPage.jsx';
import HargaPage from './pages/HargaPage.jsx';
import SetoranPage from './pages/SetoranPage.jsx';
import PenarikanPage from './pages/PenarikanPage.jsx';
import PenjualanPage from './pages/PenjualanPage.jsx';
import LaporanPage from './pages/LaporanPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import SaldoPage from './pages/SaldoPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import AuditLogPage from './pages/AuditLogPage.jsx';

const NAV_ITEMS = [
  ['dashboard', 'Dasbor', LayoutDashboard, ['Ketua', 'Bendahara', 'Petugas Timbang']],
  ['saldo', 'Saldo Saya', Wallet, ['Nasabah']],
  ['setoran', 'Setoran Sampah', Recycle, ['Ketua', 'Petugas Timbang', 'Bendahara']],
  ['penarikan', 'Penarikan Saldo', Wallet, ['Ketua', 'Bendahara']],
  ['penjualan', 'Penjualan', ShoppingCart, ['Ketua', 'Bendahara']],
  ['nasabah', 'Data Nasabah', Users, ['Ketua', 'Bendahara']],
  ['harga', 'Kelola Harga', Scale, ['Ketua', 'Bendahara']],
  ['laporan', 'Laporan', FileText, ['Ketua', 'Bendahara']],
  ['users', 'Pengguna', UserCog, ['Ketua']],
  ['audit', 'Log Audit', Shield, ['Ketua', 'Bendahara']],
  ['notifikasi', 'Notifikasi', Bell, ['Ketua', 'Bendahara', 'Petugas Timbang', 'Nasabah']],
];

function readStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('bsl_user') || 'null');
  } catch {
    return null;
  }
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('bsl_token') || '');
  const [user, setUser] = useState(readStoredUser);
  const [page, setPage] = useState(() => defaultPageForRole(readStoredUser()?.role));
  const [data, setData] = useState({});
  const [loadingPage, setLoadingPage] = useState(() =>
    Boolean(localStorage.getItem('bsl_token'))
  );

  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState('');

  const [toasts, setToasts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  const loadRequestRef = useRef(0);
  const toastIdRef = useRef(0);
  const profileRef = useRef(null);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (text, type = 'success') => {
      const id = ++toastIdRef.current;
      const duration = type === 'error' ? 5500 : 3800;
      setToasts((prev) => [...prev.slice(-3), { id, text, type, duration }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    },
    []
  );

  const logout = useCallback((showMessage = false) => {
    loadRequestRef.current++;
    setToken('');
    setUser(null);
    setData({});
    setUnreadCount(0);
    setPage('dashboard');
    setProfileMenuOpen(false);
    setMobileMenuOpen(false);
    localStorage.removeItem('bsl_token');
    localStorage.removeItem('bsl_user');
    if (showMessage) {
      notify('Sesi Anda telah berakhir. Silakan login kembali.', 'info');
    }
  }, [notify]);

  const api = useCallback(
    (path, opts = {}) =>
      apiRequest(path, {
        ...opts,
        token,
        onUnauthorized: () => logout(true),
      }),
    [token, logout]
  );

  const visibleNav = useMemo(
    () => NAV_ITEMS.filter((item) => item[3].includes(user?.role)),
    [user?.role]
  );

  // Jaga agar pengguna selalu berada di halaman yang sesuai dengan role-nya
  useEffect(() => {
    if (!token || !user || !visibleNav.length) return;
    const allowed = visibleNav.some((item) => item[0] === page);
    if (!allowed) {
      setPage(defaultPageForRole(user.role));
    }
  }, [token, user, visibleNav, page]);

  // Verifikasi token & sinkronkan profil terbaru dari server saat sesi ada
  useEffect(() => {
    if (!token) return;
    let active = true;

    (async () => {
      try {
        const freshUser = await api('/me');
        if (!active) return;
        const { unreadCount: unread, ...profile } = freshUser;
        setUser(profile);
        localStorage.setItem('bsl_user', JSON.stringify(profile));
        setUnreadCount(Number(unread || 0));
      } catch {
        // 401 sudah ditangani otomatis oleh onUnauthorized
      }
    })();

    return () => {
      active = false;
    };
  }, [token, api]);

  // Tutup dropdown profil saat klik di luar
  useEffect(() => {
    if (!profileMenuOpen) return undefined;
    const onDocClick = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [profileMenuOpen]);

  const userRole = user?.role || '';
  const userId = user?.id || 0;

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    if (!token || !userRole || !userId) return;

    const allowed = NAV_ITEMS.find((n) => n[0] === page)?.[3]?.includes(userRole);
    if (!allowed) return;

    setLoadingPage(true);
    try {
      let result = {};

      if (page === 'dashboard') {
        result = await api('/dashboard');
      } else if (page === 'nasabah') {
        result = { rows: await api('/nasabah') };
      } else if (page === 'harga') {
        try {
          result = await api('/harga-periode');
        } catch {
          result = { rows: await api('/harga'), legacyMode: true };
        }
      } else if (page === 'setoran') {
        result = await api('/page/setoran');
      } else if (page === 'penarikan') {
        result = await api('/page/penarikan');
      } else if (page === 'penjualan') {
        result = await api('/page/penjualan');
      } else if (page === 'laporan') {
        result = await api('/laporan');
      } else if (page === 'notifikasi') {
        const notifRes = await api('/notifications');
        result = notifRes;
        if (requestId === loadRequestRef.current) {
          setUnreadCount(Number(notifRes?.unreadCount || 0));
        }
      } else if (page === 'saldo') {
        result = await api('/riwayat-saya');
      } else if (page === 'users') {
        result = await api('/page/users');
      } else if (page === 'audit') {
        result = { rows: await api('/audit-logs') };
      }

      if (requestId === loadRequestRef.current) {
        setData(result);
      }
    } catch (error) {
      if (requestId === loadRequestRef.current) {
        notify(error.message, 'error');
      }
    } finally {
      if (requestId === loadRequestRef.current) {
        setLoadingPage(false);
      }
    }
  }, [token, userRole, userId, page, api, notify]);

  useEffect(() => {
    load();
    return () => {
      loadRequestRef.current++;
    };
  }, [load]);

  async function handleLogin(credentials) {
    if (loginBusy) return;
    setLoginBusy(true);
    setLoginError('');

    try {
      const result = await apiRequest('/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });

      const landingPage = defaultPageForRole(result.user.role);
      setLoadingPage(true);
      setData({});
      setPage(landingPage);
      setToken(result.token);
      setUser(result.user);

      localStorage.setItem('bsl_token', result.token);
      localStorage.setItem('bsl_user', JSON.stringify(result.user));

      notify('Selamat datang, ' + result.user.nama_user, 'success');
    } catch (error) {
      setLoginError(error.message);
    } finally {
      setLoginBusy(false);
    }
  }

  function handleNavigate(nextPage) {
    setMobileMenuOpen(false);
    if (nextPage === page) return;
    setLoadingPage(true);
    setData({});
    setPage(nextPage);
  }

  function handlePasswordChanged(res) {
    if (res?.token) {
      setToken(res.token);
      localStorage.setItem('bsl_token', res.token);
    }
    if (res?.user) {
      setUser(res.user);
      localStorage.setItem('bsl_user', JSON.stringify(res.user));
    }
  }

  if (!token || !user) {
    return (
      <>
        <LoginPage
          onLogin={handleLogin}
          busy={loginBusy}
          error={loginError}
          onClearError={() => setLoginError('')}
        />
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  const currentNavLabel =
    NAV_ITEMS.find((item) => item[0] === page)?.[1] || 'Dasbor';

  return (
    <div className="app-shell">
      {mobileMenuOpen && (
        <div
          className="mobile-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-icon">
            <Recycle size={26} />
          </span>
          <span>
            Bank Sampah<strong>Lestari</strong>
          </span>
          <button
            type="button"
            className="mobile-close-btn"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Tutup menu"
          >
            <X size={20} />
          </button>
        </div>

        <div className="side-caption">MENU UTAMA</div>

        <nav>
          {visibleNav.map(([id, label, Icon]) => (
            <button
              type="button"
              key={id}
              className={page === id ? 'nav-item active' : 'nav-item'}
              onClick={() => handleNavigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === 'notifikasi' && unreadCount > 0 && (
                <span className="nav-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="side-bottom">
          <div className="user-mini">
            <div className="avatar">{user.nama_user?.[0]?.toUpperCase() || '?'}</div>
            <div>
              <b>{user.nama_user}</b>
              <small>{user.role}</small>
            </div>
          </div>

          <button
            type="button"
            className="nav-item"
            onClick={() => {
              setMobileMenuOpen(false);
              setPasswordModalOpen(true);
            }}
          >
            <KeyRound size={17} />
            <span>Keamanan Akun</span>
          </button>

          <button
            type="button"
            className="nav-item"
            onClick={() => logout(false)}
          >
            <LogOut size={17} />
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="menu-toggle-btn"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Buka menu navigasi"
            >
              <Menu size={21} />
            </button>
            <div>
              <span className="eyebrow">SISTEM INFORMASI</span>
              <h1>{currentNavLabel}</h1>
            </div>
          </div>

          <div className="top-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={() => handleNavigate('notifikasi')}
              aria-label="Buka notifikasi"
            >
              <Bell size={19} />
              {unreadCount > 0 && (
                <span className="bell-badge">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            <div className="profile-wrap" ref={profileRef}>
              <button
                type="button"
                className="profile-btn"
                onClick={() => setProfileMenuOpen((v) => !v)}
                aria-expanded={profileMenuOpen}
              >
                <div className="avatar">
                  {user.nama_user?.[0]?.toUpperCase() || '?'}
                </div>
                <span>
                  <b>{user.nama_user}</b>
                  <small>{user.role}</small>
                </span>
                <ChevronDown
                  size={15}
                  className={profileMenuOpen ? 'rotated' : ''}
                />
              </button>

              {profileMenuOpen && (
                <div className="profile-dropdown">
                  <div className="dropdown-head">
                    <b>{user.nama_user}</b>
                    <small>@{user.username} · {user.role}</small>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setProfileMenuOpen(false);
                      setPasswordModalOpen(true);
                    }}
                  >
                    <KeyRound size={15} /> Ganti Kata Sandi
                  </button>
                  <button
                    type="button"
                    className="danger-text"
                    onClick={() => logout(false)}
                  >
                    <LogOut size={15} /> Keluar
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="content">
          {user.must_change_password && (
            <div className="security-banner no-print">
              <AlertTriangle size={18} />
              <div>
                <b>Disarankan mengganti kata sandi Anda.</b>
                <span>
                  Akun ini masih menggunakan kata sandi awal atau baru saja direset oleh administrator.
                </span>
              </div>
              <button
                type="button"
                className="small-primary"
                onClick={() => setPasswordModalOpen(true)}
              >
                Ganti Sekarang
              </button>
            </div>
          )}

          {loadingPage && !Object.keys(data).length ? (
            <SkeletonPage />
          ) : (
            <div key={page}>
              {page === 'dashboard' && (
                <DashboardPage data={data} user={user} setPage={handleNavigate} />
              )}
              {page === 'nasabah' && (
                <NasabahPage data={data} api={api} notify={notify} reload={load} />
              )}
              {page === 'harga' && (
                <HargaPage
                  data={data}
                  setData={setData}
                  api={api}
                  notify={notify}
                  reload={load}
                />
              )}
              {page === 'setoran' && (
                <SetoranPage
                  data={data}
                  user={user}
                  api={api}
                  notify={notify}
                  reload={load}
                />
              )}
              {page === 'penarikan' && (
                <PenarikanPage
                  data={data}
                  user={user}
                  api={api}
                  notify={notify}
                  reload={load}
                />
              )}
              {page === 'penjualan' && (
                <PenjualanPage data={data} api={api} notify={notify} reload={load} />
              )}
              {page === 'laporan' && (
                <LaporanPage
                  data={data}
                  api={api}
                  setData={setData}
                  notify={notify}
                />
              )}
              {page === 'notifikasi' && (
                <NotificationsPage
                  data={data}
                  api={api}
                  notify={notify}
                  reload={load}
                />
              )}
              {page === 'saldo' && <SaldoPage data={data} />}
              {page === 'users' && (
                <UsersPage
                  data={data}
                  user={user}
                  api={api}
                  notify={notify}
                  reload={load}
                />
              )}
              {page === 'audit' && <AuditLogPage data={data} />}
            </div>
          )}
        </div>

        <footer>
          © {new Date().getFullYear()} Bank Sampah Lestari · Menjaga Lingkungan, Menambah Manfaat
        </footer>
      </main>

      <PasswordModal
        open={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
        api={api}
        onSuccess={handlePasswordChanged}
        onLogoutAll={() => logout(true)}
        notify={notify}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
