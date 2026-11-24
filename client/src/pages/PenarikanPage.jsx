import React, { useState } from 'react';
import { Wallet, Search, RotateCcw, AlertTriangle } from 'lucide-react';
import {
  Card,
  ConfirmDialog,
  DataTable,
  Heading,
  ReceiptModal,
} from '../components/UI.jsx';
import { dateNow, fmt, fmtDate } from '../utils/format.js';

export default function PenarikanPage({ data, api, notify, reload }) {
  const [form, setForm] = useState({
    id_nasabah: '',
    tanggal: dateNow(),
    jumlah: '',
    keterangan: '',
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState(null);

  const [search, setSearch] = useState('');
  const [voidTarget, setVoidTarget] = useState(null);
  const [voiding, setVoiding] = useState(false);

  const customers = data.customers || [];
  const history = data.history || [];

  const selected = customers.find(
    (item) => String(item.id_nasabah) === String(form.id_nasabah)
  );

  const saldoTersedia = Number(selected?.saldo || 0);
  const jumlahNum = Number(form.jumlah || 0);
  const exceedsSaldo = Boolean(selected && jumlahNum > saldoTersedia);

  function handleFormSubmit(e) {
    e.preventDefault();
    if (saving || !selected) return;

    if (!Number.isFinite(jumlahNum) || jumlahNum <= 0) {
      notify('Masukkan jumlah penarikan lebih dari Rp 0.', 'error');
      return;
    }

    if (exceedsSaldo) {
      notify('Jumlah penarikan melebihi saldo tersedia nasabah.', 'error');
      return;
    }

    setConfirmOpen(true);
  }

  async function executeWithdraw() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await api('/penarikan', {
        method: 'POST',
        body: JSON.stringify({
          id_nasabah: Number(form.id_nasabah),
          tanggal: form.tanggal,
          jumlah: jumlahNum,
          keterangan: form.keterangan.trim(),
        }),
      });

      notify('Penarikan berhasil dicatat.', 'success');
      setConfirmOpen(false);
      setForm({
        id_nasabah: '',
        tanggal: dateNow(),
        jumlah: '',
        keterangan: '',
      });
      if (res.receipt) {
        setReceipt(res.receipt);
      }
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleVoid() {
    if (!voidTarget || voiding) return;
    setVoiding(true);
    try {
      const res = await api(`/penarikan/${voidTarget.id_penarikan}`, {
        method: 'DELETE',
      });
      notify(res.message || 'Penarikan dibatalkan.', 'warning');
      setVoidTarget(null);
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setVoiding(false);
    }
  }

  const filteredHistory = history.filter((row) =>
    `${row.nama_nasabah || ''} ${row.no_buku || ''} ${row.keterangan || ''} ${row.petugas || ''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="page-enter">
      <Heading
        title="Penarikan Saldo"
        desc="Catat pencairan saldo oleh nasabah. Saldo divalidasi secara atomik di server sebelum dicairkan."
      />

      <div className="transaction-layout">
        <Card>
          <form className="stack-form" onSubmit={handleFormSubmit}>
            <h3>Formulir Penarikan</h3>

            <div className="form-grid">
              <label>
                Nama Nasabah *
                <select
                  required
                  value={form.id_nasabah}
                  onChange={(e) =>
                    setForm({ ...form, id_nasabah: e.target.value, jumlah: '' })
                  }
                >
                  <option value="">Pilih nasabah</option>
                  {customers.map((item) => (
                    <option value={item.id_nasabah} key={item.id_nasabah}>
                      {item.nama} — {item.no_buku} ({fmt(item.saldo)})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Tanggal Penarikan *
                <input
                  type="date"
                  required
                  value={form.tanggal}
                  onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
                />
              </label>
            </div>

            {selected && (
              <div className="balance-hint">
                <span>Saldo tersedia ({selected.no_buku})</span>
                <b>{fmt(saldoTersedia)}</b>
              </div>
            )}

            <label>
              Jumlah Penarikan (Rp) *
              <input
                type="number"
                min="1"
                step="any"
                max={selected ? saldoTersedia : undefined}
                value={form.jumlah}
                onChange={(e) => setForm({ ...form, jumlah: e.target.value })}
                required
                placeholder="Masukkan jumlah penarikan"
              />
            </label>

            {selected && saldoTersedia > 0 && (
              <div className="quick-chips">
                {[0.25, 0.5, 0.75, 1].map((ratio) => {
                  const preset = Math.floor(saldoTersedia * ratio);
                  if (preset <= 0) return null;
                  return (
                    <button
                      type="button"
                      key={ratio}
                      className="chip-btn"
                      onClick={() => setForm({ ...form, jumlah: String(preset) })}
                    >
                      {ratio === 1 ? 'Tarik Semua' : `${ratio * 100}%`} ({fmt(preset)})
                    </button>
                  );
                })}
              </div>
            )}

            {exceedsSaldo && (
              <div className="inline-error">
                <AlertTriangle size={15} />
                <span>
                  Nominal melebihi saldo tersedia ({fmt(saldoTersedia)}).
                </span>
              </div>
            )}

            <label>
              Keterangan
              <textarea
                maxLength={300}
                value={form.keterangan}
                onChange={(e) =>
                  setForm({ ...form, keterangan: e.target.value })
                }
                placeholder="Contoh: Pencairan tunai kebutuhan sekolah (opsional)"
              />
            </label>

            <button
              className="primary full"
              disabled={saving || exceedsSaldo || !selected}
            >
              <Wallet size={16} />
              {saving ? 'Menyimpan...' : 'Lanjutkan Penarikan'}
            </button>
          </form>
        </Card>

        <Card className="summary-card">
          <div className="stat-icon orange">
            <Wallet size={22} />
          </div>
          <h3>Ringkasan Pencairan</h3>
          <p>Nominal yang akan diserahkan ke nasabah</p>
          <strong>{fmt(jumlahNum)}</strong>

          {selected && (
            <div className="summary-projected">
              <span>Estimasi sisa saldo</span>
              <b className={exceedsSaldo ? 'negative' : 'positive'}>
                {fmt(Math.max(0, saldoTersedia - jumlahNum))}
              </b>
            </div>
          )}

          <div className="summary-note">
            Pastikan uang tunai telah dihitung sesuai nominal sebelum mengonfirmasi penarikan. Struk dapat langsung dicetak setelah transaksi tersimpan.
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 18 }}>
        <div className="table-toolbar">
          <h3>
            Riwayat Penarikan Terbaru <span className="count">{filteredHistory.length}</span>
          </h3>
          <div className="search">
            <Search size={15} />
            <input
              placeholder="Cari nasabah, keterangan, petugas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <DataTable
          pageSize={10}
          headers={['Tanggal', 'Nasabah', 'Nominal', 'Keterangan', 'Petugas', 'Aksi']}
          emptyText="Belum ada riwayat penarikan."
          rows={filteredHistory.map((row) => [
            fmtDate(row.tanggal),
            <div>
              <b>{row.nama_nasabah}</b>
              <small className="cell-sub">{row.no_buku}</small>
            </div>,
            <b className="negative">- {fmt(row.jumlah)}</b>,
            row.keterangan || '-',
            row.petugas,
            <button
              type="button"
              className="icon-action danger"
              title="Batalkan (void) penarikan ini"
              onClick={() => setVoidTarget(row)}
            >
              <RotateCcw size={14} />
            </button>,
          ])}
        />
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Konfirmasi Pencairan Saldo"
        message={`Cairkan saldo sebesar ${fmt(jumlahNum)} untuk ${selected?.nama} (${selected?.no_buku})? Sisa saldo setelah penarikan: ${fmt(Math.max(0, saldoTersedia - jumlahNum))}.`}
        confirmLabel="Ya, Cairkan Saldo"
        busy={saving}
        onConfirm={executeWithdraw}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={Boolean(voidTarget)}
        title="Batalkan Transaksi Penarikan"
        message={`Batalkan penarikan sebesar ${fmt(voidTarget?.jumlah)} untuk ${voidTarget?.nama_nasabah}? Saldo akan dikembalikan ke rekening nasabah.`}
        confirmLabel="Ya, Kembalikan Saldo"
        danger
        busy={voiding}
        onConfirm={handleVoid}
        onCancel={() => setVoidTarget(null)}
      />

      <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}
