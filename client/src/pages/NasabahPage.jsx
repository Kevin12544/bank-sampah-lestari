import React, { useRef, useState } from 'react';
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  History,
  Download,
  UserCheck,
  UserX,
} from 'lucide-react';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  Heading,
  Modal,
} from '../components/UI.jsx';
import { exportCsv, fmt, fmtDate, fmtKg } from '../utils/format.js';

const EMPTY_FORM = {
  no_buku: '',
  nama: '',
  alamat: '',
  no_hp: '',
  create_account: false,
  username: '',
  password: '',
};

export default function NasabahPage({ data, api, notify, reload }) {
  const [q, setQ] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [historyData, setHistoryData] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const historyReqRef = useRef(0);

  const allRows = data.rows || [];
  const rows = allRows.filter((item) =>
    `${item.nama || ''} ${item.no_buku || ''} ${item.alamat || ''} ${item.no_hp || ''} ${item.username || ''}`
      .toLowerCase()
      .includes(q.toLowerCase())
  );

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      no_buku: item.no_buku || '',
      nama: item.nama || '',
      alamat: item.alamat || '',
      no_hp: item.no_hp || '',
      create_account: false,
      username: '',
      password: '',
    });
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (saving) return;

    if (form.create_account) {
      if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password)) {
        notify('Password akun nasabah minimal 8 karakter (huruf dan angka).', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      const payload = {
        no_buku: form.no_buku.trim(),
        nama: form.nama.trim(),
        alamat: form.alamat.trim(),
        no_hp: form.no_hp.trim(),
        ...(form.create_account
          ? {
              create_account: true,
              username: form.username.trim().toLowerCase(),
              password: form.password,
            }
          : {}),
      };

      const res = editing
        ? await api(`/nasabah/${editing.id_nasabah}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await api('/nasabah', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      notify(res.message || 'Data nasabah berhasil disimpan.', 'success');
      setModalOpen(false);
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const res = await api(`/nasabah/${deleteTarget.id_nasabah}`, {
        method: 'DELETE',
      });
      notify(res.message || 'Nasabah berhasil dihapus.', 'success');
      setDeleteTarget(null);
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function openHistory(item) {
    const reqId = ++historyReqRef.current;
    setLoadingHistory(true);
    setHistoryData({ customer: item, items: [] });
    try {
      const res = await api(`/nasabah/${item.id_nasabah}/riwayat`);
      if (reqId === historyReqRef.current) {
        setHistoryData(res);
      }
    } catch (error) {
      if (reqId === historyReqRef.current) {
        notify(error.message, 'error');
        setHistoryData(null);
      }
    } finally {
      if (reqId === historyReqRef.current) {
        setLoadingHistory(false);
      }
    }
  }

  function closeHistory() {
    historyReqRef.current++;
    setLoadingHistory(false);
    setHistoryData(null);
  }

  function handleExport() {
    exportCsv(
      'daftar-nasabah-bank-sampah-lestari.csv',
      ['No. Buku', 'Nama', 'Alamat', 'No. HP', 'Akun Login', 'Saldo (Rp)'],
      rows.map((r) => [
        r.no_buku,
        r.nama,
        r.alamat || '',
        r.no_hp || '',
        r.username || 'Belum ada',
        Number(r.saldo || 0),
      ])
    );
    notify('Data nasabah diekspor ke CSV.', 'info');
  }

  return (
    <div className="page-enter">
      <Heading
        title="Data Nasabah"
        desc="Kelola anggota, akun login nasabah, saldo, dan riwayat mutasi rekening."
        action={
          <>
            <button type="button" className="secondary-btn" onClick={handleExport}>
              <Download size={16} /> Ekspor CSV
            </button>
            <button type="button" className="primary" onClick={openAdd}>
              <Plus size={17} /> Tambah Nasabah
            </button>
          </>
        }
      />

      <Card>
        <div className="table-toolbar">
          <h3>
            Daftar Nasabah <span className="count">{rows.length}</span>
          </h3>

          <div className="search">
            <Search size={16} />
            <input
              placeholder="Cari nama, no. buku, alamat, HP..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <DataTable
          headers={['No. Buku', 'Nama', 'Kontak & Alamat', 'Akun Login', 'Saldo', 'Aksi']}
          rows={rows.map((item) => [
            <span className="mono">{item.no_buku}</span>,
            <div>
              <b>{item.nama}</b>
              <small className="cell-sub">
                {item.jumlah_setoran || 0} setoran · {item.jumlah_penarikan || 0} penarikan
              </small>
            </div>,
            <div>
              <span>{item.no_hp || '-'}</span>
              <small className="cell-sub">{item.alamat || '-'}</small>
            </div>,
            item.username ? (
              <Badge variant={item.user_active === false ? 'red' : 'green'}>
                <UserCheck size={12} /> {item.username}
              </Badge>
            ) : (
              <Badge variant="muted">
                <UserX size={12} /> Belum ada
              </Badge>
            ),
            <b className="positive">{fmt(item.saldo)}</b>,
            <div className="action-row">
              <button
                type="button"
                className="icon-action"
                title="Lihat riwayat transaksi"
                onClick={() => openHistory(item)}
              >
                <History size={15} />
              </button>
              <button
                type="button"
                className="icon-action"
                title="Ubah data nasabah"
                onClick={() => openEdit(item)}
              >
                <Edit3 size={15} />
              </button>
              <button
                type="button"
                className="icon-action danger"
                title="Hapus nasabah"
                onClick={() => setDeleteTarget(item)}
              >
                <Trash2 size={15} />
              </button>
            </div>,
          ])}
        />
      </Card>

      <Modal
        open={modalOpen}
        onClose={saving ? undefined : () => setModalOpen(false)}
        title={editing ? 'Ubah Data Nasabah' : 'Tambah Nasabah Baru'}
        subtitle={
          editing
            ? `Perbarui informasi ${editing.nama} (${editing.no_buku})`
            : 'Daftarkan anggota baru Bank Sampah Lestari'
        }
        width={540}
      >
        <form className="stack-form" onSubmit={handleSave}>
          <div className="form-grid">
            <label>
              Nomor Buku *
              <input
                required
                maxLength={40}
                placeholder="Contoh: NSB-004"
                value={form.no_buku}
                onChange={(e) => setForm({ ...form, no_buku: e.target.value })}
              />
            </label>
            <label>
              Nama Lengkap *
              <input
                required
                maxLength={120}
                placeholder="Nama nasabah"
                value={form.nama}
                onChange={(e) => setForm({ ...form, nama: e.target.value })}
              />
            </label>
            <label>
              Nomor HP
              <input
                maxLength={24}
                placeholder="08xxxxxxxxxx"
                value={form.no_hp}
                onChange={(e) => setForm({ ...form, no_hp: e.target.value })}
              />
            </label>
            <label>
              Alamat
              <input
                maxLength={255}
                placeholder="Alamat domisili"
                value={form.alamat}
                onChange={(e) => setForm({ ...form, alamat: e.target.value })}
              />
            </label>
          </div>

          {(!editing || !editing.id_user) && (
            <div className="account-toggle-box">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={form.create_account}
                  onChange={(e) =>
                    setForm({ ...form, create_account: e.target.checked })
                  }
                />
                <span>
                  <b>Buatkan akun login aplikasi untuk nasabah ini</b>
                  <small>Nasabah dapat mengecek saldo dan riwayat sendiri.</small>
                </span>
              </label>

              {form.create_account && (
                <div className="form-grid" style={{ marginTop: 12 }}>
                  <label>
                    Username Login *
                    <input
                      required
                      minLength={3}
                      maxLength={32}
                      placeholder="contoh: budi.santoso"
                      value={form.username}
                      onChange={(e) =>
                        setForm({ ...form, username: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    Kata Sandi Awal *
                    <input
                      type="password"
                      required
                      minLength={8}
                      placeholder="Min. 8 karakter (huruf & angka)"
                      value={form.password}
                      onChange={(e) =>
                        setForm({ ...form, password: e.target.value })
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              Batal
            </button>
            <button className="primary" disabled={saving}>
              {saving ? 'Menyimpan...' : editing ? 'Simpan Perubahan' : 'Simpan Nasabah'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(historyData)}
        onClose={closeHistory}
        title={`Mutasi Rekening — ${historyData?.customer?.nama || ''}`}
        subtitle={
          historyData?.customer
            ? `No. Buku: ${historyData.customer.no_buku} · Saldo saat ini: ${fmt(historyData.customer.saldo)}`
            : ''
        }
        width={680}
      >
        {loadingHistory ? (
          <p className="empty">Memuat riwayat transaksi...</p>
        ) : (
          <DataTable
            pageSize={10}
            headers={['Tanggal', 'Tipe', 'Keterangan', 'Berat', 'Nominal', 'Petugas']}
            emptyText="Nasabah ini belum memiliki transaksi."
            rows={(historyData?.items || []).map((tx) => [
              fmtDate(tx.tanggal),
              <Badge variant={tx.tipe === 'Setoran' ? 'green' : 'orange'}>
                {tx.tipe}
              </Badge>,
              tx.tipe === 'Setoran' ? tx.jenis_sampah : tx.keterangan || 'Penarikan saldo',
              Number(tx.berat || 0) > 0 ? fmtKg(tx.berat) : '-',
              tx.tipe === 'Setoran' ? (
                <b className="positive">+ {fmt(tx.nilai)}</b>
              ) : (
                <b className="negative">- {fmt(tx.nilai)}</b>
              ),
              tx.petugas || '-',
            ])}
          />
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus Data Nasabah"
        message={`Yakin ingin menghapus nasabah "${deleteTarget?.nama}" (${deleteTarget?.no_buku})? Nasabah yang masih memiliki saldo atau riwayat transaksi akan ditolak otomatis oleh sistem.`}
        confirmLabel="Ya, Hapus"
        danger
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
