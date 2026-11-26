import React, { useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Save,
  Lock,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  History,
} from 'lucide-react';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  Heading,
  Modal,
} from '../components/UI.jsx';
import { MONTH_NAMES, fmt, fmtDateTime, fmtKg, witaMonthYear } from '../utils/format.js';

export default function HargaPage({ data, setData, api, notify, reload }) {
  const now = witaMonthYear();
  const [month, setMonth] = useState(data.month || now.month);
  const [year, setYear] = useState(data.year || now.year);
  const [loadingPeriod, setLoadingPeriod] = useState(false);

  const [values, setValues] = useState({});
  const [savingBatch, setSavingBatch] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);

  const [addOpen, setAddOpen] = useState(false);
  const [newForm, setNewForm] = useState({ jenis_sampah: '', harga_per_kg: '' });
  const [creating, setCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (data.month) setMonth(data.month);
    if (data.year) setYear(data.year);
    setValues({});
  }, [data.month, data.year]);

  const rows = data.rows || [];
  const historyPeriods = data.historyPeriods || [];
  const isLocked = Boolean(data.isLocked);
  const hasTransactions = Boolean(data.hasTransactions);
  const isPastPeriod = Boolean(data.isPastPeriod);
  const periodLabel = `${MONTH_NAMES[(data.month || month) - 1] || ''} ${data.year || year}`;

  async function loadPeriod(targetMonth, targetYear) {
    if (loadingPeriod) return;
    setLoadingPeriod(true);
    try {
      const res = await api(`/harga-periode?month=${targetMonth}&year=${targetYear}`);
      setMonth(targetMonth);
      setYear(targetYear);
      setValues({});
      setData(res);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoadingPeriod(false);
    }
  }

  function goToNextMonth() {
    const nextM = now.month === 12 ? 1 : now.month + 1;
    const nextY = now.month === 12 ? now.year + 1 : now.year;
    loadPeriod(nextM, nextY);
  }

  async function savePeriodPrices(lock = false) {
    if (savingBatch || isLocked) return;

    const payloadItems = rows.map((item) => {
      const raw = values[item.id_harga] ?? item.harga_per_kg;
      return {
        id_harga: item.id_harga,
        harga_per_kg: Number(raw),
      };
    });

    const invalid = payloadItems.find(
      (i) => !Number.isFinite(i.harga_per_kg) || i.harga_per_kg < 0
    );
    if (invalid) {
      notify('Pastikan seluruh harga berupa angka valid (minimal Rp 0).', 'error');
      return;
    }

    setSavingBatch(true);
    try {
      const res = await api('/harga-periode', {
        method: 'PUT',
        body: JSON.stringify({
          month: data.month || month,
          year: data.year || year,
          items: payloadItems,
          lock,
        }),
      });
      setLockConfirmOpen(false);
      notify(res.message || 'Harga periode berhasil disimpan.', 'success');
      await loadPeriod(data.month || month, data.year || year);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSavingBatch(false);
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
      if (data.legacyMode) {
        await reload();
      } else {
        await loadPeriod(data.month || month, data.year || year);
      }
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
      if (data.legacyMode) {
        await reload();
      } else {
        await loadPeriod(data.month || month, data.year || year);
      }
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setDeleting(false);
    }
  }

  const hasDirty = rows.some(
    (item) =>
      values[item.id_harga] !== undefined &&
      Number(values[item.id_harga]) !== Number(item.harga_per_kg)
  );

  return (
    <div className="page-enter">
      <Heading
        title="Kelola Harga Sampah (Harga Periode)"
        desc="Harga per kilogram ditetapkan setiap awal bulan melalui entitas HargaPeriode. Setelah ditetapkan atau dipakai transaksi, harga bulan tersebut terkunci sehingga nilai setoran lama tidak berubah."
        action={
          <>
            <button
              type="button"
              className="secondary-btn"
              onClick={goToNextMonth}
              disabled={loadingPeriod}
            >
              <Calendar size={15} /> Siapkan Awal Bulan Depan
            </button>
            <button type="button" className="primary" onClick={() => setAddOpen(true)}>
              <Plus size={17} /> Tambah Jenis Sampah
            </button>
          </>
        }
      />

      <Card>
        <div className="filters" style={{ marginBottom: 14 }}>
          <label>
            Periode Bulan
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx + 1}>
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
            type="button"
            className="secondary-btn"
            onClick={() => loadPeriod(month, year)}
            disabled={loadingPeriod}
          >
            {loadingPeriod ? 'Memuat...' : 'Tampilkan Periode'}
          </button>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {isLocked ? (
              <Badge variant="orange">
                <Lock size={12} /> Periode Terkunci ({periodLabel})
              </Badge>
            ) : (
              <Badge variant="green">
                <CheckCircle2 size={12} /> Draft Awal Bulan ({periodLabel})
              </Badge>
            )}
          </div>
        </div>

        {isLocked ? (
          <div className="security-banner" style={{ marginBottom: 16 }}>
            <AlertTriangle size={18} />
            <div>
              <b>Harga periode {periodLabel} terkunci dan tidak dapat diubah.</b>
              <span>
                {isPastPeriod
                  ? 'Periode bulan yang telah berlalu dikunci permanen agar nilai setoran lama tetap akurat.'
                  : hasTransactions
                  ? `Sudah tercatat ${data.txCount || 1} transaksi setoran pada bulan ini. Untuk mengubah tarif, pilih periode awal bulan berikutnya.`
                  : 'Harga periode ini sudah resmi ditetapkan & dikunci. Gunakan tombol "Siapkan Awal Bulan Depan" untuk mengatur tarif bulan berikutnya.'}
              </span>
            </div>
            <button
              type="button"
              className="small-primary"
              onClick={goToNextMonth}
            >
              Atur Bulan Depan
            </button>
          </div>
        ) : (
          <div className="balance-hint" style={{ marginBottom: 16 }}>
            <span>
              Anda sedang menyusun tarif awal bulan <b>{periodLabel}</b>. Setelah sesuai, klik{' '}
              <b>Tetapkan &amp; Kunci Periode</b> agar tarif resmi berlaku.
            </span>
            <div className="action-row">
              <button
                type="button"
                className="secondary-btn"
                disabled={savingBatch || !hasDirty}
                onClick={() => savePeriodPrices(false)}
              >
                <Save size={14} /> Simpan Draft
              </button>
              <button
                type="button"
                className="small-primary"
                disabled={savingBatch}
                onClick={() => setLockConfirmOpen(true)}
              >
                <Lock size={14} /> Tetapkan &amp; Kunci Periode
              </button>
            </div>
          </div>
        )}

        <DataTable
          pageSize={25}
          headers={[
            'Jenis Sampah',
            'Stok Gudang',
            `Harga Periode ${periodLabel} (/kg)`,
            'Status Periode',
            'Aksi',
          ]}
          rows={rows.map((item) => {
            const rawVal = values[item.id_harga];
            const isDirty =
              rawVal !== undefined && Number(rawVal) !== Number(item.harga_per_kg);

            return [
              <div>
                <b>{item.jenis_sampah}</b>
                {isDirty && !isLocked && (
                  <small className="dirty-tag">Belum disimpan</small>
                )}
              </div>,
              <Badge variant={Number(item.stok_kg || 0) > 0 ? 'green' : 'muted'}>
                {fmtKg(item.stok_kg || 0)}
              </Badge>,
              isLocked ? (
                <b>{fmt(item.harga_per_kg)}</b>
              ) : (
                <div className={`price-input ${isDirty ? 'dirty' : ''}`}>
                  <span>Rp</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={rawVal ?? item.harga_per_kg}
                    onChange={(e) =>
                      setValues((prev) => ({
                        ...prev,
                        [item.id_harga]: e.target.value,
                      }))
                    }
                  />
                </div>
              ),
              item.status === 'terkunci' || isLocked ? (
                <Badge variant="orange">
                  <Lock size={11} /> Terkunci
                </Badge>
              ) : (
                <Badge variant="green">Draft</Badge>
              ),
              <button
                type="button"
                className="icon-action danger"
                title="Hapus kategori sampah (hanya jika belum dipakai transaksi)"
                onClick={() => setDeleteTarget(item)}
              >
                <Trash2 size={14} />
              </button>,
            ];
          })}
        />
      </Card>

      {historyPeriods.length > 0 && (
        <Card>
          <div className="table-toolbar">
            <h3>
              <History size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Riwayat Penetapan Harga Periode <span className="count">{historyPeriods.length}</span>
            </h3>
          </div>

          <DataTable
            pageSize={10}
            headers={['Periode', 'Status', 'Jumlah Jenis', 'Ditetapkan Oleh', 'Waktu', 'Lihat']}
            rows={historyPeriods.map((hp) => [
              <b>
                {MONTH_NAMES[hp.bulan - 1]} {hp.tahun}
              </b>,
              hp.status === 'terkunci' ? (
                <Badge variant="orange">
                  <Lock size={11} /> Terkunci
                </Badge>
              ) : (
                <Badge variant="green">Draft</Badge>
              ),
              `${hp.jumlah_jenis} jenis`,
              hp.ditetapkan_oleh || 'Sistem',
              fmtDateTime(hp.ditetapkan_pada),
              <button
                type="button"
                className="secondary-btn"
                style={{ padding: '6px 10px', fontSize: 11 }}
                onClick={() => loadPeriod(hp.bulan, hp.tahun)}
              >
                Buka
              </button>,
            ])}
          />
        </Card>
      )}

      <Modal
        open={addOpen}
        onClose={creating ? undefined : () => setAddOpen(false)}
        title="Tambah Jenis Sampah Baru"
        subtitle="Kategori baru langsung ditambahkan ke master dan periode bulan berjalan."
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
            Harga Awal per Kilogram (Rp) *
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
        open={lockConfirmOpen}
        title={`Tetapkan & Kunci Harga ${periodLabel}`}
        message={`Harga periode ${periodLabel} akan resmi diberlakukan dan dikunci agar nilai setoran selama bulan tersebut konsisten. Setelah dikunci, perubahan harga hanya bisa dilakukan pada periode bulan berikutnya. Lanjutkan?`}
        confirmLabel="Ya, Tetapkan & Kunci"
        busy={savingBatch}
        onConfirm={() => savePeriodPrices(true)}
        onCancel={() => setLockConfirmOpen(false)}
      />

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
