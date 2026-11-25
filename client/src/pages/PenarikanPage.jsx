import React, { useState } from 'react';
import {
  Wallet,
  Search,
  RotateCcw,
  AlertTriangle,
  SlidersHorizontal,
  Info,
} from 'lucide-react';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  Heading,
  Modal,
  ReceiptModal,
} from '../components/UI.jsx';
import { dateNow, fmt, fmtDate } from '../utils/format.js';

export default function PenarikanPage({ data, user, api, notify, reload }) {
  const canEditSetting = user?.role === 'Ketua';
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

  // Modal pengaturan batas minimum penarikan
  const [settingOpen, setSettingOpen] = useState(false);
  const [minInput, setMinInput] = useState('');
  const [savingMin, setSavingMin] = useState(false);

  const customers = data.customers || [];
  const history = data.history || [];
  const minPenarikan =
    data.minPenarikan !== undefined ? Number(data.minPenarikan) : 50000;

  const selected = customers.find(
    (item) => String(item.id_nasabah) === String(form.id_nasabah)
  );

  const saldoTersedia = Number(selected?.saldo || 0);
  const jumlahNum = Number(form.jumlah || 0);

  const insufficientForMin = Boolean(
    selected && minPenarikan > 0 && saldoTersedia < minPenarikan
  );
  const belowMin = Boolean(
    selected &&
      !insufficientForMin &&
      minPenarikan > 0 &&
      form.jumlah !== '' &&
      jumlahNum < minPenarikan
  );
  const exceedsSaldo = Boolean(
    selected && form.jumlah !== '' && jumlahNum > saldoTersedia
  );

  function openSettingModal() {
    setMinInput(String(minPenarikan));
    setSettingOpen(true);
  }

  async function saveMinSetting(e) {
    e.preventDefault();
    if (savingMin) return;

    const val = Number(minInput);
    if (minInput === '' || !Number.isFinite(val) || val < 0) {
      notify('Masukkan nominal minimum yang valid (minimal Rp 0).', 'error');
      return;
    }

    setSavingMin(true);
    try {
      const res = await api('/settings/penarikan', {
        method: 'PUT',
        body: JSON.stringify({ min_penarikan: val }),
      });
      await reload();
      notify(res.message || 'Batas minimum penarikan diperbarui.', 'success');
      setSettingOpen(false);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSavingMin(false);
    }
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    if (saving || !selected) return;

    if (insufficientForMin) {
      notify(
        `Saldo nasabah (${fmt(saldoTersedia)}) belum mencapai batas minimum penarikan (${fmt(minPenarikan)}).`,
        'error'
      );
      return;
    }

    if (!Number.isFinite(jumlahNum) || jumlahNum <= 0) {
      notify('Masukkan jumlah penarikan lebih dari Rp 0.', 'error');
      return;
    }

    if (minPenarikan > 0 && jumlahNum < minPenarikan) {
      notify(`Nominal penarikan minimal ${fmt(minPenarikan)}.`, 'error');
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
      await reload();
      notify(res.message || 'Penarikan dibatalkan.', 'warning');
      setVoidTarget(null);
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

  // Bangun daftar tombol preset valid (>= minPenarikan dan <= saldoTersedia)
  const quickPresets = (() => {
    if (!selected || saldoTersedia <= 0 || insufficientForMin) return [];
    const list = [];
    const seen = new Set();

    const addPreset = (label, amount) => {
      const rounded = Math.floor(amount);
      if (rounded <= 0 || rounded > saldoTersedia) return;
      if (minPenarikan > 0 && rounded < minPenarikan) return;
      if (seen.has(rounded)) return;
      seen.add(rounded);
      list.push({ label, amount: rounded });
    };

    if (minPenarikan > 0) {
      addPreset('Minimum', minPenarikan);
    }
    addPreset('25%', saldoTersedia * 0.25);
    addPreset('50%', saldoTersedia * 0.5);
    addPreset('75%', saldoTersedia * 0.75);
    addPreset('Tarik Semua', saldoTersedia);
    return list;
  })();

  return (
    <div className="page-enter">
      <Heading
        title="Penarikan Saldo"
        desc="Catat pencairan saldo oleh nasabah. Saldo dan batas minimum divalidasi secara atomik di server."
        action={
          canEditSetting ? (
            <button
              type="button"
              className="secondary-btn"
              onClick={openSettingModal}
            >
              <SlidersHorizontal size={16} />
              Atur Minimum ({minPenarikan > 0 ? fmt(minPenarikan) : 'Bebas'})
            </button>
          ) : null
        }
      />

      <div className="transaction-layout">
        <Card>
          <form className="stack-form" onSubmit={handleFormSubmit}>
            <div className="card-title" style={{ marginBottom: 4 }}>
              <h3>Formulir Penarikan</h3>
              <Badge variant={minPenarikan > 0 ? 'orange' : 'muted'}>
                <Info size={12} />
                {minPenarikan > 0
                  ? `Min. penarikan ${fmt(minPenarikan)}`
                  : 'Tanpa batas minimum'}
              </Badge>
            </div>

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

            {insufficientForMin && (
              <div className="inline-error" role="alert">
                <AlertTriangle size={15} />
                <span>
                  Saldo nasabah ({fmt(saldoTersedia)}) belum mencapai batas minimum penarikan sebesar{' '}
                  <b>{fmt(minPenarikan)}</b>.
                </span>
              </div>
            )}

            <label>
              Jumlah Penarikan (Rp) *
              <input
                type="number"
                min={minPenarikan > 0 ? minPenarikan : 1}
                step="any"
                max={selected ? saldoTersedia : undefined}
                disabled={insufficientForMin}
                value={form.jumlah}
                onChange={(e) => setForm({ ...form, jumlah: e.target.value })}
                required
                placeholder={
                  minPenarikan > 0
                    ? `Minimal ${fmt(minPenarikan)}`
                    : 'Masukkan jumlah penarikan'
                }
              />
            </label>

            {quickPresets.length > 0 && (
              <div className="quick-chips">
                {quickPresets.map((item) => (
                  <button
                    type="button"
                    key={item.label}
                    className="chip-btn"
                    onClick={() =>
                      setForm({ ...form, jumlah: String(item.amount) })
                    }
                  >
                    {item.label} ({fmt(item.amount)})
                  </button>
                ))}
              </div>
            )}

            {belowMin && (
              <div className="inline-error" role="alert">
                <AlertTriangle size={15} />
                <span>
                  Nominal penarikan minimal <b>{fmt(minPenarikan)}</b>. Penarikan sebesar{' '}
                  {fmt(jumlahNum)} tidak diperbolehkan.
                </span>
              </div>
            )}

            {exceedsSaldo && (
              <div className="inline-error" role="alert">
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
              disabled={
                saving ||
                !selected ||
                insufficientForMin ||
                belowMin ||
                exceedsSaldo ||
                jumlahNum <= 0
              }
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

          <div className="summary-projected" style={{ marginBottom: 8 }}>
            <span>Minimum penarikan aktif</span>
            <b>{minPenarikan > 0 ? fmt(minPenarikan) : 'Tanpa batas'}</b>
          </div>

          {selected && (
            <div className="summary-projected">
              <span>Estimasi sisa saldo</span>
              <b className={exceedsSaldo ? 'negative' : 'positive'}>
                {fmt(Math.max(0, saldoTersedia - jumlahNum))}
              </b>
            </div>
          )}

          <div className="summary-note">
            Penarikan di bawah batas minimum otomatis ditolak oleh sistem (baik di aplikasi maupun server).
            {canEditSetting && (
              <> Ketua dapat menyesuaikan batas minimum kapan saja melalui tombol <b>Atur Minimum</b>.</>
            )}
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

      <Modal
        open={settingOpen}
        onClose={savingMin ? undefined : () => setSettingOpen(false)}
        title="Pengaturan Minimum Penarikan"
        subtitle="Atur batas nominal minimal setiap kali nasabah mencairkan saldo. Perubahan langsung berlaku di server."
        width={460}
      >
        <form className="stack-form" onSubmit={saveMinSetting}>
          <label>
            Minimum Penarikan Saldo (Rp) *
            <input
              type="number"
              min="0"
              step="1"
              required
              value={minInput}
              onChange={(e) => setMinInput(e.target.value)}
              placeholder="Contoh: 50000"
            />
          </label>

          <div className="quick-chips">
            {[
              ['Tanpa batas', 0],
              ['Rp 20.000', 20000],
              ['Rp 50.000', 50000],
              ['Rp 100.000', 100000],
            ].map(([label, val]) => (
              <button
                type="button"
                key={val}
                className="chip-btn"
                onClick={() => setMinInput(String(val))}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setSettingOpen(false)}
              disabled={savingMin}
            >
              Batal
            </button>
            <button className="primary" disabled={savingMin}>
              {savingMin ? 'Menyimpan...' : 'Simpan Pengaturan'}
            </button>
          </div>
        </form>
      </Modal>

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
