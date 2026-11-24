import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  X,
  Printer,
  Shield,
  Eye,
  EyeOff,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { fmt, fmtDate, fmtKg } from '../utils/format.js';

export function Heading({ title, desc, action }) {
  return (
    <div className="page-heading">
      <div>
        <h2>{title}</h2>
        {desc && <p>{desc}</p>}
      </div>
      {action && <div className="heading-actions">{action}</div>}
    </div>
  );
}

export function Card({ children, className = '', style }) {
  return (
    <section className={'card ' + className} style={style}>
      {children}
    </section>
  );
}

export function Badge({ children, variant = 'green' }) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

export function AnimatedValue({ value, formatter = (v) => v }) {
  const numeric = Number(value);
  const isNumeric = Number.isFinite(numeric);
  const [display, setDisplay] = useState(isNumeric ? 0 : value);

  useEffect(() => {
    if (!isNumeric) {
      setDisplay(value);
      return;
    }

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      setDisplay(numeric);
      return;
    }

    const startVal = 0;
    const duration = 420;
    const startTime = performance.now();
    let frameId;

    const step = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(startVal + (numeric - startVal) * eased);
      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      } else {
        setDisplay(numeric);
      }
    };

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [numeric, isNumeric, value]);

  return <>{isNumeric ? formatter(display) : value}</>;
}

export function SkeletonPage({ cards = 4 }) {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label="Memuat data">
      <div className="skeleton-banner shimmer" />
      <div className="stat-grid">
        {Array.from({ length: cards }).map((_, i) => (
          <div className="card stat-card skeleton-card" key={i}>
            <div className="skeleton-box shimmer" style={{ width: 42, height: 42, borderRadius: 12 }} />
            <div className="skeleton-line shimmer" style={{ width: '55%', marginTop: 14 }} />
            <div className="skeleton-line shimmer" style={{ width: '80%', height: 22, marginTop: 8 }} />
            <div className="skeleton-line shimmer" style={{ width: '40%', marginTop: 8 }} />
          </div>
        ))}
      </div>
      <div className="card">
        <div className="skeleton-line shimmer" style={{ width: '35%', height: 16 }} />
        <div className="skeleton-line shimmer" style={{ width: '100%', height: 38, marginTop: 16 }} />
        <div className="skeleton-line shimmer" style={{ width: '100%', height: 38, marginTop: 10 }} />
        <div className="skeleton-line shimmer" style={{ width: '100%', height: 38, marginTop: 10 }} />
      </div>
    </div>
  );
}

export function DataTable({
  headers,
  rows,
  emptyText = 'Belum ada data yang dapat ditampilkan.',
  pageSize = 15,
}) {
  const [pageIdx, setPageIdx] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    if (pageIdx > totalPages) {
      setPageIdx(1);
    }
  }, [rows.length, totalPages, pageIdx]);

  const start = (pageIdx - 1) * pageSize;
  const visibleRows = pageSize > 0 ? rows.slice(start, start + pageSize) : rows;

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
          {visibleRows.map((row, index) => (
            <tr key={start + index}>
              {row.map((value, cellIndex) => (
                <td key={cellIndex}>{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {!rows.length && <p className="empty">{emptyText}</p>}

      {rows.length > pageSize && pageSize > 0 && (
        <div className="pagination">
          <span>
            Menampilkan {start + 1}–{Math.min(start + pageSize, rows.length)} dari{' '}
            <b>{rows.length}</b> data
          </span>
          <div className="pagination-controls">
            <button
              type="button"
              className="ghost-btn"
              disabled={pageIdx <= 1}
              onClick={() => setPageIdx((p) => Math.max(1, p - 1))}
              aria-label="Halaman sebelumnya"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="page-indicator">
              {pageIdx} / {totalPages}
            </span>
            <button
              type="button"
              className="ghost-btn"
              disabled={pageIdx >= totalPages}
              onClick={() => setPageIdx((p) => Math.min(totalPages, p + 1))}
              aria-label="Halaman berikutnya"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, subtitle, width = 520, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="modal-panel" style={{ maxWidth: width }}>
        <div className="modal-header">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Tutup dialog"
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  open,
  title = 'Konfirmasi Tindakan',
  message,
  confirmLabel = 'Ya, Lanjutkan',
  cancelLabel = 'Batal',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  return (
    <Modal open={open} onClose={busy ? undefined : onCancel} title={title} width={440}>
      <p className="confirm-text">{message}</p>
      <div className="modal-actions">
        <button
          type="button"
          className="secondary-btn"
          onClick={onCancel}
          disabled={busy}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          className={danger ? 'danger-btn' : 'primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Memproses...' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function ToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null;

  const iconFor = (type) => {
    if (type === 'error') return <AlertCircle size={18} />;
    if (type === 'warning') return <AlertTriangle size={18} />;
    if (type === 'info') return <Info size={18} />;
    return <CheckCircle2 size={18} />;
  };

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((item) => (
        <div key={item.id} className={`toast toast-${item.type || 'success'}`}>
          <span className="toast-icon">{iconFor(item.type)}</span>
          <span className="toast-msg">{item.text}</span>
          <button
            type="button"
            className="toast-close"
            onClick={() => onDismiss(item.id)}
            aria-label="Tutup notifikasi"
          >
            <X size={14} />
          </button>
          <span
            className="toast-progress"
            style={{ animationDuration: `${item.duration || 4000}ms` }}
          />
        </div>
      ))}
    </div>
  );
}

export function ReceiptModal({ receipt, onClose }) {
  useEffect(() => {
    if (!receipt) return undefined;
    document.body.classList.add('printing-receipt');
    return () => {
      document.body.classList.remove('printing-receipt');
    };
  }, [receipt]);

  if (!receipt) return null;

  const isSetoran = receipt.tipe === 'Setoran Sampah';

  return (
    <Modal
      open={Boolean(receipt)}
      onClose={onClose}
      title="Bukti Transaksi"
      subtitle="Simpan atau cetak bukti transaksi ini untuk nasabah"
      width={460}
    >
      <div className="receipt-box printable-receipt">
        <div className="receipt-head">
          <strong>BANK SAMPAH LESTARI</strong>
          <span>{receipt.tipe}</span>
        </div>

        <div className="receipt-meta">
          <div><span>Tanggal</span><b>{fmtDate(receipt.tanggal)}</b></div>
          <div><span>Nasabah</span><b>{receipt.nama_nasabah} ({receipt.no_buku})</b></div>
          <div><span>Petugas</span><b>{receipt.petugas}</b></div>
        </div>

        {isSetoran && Array.isArray(receipt.items) && (
          <div className="receipt-items">
            {receipt.items.map((item, idx) => (
              <div className="receipt-row" key={idx}>
                <span>
                  {item.jenis_sampah} ({fmtKg(item.berat)} × {fmt(item.harga)})
                </span>
                <b>{fmt(item.nilai)}</b>
              </div>
            ))}
          </div>
        )}

        {!isSetoran && (
          <div className="receipt-items">
            <div className="receipt-row">
              <span>Jumlah Penarikan</span>
              <b>{fmt(receipt.jumlah)}</b>
            </div>
            {receipt.keterangan && (
              <div className="receipt-row">
                <span>Keterangan</span>
                <b>{receipt.keterangan}</b>
              </div>
            )}
          </div>
        )}

        <div className="receipt-total">
          <div>
            <span>{isSetoran ? 'Total Setoran' : 'Total Ditarik'}</span>
            <strong>{fmt(isSetoran ? receipt.total : receipt.jumlah)}</strong>
          </div>
          <div>
            <span>Saldo Akhir Nasabah</span>
            <b>{fmt(receipt.saldo_akhir)}</b>
          </div>
        </div>
      </div>

      <div className="modal-actions no-print">
        <button type="button" className="secondary-btn" onClick={onClose}>
          Tutup
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => window.print()}
        >
          <Printer size={15} /> Cetak Struk
        </button>
      </div>
    </Modal>
  );
}

export function PasswordModal({
  open,
  onClose,
  api,
  onSuccess,
  onLogoutAll,
  notify,
}) {
  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [showPwd, setShowPwd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setForm({ current_password: '', new_password: '', confirm_password: '' });
      setError('');
    }
  }, [open]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (saving) return;
    setError('');

    if (form.new_password !== form.confirm_password) {
      setError('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }

    if (form.new_password.length < 8 || !/[A-Za-z]/.test(form.new_password) || !/\d/.test(form.new_password)) {
      setError('Kata sandi baru minimal 8 karakter dengan kombinasi huruf dan angka.');
      return;
    }

    setSaving(true);
    try {
      const res = await api('/me/password', {
        method: 'PUT',
        body: JSON.stringify({
          current_password: form.current_password,
          new_password: form.new_password,
        }),
      });
      onSuccess(res);
      notify('Kata sandi berhasil diperbarui. Sesi di perangkat lain telah dicabut.', 'success');
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoutAll() {
    if (revoking) return;
    setRevoking(true);
    try {
      await api('/logout-all', { method: 'POST' });
      onClose();
      onLogoutAll();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? undefined : onClose}
      title="Keamanan Akun"
      subtitle="Perbarui kata sandi secara berkala untuk melindungi data transaksi."
      width={460}
    >
      <form className="stack-form" onSubmit={handleSubmit}>
        <label>
          Kata Sandi Saat Ini
          <div className="input-with-icon">
            <input
              type={showPwd ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={form.current_password}
              onChange={(e) =>
                setForm({ ...form, current_password: e.target.value })
              }
              placeholder="Masukkan kata sandi lama"
            />
            <button
              type="button"
              className="eye-btn"
              onClick={() => setShowPwd((v) => !v)}
              aria-label="Tampilkan atau sembunyikan kata sandi"
            >
              {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>

        <label>
          Kata Sandi Baru
          <input
            type={showPwd ? 'text' : 'password'}
            required
            minLength={8}
            autoComplete="new-password"
            value={form.new_password}
            onChange={(e) => setForm({ ...form, new_password: e.target.value })}
            placeholder="Min. 8 karakter (huruf & angka)"
          />
        </label>

        <label>
          Konfirmasi Kata Sandi Baru
          <input
            type={showPwd ? 'text' : 'password'}
            required
            minLength={8}
            autoComplete="new-password"
            value={form.confirm_password}
            onChange={(e) =>
              setForm({ ...form, confirm_password: e.target.value })
            }
            placeholder="Ulangi kata sandi baru"
          />
        </label>

        {error && (
          <div className="inline-error">
            <AlertCircle size={15} />
            <span>{error}</span>
          </div>
        )}

        <button className="primary full" disabled={saving}>
          <Shield size={16} />
          {saving ? 'Menyimpan...' : 'Perbarui Kata Sandi'}
        </button>
      </form>

      <div className="security-divider">
        <span>Manajemen Sesi</span>
        <button
          type="button"
          className="danger-outline-btn"
          disabled={revoking}
          onClick={handleLogoutAll}
        >
          <LogOut size={15} />
          {revoking ? 'Mengakhiri sesi...' : 'Keluar dari Semua Perangkat'}
        </button>
      </div>
    </Modal>
  );
}
