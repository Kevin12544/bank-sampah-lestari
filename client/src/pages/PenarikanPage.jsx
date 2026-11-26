import React, { useMemo, useState } from 'react';
import {
  Wallet,
  Search,
  RotateCcw,
  AlertTriangle,
  SlidersHorizontal,
  Info,
  Calendar,
  Sparkles,
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
import { MONTH_NAMES, dateNow, fmt, fmtDate } from '../utils/format.js';

export default function PenarikanPage({ data, user, api, notify, reload }) {
  const canEditSetting =
    user?.role === 'Ketua' && data.minPenarikan !== undefined;

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

  const [settingOpen, setSettingOpen] = useState(false);
  const [minInput, setMinInput] = useState('');
  const [savingMin, setSavingMin] = useState(false);

  const customers = data.customers || [];
  const history = data.history || [];
  const withdrawnMonths = data.withdrawnMonths || [];
  const minPenarikan =
    data.minPenarikan !== undefined ? Number(data.minPenarikan) : 50000;

  const selected = customers.find(
    (item) => String(item.id_nasabah) === String(form.id_nasabah)
  );

  // H2: Deteksi bulan & tahun dari tanggal penarikan
  const txYearMonth = String(form.tanggal || dateNow()).slice(0, 7);
  const [txYearStr, txMonthStr] = txYearMonth.split('-');
  const txYear = Number(txYearStr || 0);
  const txMonth = Number(txMonthStr || 0);
  const isDesember = txMonth === 12;
  const txMonthLabel = `${MONTH_NAMES[txMonth - 1] || ''} ${txYear}`;

  // H2: Cek apakah nasabah sudah melakukan penarikan pada bulan tersebut (maks. 1x/bulan)
  const alreadyWithdrawnThisMonth = useMemo(() => {
    if (!selected || !txYearMonth) return false;
    const sid = String(selected.id_nasabah);
    const fromMeta = withdrawnMonths.some(
      (w) => String(w.id_nasabah) === sid && w.ym === txYearMonth
    );
    if (fromMeta) return true;
    return history.some(
      (h) =>
        String(h.id_nasabah) === sid &&
        String(h.tanggal || '').startsWith(txYearMonth)
    );
  }, [selected, txYearMonth, withdrawnMonths, history]);

  const saldoTersedia = Number(selected?.saldo || 0);
  const jumlahNum = Number(form.jumlah || 0);

  // H2: Validasi minimum Rp50.000 + pengecualian Desember (boleh tarik seluruh saldo)
  const noBalance = Boolean(selected && saldoTersedia <= 0);
  const insufficientForMin = Boolean(
    selected && !isDesember && minPenarikan > 0 && saldoTersedia < minPenarikan
  );
  const belowMinNonDec = Boolean(
    selected &&
      !isDesember &&
      !insufficientForMin &&
      minPenarikan > 0 &&
      form.jumlah !== '' &&
      jumlahNum < minPenarikan
  );
  const decemberPartialBelowMin = Boolean(
    selected &&
      isDesember &&
      minPenarikan > 0 &&
      form.jumlah !== '' &&
      jumlahNum > 0 &&
      jumlahNum < minPenarikan &&
      Math.abs(jumlahNum - saldoTersedia) > 0.01
  );
  const exceedsSaldo = Boolean(
    selected && form.jumlah !== '' && jumlahNum > saldoTersedia + 0.001
  );

  const isBlocked =
    !selected ||
    alreadyWithdrawnThisMonth ||
    noBalance ||
    insufficientForMin ||
    belowMinNonDec ||
    decemberPartialBelowMin ||
    exceedsSaldo ||
    jumlahNum <= 0;

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
    if (saving || isBlocked) return;
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

  // Bangun daftar tombol preset valid sesuai aturan H2 (termasuk pengecualian Desember)
  const quickPresets = (() => {
    if (!selected || saldoTersedia <= 0 || alreadyWithdrawnThisMonth) return [];
    if (!isDesember && insufficientForMin) return [];

    const list = [];
    const seen = new Set();

    const addPreset = (label, amount) => {
      const val = Math.round(amount * 100) / 100;
      if (val <= 0 || val > saldoTersedia + 0.001) return;
      if (!isDesember && minPenarikan > 0 && val < minPenarikan) return;
      if (isDesember && minPenarikan > 0 && val < minPenarikan && Math.abs(val - saldoTersedia) > 0.01) {
        return;
      }
      if (seen.has(val)) return;
      seen.add(val);
      list.push({ label, amount: val });
    };

    if (isDesember && saldoTersedia < minPenarikan) {
      addPreset('Tarik Seluruh Saldo (Desember)', saldoTersedia);
      return list;
    }

    if (minPenarikan > 0) {
      addPreset('Minimum', minPenarikan);
    }
    addPreset('25%', Math.floor(saldoTersedia * 0.25));
    addPreset('50%', Math.floor(saldoTersedia * 0.5));
    addPreset('75%', Math.floor(saldoTersedia * 0.75));
    addPreset(isDesember ? 'Tarik Seluruh Saldo (Desember)' : 'Tarik Semua', saldoTersedia);
    return list;
  })();

  return (
    <div className="page-enter">
      <Heading
        title="Penarikan Saldo"
        desc="Aturan penarikan: minimal Rp 50.000, maksimal 1 kali per bulan per nasabah, dan pengecualian bulan Desember diperbolehkan tarik seluruh saldo."
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
            <div className="card-title" style={{ marginBottom: 4, flexWrap: 'wrap' }}>
              <h3>Formulir Penarikan</h3>
              <div className="action-row" style={{ flexWrap: 'wrap' }}>
                <Badge variant={minPenarikan > 0 ? 'orange' : 'muted'}>
                  <Info size={12} />
                  {minPenarikan > 0 ? `Min. ${fmt(minPenarikan)}` : 'Tanpa minimum'}
                </Badge>
                <Badge variant="blue">
                  <Calendar size={12} /> Maks. 1× / Bulan
                </Badge>
                {isDesember && (
                  <Badge variant="green">
                    <Sparkles size={12} /> Pengecualian Desember
                  </Badge>
                )}
              </div>
            </div>

            {isDesember && (
              <div className="balance-hint" style={{ background: '#e7f7ee', color: '#0e6a3c' }}>
                <span>
                  <b>Mode Bulan Desember Aktif:</b> Nasabah diperbolehkan menarik seluruh saldo meskipun saldo di bawah {fmt(minPenarikan)} (tetap maksimal 1× dalam bulan Desember).
                </span>
              </div>
            )}

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
                <span>
                  Saldo tersedia ({selected.no_buku}) · Status {txMonthLabel}:{' '}
                  <b>{alreadyWithdrawnThisMonth ? 'Sudah menarik 1×' : 'Belum menarik'}</b>
                </span>
                <b>{fmt(saldoTersedia)}</b>
              </div>
            )}

            {alreadyWithdrawnThisMonth && (
              <div className="inline-error" role="alert">
                <AlertTriangle size={15} />
                <span>
                  <b>Batas Frekuensi Tercapai:</b> {selected.nama} sudah melakukan penarikan pada bulan{' '}
                  <b>{txMonthLabel}</b>. Penarikan hanya diperbolehkan maksimal 1 kali per bulan.
                </span>
              </div>
            )}

            {!alreadyWithdrawnThisMonth && noBalance && (
              <div className="inline-error" role="alert">
                <AlertTriangle size={15} />
                <span>Saldo nasabah saat ini Rp 0 dan tidak dapat ditarik.</span>
              </div>
            )}

            {!alreadyWithdrawnThisMonth && !noBalance && insufficientForMin && (
              <div className="inline-error" role="alert">
                <AlertTriangle size={15} />
                <span>
                  Saldo nasabah ({fmt(saldoTersedia)}) belum mencapai batas minimum penarikan sebesar{' '}
                  <b>{fmt(minPenarikan)}</b>. Pengecualian tarik seluruh saldo hanya berlaku pada bulan Desember.
                </span>
              </div>
            )}

            <label>
              Jumlah Penarikan (Rp) *
              <input
                type="number"
                min={isDesember ? 1 : minPenarikan > 0 ? minPenarikan : 1}
                step="any"
                max={selected ? saldoTersedia : undefined}
                disabled={alreadyWithdrawnThisMonth || noBalance || insufficientForMin}
                value={form.jumlah}
                onChange={(e) => setForm({ ...form, jumlah: e.target.value })}
                required
                placeholder={
                  isDesember && saldoTersedia > 0 && saldoTersedia < minPenarikan
                    ? `Desember: tarik seluruh saldo (${fmt(saldoTersedia)})`
                    : minPenarikan > 0
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

            {!alreadyWithdrawnThisMonth && belowMinNonDec && (
              <div className="inline-error" role="alert">
                <AlertTriangle size={15} />
                <span>
                  Nominal penarikan minimal <b>{fmt(minPenarikan)}</b>. Penarikan sebesar{' '}
                  {fmt(jumlahNum)} tidak diperbolehkan (kecuali tarik seluruh saldo di bulan Desember).
                </span>
              </div>
            )}

            {!alreadyWithdrawnThisMonth && decemberPartialBelowMin && (
              <div className="inline-error" role="alert">
                <AlertTriangle size={15} />
                <span>
                  Khusus bulan Desember, penarikan di bawah <b>{fmt(minPenarikan)}</b> hanya diperbolehkan untuk menarik seluruh saldo (<b>{fmt(saldoTersedia)}</b>).
                </span>
              </div>
            )}

            {!alreadyWithdrawnThisMonth && exceedsSaldo && (
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

            <button className="primary full" disabled={saving || isBlocked}>
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

          <div className="summary-breakdown">
            <div>
              <span>Minimum Penarikan</span>
              <b>{minPenarikan > 0 ? fmt(minPenarikan) : 'Tanpa batas'}</b>
            </div>
            <div>
              <span>Batas Frekuensi</span>
              <b>Maks. 1× / bulan</b>
            </div>
            <div>
              <span>Status Bulan</span>
              <b>{isDesember ? 'Desember (Bebas Tarik Semua)' : txMonthLabel}</b>
            </div>
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
            Sistem memvalidasi batas minimum {fmt(minPenarikan)}, frekuensi 1×/bulan, serta pengecualian akhir tahun Desember secara atomik di server.
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
            <div>
              <span>{fmtDate(row.tanggal)}</span>
              {row.is_penarikan_desember && (
                <small className="cell-sub">
                  <Badge variant="green">Desember</Badge>
                </small>
              )}
            </div>,
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
        subtitle="Atur batas nominal minimal setiap kali nasabah mencairkan saldo (kecuali bulan Desember)."
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
        message={`Cairkan saldo sebesar ${fmt(jumlahNum)} untuk ${selected?.nama} (${selected?.no_buku}) pada ${fmtDate(form.tanggal)}? Sisa saldo setelah penarikan: ${fmt(Math.max(0, saldoTersedia - jumlahNum))}.`}
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
