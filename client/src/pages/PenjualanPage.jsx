import React, { useEffect, useState } from 'react';
import {
  ShoppingCart,
  Building2,
  Plus,
  Edit3,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Package,
} from 'lucide-react';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  Heading,
  Modal,
} from '../components/UI.jsx';
import { dateNow, fmt, fmtDate, fmtKg } from '../utils/format.js';

export default function PenjualanPage({ data, api, notify, reload }) {
  const prices = data.prices || [];
  const collectors = data.collectors || [];
  const rows = data.rows || [];

  const [form, setForm] = useState({
    id_pengepul: '',
    jenis_sampah: '',
    tanggal: dateNow(),
    berat_jual: '',
    harga_jual: '',
    pembeli: '',
  });
  const [saving, setSaving] = useState(false);

  // Pengepul management modal
  const [pengepulModal, setPengepulModal] = useState(false);
  const [editingPengepul, setEditingPengepul] = useState(null);
  const [pForm, setPForm] = useState({ nama: '', kontak: '', alamat: '' });
  const [savingPengepul, setSavingPengepul] = useState(false);
  const [deletePengepul, setDeletePengepul] = useState(null);

  // Void sale
  const [voidTarget, setVoidTarget] = useState(null);
  const [voiding, setVoiding] = useState(false);

  useEffect(() => {
    if (!form.jenis_sampah && prices.length > 0) {
      const withStock = prices.find((p) => Number(p.stok_kg || 0) > 0) || prices[0];
      setForm((prev) => ({ ...prev, jenis_sampah: withStock.jenis_sampah }));
    }
  }, [prices, form.jenis_sampah]);

  const currentType = prices.find((p) => p.jenis_sampah === form.jenis_sampah);
  const stokTersedia = Number(currentType?.stok_kg || 0);
  const beratNum = Number(form.berat_jual || 0);
  const hargaNum = Number(form.harga_jual || 0);
  const overStock = beratNum > stokTersedia + 0.0005;
  const totalEst = Math.round(beratNum * hargaNum * 100) / 100;

  async function save(e) {
    e.preventDefault();
    if (saving) return;

    if (!form.id_pengepul && !form.pembeli.trim()) {
      notify('Pilih pengepul terdaftar atau isi nama pembeli.', 'error');
      return;
    }

    if (overStock) {
      notify(
        `Stok ${form.jenis_sampah} hanya tersedia ${fmtKg(stokTersedia)}.`,
        'error'
      );
      return;
    }

    setSaving(true);
    try {
      await api('/penjualan', {
        method: 'POST',
        body: JSON.stringify({
          id_pengepul: form.id_pengepul ? Number(form.id_pengepul) : null,
          jenis_sampah: form.jenis_sampah,
          tanggal: form.tanggal,
          berat_jual: beratNum,
          harga_jual: hargaNum,
          pembeli: form.pembeli.trim(),
        }),
      });

      notify('Penjualan berhasil dicatat dan stok diperbarui.', 'success');
      setForm((prev) => ({
        ...prev,
        berat_jual: '',
        harga_jual: '',
      }));
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePengepul(e) {
    e.preventDefault();
    if (savingPengepul) return;
    setSavingPengepul(true);
    try {
      const payload = {
        nama: pForm.nama.trim(),
        kontak: pForm.kontak.trim(),
        alamat: pForm.alamat.trim(),
      };
      const res = editingPengepul
        ? await api(`/pengepul/${editingPengepul.id_pengepul}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        : await api('/pengepul', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      notify(res.message || 'Data pengepul tersimpan.', 'success');
      setEditingPengepul(null);
      setPForm({ nama: '', kontak: '', alamat: '' });
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSavingPengepul(false);
    }
  }

  async function handleDeletePengepul() {
    if (!deletePengepul) return;
    try {
      await api(`/pengepul/${deletePengepul.id_pengepul}`, { method: 'DELETE' });
      notify('Pengepul dihapus.', 'success');
      setDeletePengepul(null);
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function handleVoid() {
    if (!voidTarget || voiding) return;
    setVoiding(true);
    try {
      const res = await api(`/penjualan/${voidTarget.id_penjualan}`, {
        method: 'DELETE',
      });
      notify(res.message || 'Penjualan dibatalkan.', 'warning');
      setVoidTarget(null);
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setVoiding(false);
    }
  }

  return (
    <div className="page-enter">
      <Heading
        title="Penjualan ke Pengepul"
        desc="Catat penjualan sampah berdasarkan stok gudang tersedia dan kelola mitra pengepul."
        action={
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setEditingPengepul(null);
              setPForm({ nama: '', kontak: '', alamat: '' });
              setPengepulModal(true);
            }}
          >
            <Building2 size={16} /> Kelola Pengepul ({collectors.length})
          </button>
        }
      />

      <Card>
        <div className="card-title" style={{ marginBottom: 12 }}>
          <div>
            <h3>Stok Sampah Siap Jual</h3>
            <p>Klik jenis sampah untuk langsung memilih di formulir penjualan</p>
          </div>
        </div>
        <div className="stock-strip">
          {prices.map((item) => {
            const hasStock = Number(item.stok_kg || 0) > 0;
            const active = form.jenis_sampah === item.jenis_sampah;
            return (
              <button
                type="button"
                key={item.id_harga}
                className={`stock-pill ${active ? 'active' : ''} ${hasStock ? '' : 'empty-stock'}`}
                onClick={() =>
                  setForm((prev) => ({ ...prev, jenis_sampah: item.jenis_sampah }))
                }
              >
                <Package size={14} />
                <span>{item.jenis_sampah}</span>
                <b>{fmtKg(item.stok_kg || 0)}</b>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="two-col">
        <Card>
          <form className="stack-form" onSubmit={save}>
            <h3>Transaksi Penjualan</h3>

            <div className="form-grid">
              <label>
                Pengepul Terdaftar
                <select
                  value={form.id_pengepul}
                  onChange={(e) =>
                    setForm({ ...form, id_pengepul: e.target.value })
                  }
                >
                  <option value="">-- Pilih pengepul (atau isi pembeli) --</option>
                  {collectors.map((item) => (
                    <option value={item.id_pengepul} key={item.id_pengepul}>
                      {item.nama}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Tanggal Penjualan *
                <input
                  type="date"
                  required
                  value={form.tanggal}
                  onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
                />
              </label>
            </div>

            <label>
              Jenis Sampah *
              <select
                value={form.jenis_sampah}
                onChange={(e) =>
                  setForm({ ...form, jenis_sampah: e.target.value })
                }
                required
              >
                {prices.map((item) => (
                  <option key={item.id_harga} value={item.jenis_sampah}>
                    {item.jenis_sampah} — Stok: {fmtKg(item.stok_kg || 0)}
                  </option>
                ))}
              </select>
            </label>

            <div className="balance-hint">
              <span>Stok {form.jenis_sampah || '-'} tersedia</span>
              <b>{fmtKg(stokTersedia)}</b>
            </div>

            <div className="form-grid">
              <label>
                Berat yang Dijual (kg) *
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={stokTersedia > 0 ? stokTersedia : undefined}
                  required
                  value={form.berat_jual}
                  onChange={(e) =>
                    setForm({ ...form, berat_jual: e.target.value })
                  }
                  placeholder="0.0"
                />
              </label>

              <label>
                Harga Jual per kg (Rp) *
                <input
                  type="number"
                  min="1"
                  step="100"
                  required
                  value={form.harga_jual}
                  onChange={(e) =>
                    setForm({ ...form, harga_jual: e.target.value })
                  }
                  placeholder={
                    currentType
                      ? `Harga beli: ${fmt(currentType.harga_per_kg)}`
                      : 'Rp'
                  }
                />
              </label>
            </div>

            {stokTersedia > 0 && (
              <div className="quick-chips">
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() =>
                    setForm({ ...form, berat_jual: String(stokTersedia) })
                  }
                >
                  Jual Semua Stok ({fmtKg(stokTersedia)})
                </button>
              </div>
            )}

            {overStock && (
              <div className="inline-error">
                <AlertTriangle size={15} />
                <span>
                  Berat jual melebihi stok gudang ({fmtKg(stokTersedia)}).
                </span>
              </div>
            )}

            <label>
              Nama Pembeli {form.id_pengepul ? '(opsional)' : '*'}
              <input
                maxLength={120}
                required={!form.id_pengepul}
                value={form.pembeli}
                onChange={(e) => setForm({ ...form, pembeli: e.target.value })}
                placeholder="Isi jika pembeli tidak ada di daftar pengepul"
              />
            </label>

            <button
              className="primary full"
              disabled={saving || overStock || stokTersedia <= 0}
            >
              <ShoppingCart size={16} />
              {saving ? 'Menyimpan...' : 'Simpan Penjualan'}
            </button>
          </form>
        </Card>

        <Card className="summary-card">
          <div className="stat-icon orange">
            <ShoppingCart size={22} />
          </div>

          <h3>Perkiraan Total Penjualan</h3>
          <strong>{fmt(totalEst)}</strong>
          <p>
            {fmtKg(beratNum)} × {fmt(hargaNum)}/kg
          </p>

          {currentType && hargaNum > 0 && beratNum > 0 && (
            <div className="summary-projected">
              <span>Estimasi margin vs harga beli</span>
              <b
                className={
                  hargaNum >= Number(currentType.harga_per_kg)
                    ? 'positive'
                    : 'negative'
                }
              >
                {fmt((hargaNum - Number(currentType.harga_per_kg)) * beratNum)}
              </b>
            </div>
          )}

          <div className="summary-note">
            Sistem memvalidasi ketersediaan stok di server menggunakan kunci transaksi sehingga stok tidak mungkin minus.
          </div>
        </Card>
      </div>

      <Card>
        <div className="table-toolbar">
          <h3>
            Riwayat Penjualan <span className="count">{rows.length}</span>
          </h3>
        </div>

        <DataTable
          pageSize={10}
          headers={[
            'Tanggal',
            'Jenis Sampah',
            'Berat',
            'Harga/kg',
            'Total',
            'Pengepul / Pembeli',
            'Aksi',
          ]}
          emptyText="Belum ada riwayat penjualan."
          rows={rows.map((item) => [
            fmtDate(item.tanggal),
            <Badge variant="blue">{item.jenis_sampah}</Badge>,
            fmtKg(item.berat_jual),
            fmt(item.harga_jual),
            <b className="positive">{fmt(item.total)}</b>,
            item.nama_pengepul || item.pembeli || '-',
            <button
              type="button"
              className="icon-action danger"
              title="Batalkan (void) penjualan"
              onClick={() => setVoidTarget(item)}
            >
              <RotateCcw size={14} />
            </button>,
          ])}
        />
      </Card>

      <Modal
        open={pengepulModal}
        onClose={() => setPengepulModal(false)}
        title="Kelola Data Pengepul"
        subtitle="Tambahkan atau perbarui daftar mitra pembeli sampah."
        width={620}
      >
        <form className="stack-form" onSubmit={handleSavePengepul}>
          <div className="form-grid">
            <label>
              Nama Pengepul / Usaha *
              <input
                required
                maxLength={120}
                placeholder="Contoh: CV Daur Ulang Makmur"
                value={pForm.nama}
                onChange={(e) => setPForm({ ...pForm, nama: e.target.value })}
              />
            </label>
            <label>
              Kontak / No. HP
              <input
                maxLength={40}
                placeholder="08xxxxxxxxxx"
                value={pForm.kontak}
                onChange={(e) => setPForm({ ...pForm, kontak: e.target.value })}
              />
            </label>
          </div>
          <label>
            Alamat
            <input
              maxLength={255}
              placeholder="Alamat pengepul"
              value={pForm.alamat}
              onChange={(e) => setPForm({ ...pForm, alamat: e.target.value })}
            />
          </label>
          <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
            <button className="primary" disabled={savingPengepul}>
              <Plus size={15} />
              {savingPengepul
                ? 'Menyimpan...'
                : editingPengepul
                ? 'Simpan Perubahan'
                : 'Tambah Pengepul'}
            </button>
            {editingPengepul && (
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setEditingPengepul(null);
                  setPForm({ nama: '', kontak: '', alamat: '' });
                }}
              >
                Batal Ubah
              </button>
            )}
          </div>
        </form>

        <div style={{ marginTop: 18 }}>
          <DataTable
            pageSize={6}
            headers={['Nama', 'Kontak', 'Alamat', 'Aksi']}
            emptyText="Belum ada pengepul terdaftar."
            rows={collectors.map((c) => [
              <b>{c.nama}</b>,
              c.kontak || '-',
              c.alamat || '-',
              <div className="action-row">
                <button
                  type="button"
                  className="icon-action"
                  onClick={() => {
                    setEditingPengepul(c);
                    setPForm({
                      nama: c.nama || '',
                      kontak: c.kontak || '',
                      alamat: c.alamat || '',
                    });
                  }}
                >
                  <Edit3 size={14} />
                </button>
                <button
                  type="button"
                  className="icon-action danger"
                  onClick={() => setDeletePengepul(c)}
                >
                  <Trash2 size={14} />
                </button>
              </div>,
            ])}
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deletePengepul)}
        title="Hapus Pengepul"
        message={`Hapus pengepul "${deletePengepul?.nama}" dari daftar?`}
        confirmLabel="Ya, Hapus"
        danger
        onConfirm={handleDeletePengepul}
        onCancel={() => setDeletePengepul(null)}
      />

      <ConfirmDialog
        open={Boolean(voidTarget)}
        title="Batalkan Transaksi Penjualan"
        message={`Batalkan penjualan ${fmtKg(voidTarget?.berat_jual)} ${voidTarget?.jenis_sampah} senilai ${fmt(voidTarget?.total)}? Stok sampah akan dikembalikan ke gudang.`}
        confirmLabel="Ya, Batalkan Penjualan"
        danger
        busy={voiding}
        onConfirm={handleVoid}
        onCancel={() => setVoidTarget(null)}
      />
    </div>
  );
}
