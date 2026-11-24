import React, { useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  Heading,
  Modal,
} from '../components/UI.jsx';
import { fmtDate, fmtKg } from '../utils/format.js';

export default function HargaPage({ data, api, notify, reload }) {
  const [values, setValues] = useState({});
  const [savingId, setSavingId] = useState(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newForm, setNewForm] = useState({ jenis_sampah: '', harga_per_kg: '' });
  const [creating, setCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function save(id, current) {
    if (savingId !== null) return;

    const value = values[id] ?? current;
    if (value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
      notify('Masukkan harga yang valid (minimal Rp 0).', 'error');
      return;
    }

    setSavingId(id);
    try {
      await api('/harga/' + encodeURIComponent(id), {
        method: 'PUT',
        body: JSON.stringify({ harga_per_kg: Number(value) }),
      });

      notify('Harga sampah berhasil diperbarui.', 'success');
      setValues((prev) => {
        const updated = { ...prev };
        delete updated[id];
        return updated;
      });
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (creating) return;

    setCreating(true);
    try {
      await api('/harga', {
        method: 'POST',
        body: JSON.stringify({
          jenis_sampah: newForm.jenis_sampah.trim(),
          harga_per_kg: Number(newForm.harga_per_kg),
        }),
      });
      notify('Jenis sampah baru berhasil ditambahkan.', 'success');
      setNewForm({ jenis_sampah: '', harga_per_kg: '' });
      setAddOpen(false);
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api(`/harga/${deleteTarget.id_harga}`, { method: 'DELETE' });
      notify(`Jenis sampah "${deleteTarget.jenis_sampah}" dihapus.`, 'success');
      setDeleteTarget(null);
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setDeleting(false);
    }
  }

  const rows = data.rows || [];

  return (
    <div className="page-enter">
      <Heading
        title="Kelola Harga Sampah"
        desc="Tentukan harga beli per kilogram untuk setiap jenis sampah. Harga aktif digunakan otomatis saat pencatatan setoran."
        action={
          <button type="button" className="primary" onClick={() => setAddOpen(true)}>
            <Plus size={17} /> Tambah Jenis Sampah
          </button>
        }
      />

      <Card>
        <div className="table-toolbar">
          <h3>
            Daftar Kategori &amp; Harga <span className="count">{rows.length}</span>
          </h3>
          <span className="status">● Harga aktif berlaku</span>
        </div>

        <DataTable
          pageSize={25}
          headers={[
            'Jenis Sampah',
            'Stok Gudang',
            'Harga per Kilogram',
            'Terakhir Diperbarui',
            'Tindakan',
          ]}
          rows={rows.map((item) => {
            const rawVal = values[item.id_harga];
            const isDirty =
              rawVal !== undefined && Number(rawVal) !== Number(item.harga_per_kg);

            return [
              <div>
                <b>{item.jenis_sampah}</b>
                {isDirty && <small className="dirty-tag">Belum disimpan</small>}
              </div>,
              <Badge variant={Number(item.stok_kg || 0) > 0 ? 'green' : 'muted'}>
                {fmtKg(item.stok_kg || 0)}
              </Badge>,
              <div className={`price-input ${isDirty ? 'dirty' : ''}`}>
                <span>Rp</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={rawVal ?? item.harga_per_kg}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      save(item.id_harga, item.harga_per_kg);
                    }
                  }}
                  onChange={(e) =>
                    setValues((prev) => ({
                      ...prev,
                      [item.id_harga]: e.target.value,
                    }))
                  }
                />
              </div>,
              fmtDate(item.tgl_mulai),
              <div className="action-row">
                <button
                  type="button"
                  className="small-primary"
                  disabled={savingId !== null}
                  onClick={() => save(item.id_harga, item.harga_per_kg)}
                >
                  <Save size={13} />
                  {savingId === item.id_harga ? 'Menyimpan...' : 'Simpan'}
                </button>
                <button
                  type="button"
                  className="icon-action danger"
                  title="Hapus kategori sampah"
                  onClick={() => setDeleteTarget(item)}
                >
                  <Trash2 size={14} />
                </button>
              </div>,
            ];
          })}
        />
      </Card>

      <Modal
        open={addOpen}
        onClose={creating ? undefined : () => setAddOpen(false)}
        title="Tambah Jenis Sampah Baru"
        subtitle="Kategori baru akan langsung tersedia di formulir setoran dan penjualan."
        width={440}
      >
        <form className="stack-form" onSubmit={handleCreate}>
          <label>
            Nama Jenis Sampah *
            <input
              required
              maxLength={80}
              placeholder="Contoh: Botol PET Bening, Besi Tua"
              value={newForm.jenis_sampah}
              onChange={(e) =>
                setNewForm({ ...newForm, jenis_sampah: e.target.value })
              }
            />
          </label>
          <label>
            Harga Beli per Kilogram (Rp) *
            <input
              type="number"
              required
              min="0"
              step="1"
              placeholder="Contoh: 3500"
              value={newForm.harga_per_kg}
              onChange={(e) =>
                setNewForm({ ...newForm, harga_per_kg: e.target.value })
              }
            />
          </label>

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setAddOpen(false)}
              disabled={creating}
            >
              Batal
            </button>
            <button className="primary" disabled={creating}>
              {creating ? 'Menyimpan...' : 'Tambah Kategori'}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Hapus Kategori Sampah"
        message={`Hapus jenis sampah "${deleteTarget?.jenis_sampah}"? Kategori yang sudah pernah digunakan pada transaksi tidak dapat dihapus.`}
        confirmLabel="Ya, Hapus"
        danger
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
