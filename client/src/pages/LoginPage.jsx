import React, { useState } from 'react';
import {
  Recycle,
  AlertCircle,
  Eye,
  EyeOff,
  Lock,
  User,
  ShieldCheck,
  Leaf,
} from 'lucide-react';

const DEMO_ACCOUNTS = [
  { role: 'Ketua', username: 'ketua', password: 'lestari' },
  { role: 'Bendahara', username: 'bendahara', password: 'lestari' },
  { role: 'Petugas Timbang', username: 'petugas', password: 'lestari' },
  { role: 'Nasabah', username: 'nasabah', password: 'lestari' },
];

export default function LoginPage({ onLogin, busy, error, onClearError }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (busy) return;
    onLogin({ username: username.trim(), password });
  }

  return (
    <div className="login-page">
      <div className="login-art">
        <div className="orb orb-1" aria-hidden="true" />
        <div className="orb orb-2" aria-hidden="true" />

        <div className="art-logo">
          <Recycle size={72} />
        </div>

        <h1>
          Bank Sampah
          <br />
          <b>Lestari</b>
        </h1>

        <p>Menjaga Lingkungan, Menambah Manfaat</p>

        <div className="art-pillars">
          <span><Leaf size={15} /> Pencatatan Transparan</span>
          <span><ShieldCheck size={15} /> Keamanan Terlindungi</span>
        </div>

        <small>Mulai langkah kecil untuk bumi yang lebih baik.</small>
      </div>

      <form className="login-form" onSubmit={handleSubmit}>
        <div className="form-brand">
          <span className="form-brand-icon">
            <Recycle color="#fff" size={22} />
          </span>
          <span>
            Bank Sampah <b>Lestari</b>
          </span>
        </div>

        <span className="eyebrow">SELAMAT DATANG</span>
        <h2>Masuk ke Akun</h2>
        <p>Gunakan akun resmi Anda untuk mengakses sistem operasional.</p>

        <label>
          Nama Pengguna
          <div className="input-with-prefix">
            <User size={16} className="input-prefix-icon" />
            <input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (error) onClearError?.();
              }}
              placeholder="Masukkan nama pengguna"
              autoComplete="username"
              autoFocus
              required
            />
          </div>
        </label>

        <label>
          Kata Sandi
          <div className="input-with-prefix input-with-icon">
            <Lock size={16} className="input-prefix-icon" />
            <input
              type={showPwd ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) onClearError?.();
              }}
              placeholder="Masukkan kata sandi"
              autoComplete="current-password"
              required
            />
            <button
              type="button"
              className="eye-btn"
              onClick={() => setShowPwd((v) => !v)}
              aria-label={showPwd ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
            >
              {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        {error && (
          <div className="inline-error login-alert" role="alert">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <button className="primary full login-submit" disabled={busy}>
          {busy ? (
            <>
              <span className="btn-spinner" /> Memverifikasi...
            </>
          ) : (
            'Masuk ke Akun'
          )}
        </button>

        <div className="demo-accounts">
          <b>Account / Password</b>
          <div className="demo-account-list">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                type="button"
                key={acc.username}
                className="demo-account-row"
                onClick={() => {
                  setUsername(acc.username);
                  setPassword(acc.password);
                  if (error) onClearError?.();
                }}
                title={`Isi otomatis akun ${acc.role}`}
              >
                <code>{acc.username} : {acc.password}</code>
                <span>{acc.role}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="login-security-note">
          <ShieldCheck size={14} />
          <span>Dilindungi enkripsi sesi &amp; proteksi batas percobaan login.</span>
        </div>
      </form>
    </div>
  );
}
