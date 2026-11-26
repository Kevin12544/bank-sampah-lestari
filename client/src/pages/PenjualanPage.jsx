import React, { useEffect, useMemo, useState } from 'react';
import {
  ShoppingCart,
  Building2,
  Plus,
  Edit3,
  Trash2,
  RotateCcw,
  AlertTriangle,
  Package,
  CalendarClock,
  CheckCircle2,
  Scale,
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

function createEmptyItem(jenis = '') {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    jenis_sampah: jenis,
    berat_gudang: '',
    berat_jual: '',
    harga_jual: '',
    manualBeratJual: false,
  };
}

function calcScheduleClient(lastSaleDate, refDate, intervalDays = 14) {
  if (!lastSaleDate || !refDate) {
    return {
      intervalDays,
      lastSaleDate: null,
      nextScheduleDate: refDate,
      daysSinceLast: null,
      daysRemaining: 0,
      isDue: true,
    };
  }
  const parse = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const dayMs = 86_400_000;
  const lastMs = parse(lastSaleDate);
  const refMs = parse(refDate);
  const daysSinceLast = Math.floor((refMs - lastMs) / dayMs);
  const nextScheduleDate = new Date(lastMs + intervalDays * dayMs)
    .toISOString()
    .slice(0, 10);
  return {
    intervalDays,
    lastSaleDate,
    nextScheduleDate,
    daysSinceLast,
    daysRemaining: Math.max(0, intervalDays - daysSinceLast),
    isDue: daysSinceLast >= intervalDays,
  };
}

export default function PenjualanPage({ data, api, notify, reload }) {
  const prices = data.prices || [];
  const collectors = data.collectors || [];
  const rows = data.rows || [];

  const [header, setHeader] = useState({
    id_pengepul: '',
    tanggal: dateNow(),
    pembeli: '',
    catatan: '',
    diluar_jadwal: false,
  });

  const [lineItems, setLineItems] = useState([]);
  const [saving, setSaving] = useState(false);

  // Kelola Pengepul modal
  const [pengepulModal, setPengepulModal] = useState(false);
  const [editingPengepul, setEditingPengepul] = useState(null);
  const [pForm, setPForm] = useState({ nama: '', kontak: '', alamat: '' });
  const [savingPengepul, setSavingPengepul] = useState(false);
  const [deletePengepul, setDeletePengepul] = useState(null);
  const [deletingPengepul, setDeletingPengepul] = useState(false);

  // Void sale
  const [voidTarget, setVoidTarget] = useState(null);
  const [voiding, setVoiding] = useState(false);

  // Inisialisasi baris item pertama saat daftar harga/stok tiba
  useEffect(() => {
    if (lineItems.length === 0 && prices.length > 0) {
      const firstStock =
        prices.find((p) => Number(p.stok_kg || 0) > 0) || prices[0];
      setLineItems([createEmptyItem(firstStock.jenis_sampah)]);
    }
  }, [prices, lineItems.length]);

  const priceByJenis = useMemo(
    () => Object.fromEntries(prices.map((p) => [p.jenis_sampah, p])),
    [prices]
  );

  // H4: Hitung status jadwal 2 mingguan berdasarkan penjualan terakhir & tanggal form
  const lastSaleDate =
    data.schedule?.lastSaleDate || (rows.length > 0 ? rows[0].tanggal : null);
  const schedule = useMemo(
    () => calcScheduleClient(lastSaleDate, header.tanggal, 14),
    [lastSaleDate, header.tanggal]
  );
  const needsScheduleOverride = Boolean(schedule.lastSaleDate && !schedule.isDue);

  // Hitung metrik per baris + validasi
  const computedItems = lineItems.map((item) => {
    const info = priceByJenis[item.jenis_sampah];
    const stok = Number(info?.stok_kg || 0);
    const bg = Number(item.berat_gudang || 0);
    const bj = Number(item.berat_jual || 0);
    const hj = Number(item.harga_jual || 0);
    const susut = bg > 0 && bj > 0 && bg >= bj ? Math.round((bg - bj) * 1000) / 1000 : 0;
    const susutPct = bg > 0 ? Math.round((susut / bg) * 1000) / 10 : 0;
    const subtotal = Math.round(bj * hj * 100) / 100;

    const overStock = bg > stok + 0.0005;
    const sellExceedsWarehouse = bj > bg + 0.0005;

    return {
      ...item,
      stok,
      hargaBeli: Number(info?.harga_per_kg || 0),
      bg,
      bj,
      hj,
      susut,
      susutPct,
      subtotal,
      overStock,
      sellExceedsWarehouse,
    };
  });

  const duplicateJenis = (() => {
    const seen = new Set();
    for (const item of computedItems) {
      if (!item.jenis_sampah) continue;
      if (seen.has(item.jenis_sampah)) return item.jenis_sampah;
      seen.add(item.jenis_sampah);
    }
    return '';
  })();

  const totalGudang =
    Math.round(computedItems.reduce((s, i) => s + i.bg, 0) * 1000) / 1000;
  const totalJual =
    Math.round(computedItems.reduce((s, i) => s + i.bj, 0) * 1000) / 1000;
  const totalSusut =
    Math.round(computedItems.reduce((s, i) => s + i.susut, 0) * 1000) / 1000;
  const totalSusutPct =
    totalGudang > 0 ? Math.round((totalSusut / totalGudang) * 1000) / 10 : 0;
  const grandTotal =
    Math.round(computedItems.reduce((s, i) => s + i.subtotal, 0) * 100) / 100;

  const hasItemErrors =
    Boolean(duplicateJenis) ||
    computedItems.some((i) => i.overStock || i.sellExceedsWarehouse);

  const scheduleBlocked =
    needsScheduleOverride && (!header.diluar_jadwal || !header.catatan.trim());

  function updateItem(key, patch) {
    setLineItems((prev) =>
      prev.map((row) => {
        if (row.key !== key) return row;
        const next = { ...row, ...patch };
        // Jika user mengisi berat_gudang dan belum mengedit berat_jual manual, samakan dulu
        if (
          patch.berat_gudang !== undefined &&
          !row.manualBeratJual &&
          patch.berat_jual === undefined
        ) {
          next.berat_jual = patch.berat_gudang;
        }
        return next;
      })
    );
  }

  function addItemRow(preferredJenis = '') {
    const used = new Set(lineItems.map((i) => i.jenis_sampah));
    const nextType =
      preferredJenis ||
      prices.find((p) => !used.has(p.jenis_sampah) && Number(p.stok_kg || 0) > 0)
        ?.jenis_sampah ||
      prices.find((p) => !used.has(p.jenis_sampah))?.jenis_sampah ||
      prices[0]?.jenis_sampah ||
      '';

    if (preferredJenis && used.has(preferredJenis)) {
      notify(`"${preferredJenis}" sudah ada di daftar penjualan.`, 'info');
      return;
    }
    setLineItems((prev) => [...prev, createEmptyItem(nextType)]);
  }

  function removeItemRow(key) {
    setLineItems((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  async function save(e) {
    e.preventDefault();
    if (saving) return;

    if (!header.id_pengepul && !header.pembeli.trim()) {
      notify('Pilih pengepul terdaftar atau isi nama pembeli.', 'error');
      return;
    }

    if (duplicateJenis) {
      notify(`Jenis sampah "${duplicateJenis}" duplikat di daftar item.`, 'error');
      return;
    }

    if (hasItemErrors) {
      notify('Periksa kembali berat gudang dan berat timbangan pengepul pada tiap item.', 'error');
      return;
    }

    if (scheduleBlocked) {
      notify(
        'Belum masuk siklus 2 mingguan. Centang opsi di luar jadwal dan isi alasan.',
        'error'
      );
      return;
    }

    const validPayload = computedItems.filter((i) => i.bg > 0 && i.bj > 0 && i.hj > 0);
    if (!validPayload.length) {
      notify('Lengkapi minimal satu baris item penjualan.', 'error');
      return;
    }

    setSaving(true);
    try {
      const firstItem = validPayload[0];
      const res = await api('/penjualan', {
        method: 'POST',
        body: JSON.stringify({
          id_pengepul: header.id_pengepul ? Number(header.id_pengepul) : null,
          tanggal: header.tanggal,
          pembeli: header.pembeli.trim(),
          catatan: header.catatan.trim(),
          diluar_jadwal: Boolean(header.diluar_jadwal),
          ...(validPayload.length === 1
            ? {
                jenis_sampah: firstItem.jenis_sampah,
                berat_gudang: firstItem.bg,
                berat_jual: firstItem.bj,
                harga_jual: firstItem.hj,
              }
            : {}),
          items: validPayload.map((i) => ({
            jenis_sampah: i.jenis_sampah,
            berat_gudang: i.bg,
            berat_jual: i.bj,
            harga_jual: i.hj,
          })),
        }),
      });

      notify(
        `Penjualan berhasil dicatat (${validPayload.length} jenis · Susut: ${fmtKg(res.total_susut ?? totalSusut)}).`,
        'success'
      );
      setHeader((prev) => ({
        ...prev,
        catatan: '',
        diluar_jadwal: false,
      }));
      setLineItems([
        createEmptyItem(
          prices.find((p) => Number(p.stok_kg || 0) > 0)?.jenis_sampah ||
            prices[0]?.jenis_sampah ||
            ''
        ),
      ]);
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
    if (!deletePengepul || deletingPengepul) return;
    setDeletingPengepul(true);
    try {
      await api(`/pengepul/${deletePengepul.id_pengepul}`, { method: 'DELETE' });
      await reload();
      notify('Pengepul dihapus.', 'success');
      setDeletePengepul(null);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setDeletingPengepul(false);
    }
  }

  async function handleVoid() {
    if (!voidTarget || voiding) return;
    setVoiding(true);
    try {
      const res = await api(`/penjualan/${voidTarget.id_penjualan}`, {
        method: 'DELETE',
      });
      await reload();
      notify(res.message || 'Penjualan dibatalkan.', 'warning');
      setVoidTarget(null);
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
        desc="Catat penjualan multi-jenis sampah (M:N), lacak pengurangan stok gudang, catat selisih berat susut, dan pantau siklus 2 mingguan."
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

      {/* H4: Status Siklus 2 Mingguan */}
      <Card>
        <div className="card-title" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className={`stat-icon ${schedule.isDue ? 'green' : 'orange'}`} style={{ marginBottom: 0 }}>
              <CalendarClock size={20} />
            </div>
            <div>
              <h3>Siklus Penjualan Pengepul (Setiap 2 Minggu / 14 Hari)</h3>
              <p>
                {schedule.lastSaleDate
                  ? `Penjualan terakhir: ${fmtDate(schedule.lastSaleDate)} (${schedule.daysSinceLast} hari lalu) · Jadwal berikutnya: ${fmtDate(schedule.nextScheduleDate)}`
                  : 'Belum ada riwayat penjualan sebelumnya. Siap melaksanakan penjualan perdana.'}
              </p>
            </div>
          </div>

          {schedule.isDue ? (
            <Badge variant="green">
              <CheckCircle2 size={12} /> Jadwal 2 Mingguan Siap / Jatuh Tempo
            </Badge>
          ) : (
            <Badge variant="orange">
              <CalendarClock size={12} /> {schedule.daysRemaining} hari menuju jadwal berikutnya
            </Badge>
          )}
        </div>

        <div className="stock-strip">
          {prices.map((item) => {
            const hasStock = Number(item.stok_kg || 0) > 0;
            const selectedInList = lineItems.some(
              (li) => li.jenis_sampah === item.jenis_sampah
            );
            return (
              <button
                type="button"
                key={item.id_harga}
                className={`stock-pill ${selectedInList ? 'active' : ''} ${hasStock ? '' : 'empty-stock'}`}
                onClick={() => addItemRow(item.jenis_sampah)}
                title="Klik untuk menambah jenis sampah ini ke transaksi penjualan"
              >
                <Package size={14} />
                <span>{item.jenis_sampah}</span>
                <b>{fmtKg(item.stok_kg || 0)}</b>
              </button>
            );
          })}
        </div>
      </Card>

      <div className="transaction-layout">
        <Card>
          <form className="stack-form" onSubmit={save}>
            <div className="card-title" style={{ marginBottom: 2 }}>
              <h3>Transaksi Penjualan Multi-Jenis (M:N)</h3>
              <button
                type="button"
                className="secondary-btn"
                style={{ padding: '7px 11px', fontSize: 11 }}
                onClick={() => addItemRow('')}
              >
                <Plus size={14} /> Tambah Jenis Sampah
              </button>
            </div>

            <div className="form-grid">
              <label>
                Pengepul Terdaftar
                <select
                  value={header.id_pengepul}
                  onChange={(e) =>
                    setHeader({ ...header, id_pengepul: e.target.value })
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
                  value={header.tanggal}
                  onChange={(e) =>
                    setHeader({ ...header, tanggal: e.target.value })
                  }
                />
              </label>
            </div>

            <label>
              Nama Pembeli {header.id_pengepul ? '(opsional)' : '*'}
              <input
                maxLength={120}
                required={!header.id_pengepul}
                value={header.pembeli}
                onChange={(e) =>
                  setHeader({ ...header, pembeli: e.target.value })
                }
                placeholder="Isi jika pembeli tidak ada di daftar pengepul"
              />
            </label>

            {duplicateJenis && (
              <div className="inline-error">
                <AlertTriangle size={15} />
                <span>Jenis sampah "{duplicateJenis}" duplikat. Gabungkan dalam satu baris.</span>
              </div>
            )}

            <div className="sale-items-list">
              {computedItems.map((item, idx) => (
                <div className="sale-item-box" key={item.key}>
                  <div className="sale-item-head">
                    <b>Item #{idx + 1}</b>
                    <div className="action-row">
                      <Badge variant={item.stok > 0 ? 'green' : 'muted'}>
                        Stok gudang: {fmtKg(item.stok)}
                      </Badge>
                      {item.stok > 0 && (
                        <button
                          type="button"
                          className="chip-btn"
                          style={{ padding: '4px 9px', fontSize: 10.5 }}
                          onClick={() =>
                            updateItem(item.key, {
                              berat_gudang: String(item.stok),
                              berat_jual: String(item.stok),
                              manualBeratJual: false,
                            })
                          }
                        >
                          Ambil Semua ({fmtKg(item.stok)})
                        </button>
                      )}
                      {lineItems.length > 1 && (
                        <button
                          type="button"
                          className="icon-action danger"
                          title="Hapus baris"
                          onClick={() => removeItemRow(item.key)}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="form-grid" style={{ marginTop: 10 }}>
                    <label>
                      Jenis Sampah *
                      <select
                        required
                        value={item.jenis_sampah}
                        onChange={(e) =>
                          updateItem(item.key, {
                            jenis_sampah: e.target.value,
                            berat_gudang: '',
                            berat_jual: '',
                            manualBeratJual: false,
                          })
                        }
                      >
                        {prices.map((p) => (
                          <option key={p.id_harga} value={p.jenis_sampah}>
                            {p.jenis_sampah} — Stok: {fmtKg(p.stok_kg || 0)}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      Harga Jual per kg (Rp) *
                      <input
                        type="number"
                        min="1"
                        step="any"
                        required
                        value={item.harga_jual}
                        onChange={(e) =>
                          updateItem(item.key, { harga_jual: e.target.value })
                        }
                        placeholder={`Harga beli: ${fmt(item.hargaBeli)}`}
                      />
                    </label>

                    <label>
                      Berat Keluar Gudang (kg) *
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        required
                        value={item.berat_gudang}
                        onChange={(e) =>
                          updateItem(item.key, { berat_gudang: e.target.value })
                        }
                        placeholder="Berat stok keluar gudang"
                      />
                    </label>

                    <label>
                      Berat Timbangan Pengepul (kg) *
                      <input
                        type="number"
                        min="0.001"
                        step="any"
                        required
                        value={item.berat_jual}
                        onChange={(e) =>
                          updateItem(item.key, {
                            berat_jual: e.target.value,
                            manualBeratJual: true,
                          })
                        }
                        placeholder="Berat bersih dibayar pengepul"
                      />
                    </label>
                  </div>

                  <div className="sale-item-foot">
                    <span>
                      <Scale size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                      Susut:{' '}
                      <b className={item.susut > 0 ? 'negative' : ''}>
                        {fmtKg(item.susut)} ({item.susutPct}%)
                      </b>
                    </span>
                    <span>
                      Subtotal: <b className="positive">{fmt(item.subtotal)}</b>
                    </span>
                  </div>

                  {item.overStock && (
                    <div className="inline-error">
                      <AlertTriangle size={14} />
                      <span>
                        Berat keluar gudang ({fmtKg(item.bg)}) melebihi stok gudang ({fmtKg(item.stok)}).
                      </span>
                    </div>
                  )}

                  {item.sellExceedsWarehouse && (
                    <div className="inline-error">
                      <AlertTriangle size={14} />
                      <span>
                        Berat timbangan pengepul ({fmtKg(item.bj)}) tidak boleh melebihi berat keluar gudang ({fmtKg(item.bg)}).
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {needsScheduleOverride && (
              <div className="account-toggle-box" style={{ borderColor: '#efc784', background: '#fffaf0' }}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={header.diluar_jadwal}
                    onChange={(e) =>
                      setHeader({ ...header, diluar_jadwal: e.target.checked })
                    }
                  />
                  <span>
                    <b>Penjualan di luar jadwal 2 mingguan (mendesak)</b>
                    <small>
                      Penjualan terakhir baru {schedule.daysSinceLast} hari lalu (jadwal 14 hari pada {fmtDate(schedule.nextScheduleDate)}). Centang &amp; isi alasan jika gudang penuh atau mendesak.
                    </small>
                  </span>
                </label>
              </div>
            )}

            <label>
              Catatan / Alasan {needsScheduleOverride ? '(wajib jika di luar jadwal 2 minggu)' : '(opsional)'}
              <input
                maxLength={300}
                required={needsScheduleOverride && header.diluar_jadwal}
                value={header.catatan}
                onChange={(e) =>
                  setHeader({ ...header, catatan: e.target.value })
                }
                placeholder="Contoh: Gudang plastik penuh / catatan susut kelembapan"
              />
            </label>

            <button
              className="primary full"
              disabled={saving || hasItemErrors || scheduleBlocked}
            >
              <ShoppingCart size={16} />
              {saving
                ? 'Menyimpan Penjualan...'
                : `Simpan Penjualan (${computedItems.length} Jenis)`}
            </button>
          </form>
        </Card>

        <Card className="summary-card">
          <div className="stat-icon orange">
            <ShoppingCart size={22} />
          </div>

          <h3>Ringkasan Penjualan</h3>
          <p>Total pendapatan dari {computedItems.length} jenis sampah</p>
          <strong>{fmt(grandTotal)}</strong>

          <div className="summary-breakdown">
            <div>
              <span>Total Keluar Gudang</span>
              <b>{fmtKg(totalGudang)}</b>
            </div>
            <div>
              <span>Total Timbangan Pengepul</span>
              <b>{fmtKg(totalJual)}</b>
            </div>
            <div>
              <span>Selisih Berat (Susut)</span>
              <b className={totalSusut > 0 ? 'negative' : 'positive'}>
                {fmtKg(totalSusut)} ({totalSusutPct}%)
              </b>
            </div>
          </div>

          <div className="summary-note">
            Stok gudang dikurangi sebesar <b>Berat Keluar Gudang</b> per jenis sampah, sedangkan pendapatan dihitung dari <b>Berat Timbangan Pengepul × Harga Jual</b>. Selisihnya dicatat permanen sebagai <b>Susut</b>.
          </div>
        </Card>
      </div>

      <Card style={{ marginTop: 18 }}>
        <div className="table-toolbar">
          <h3>
            Riwayat Penjualan Multi-Item <span className="count">{rows.length}</span>
          </h3>
        </div>

        <DataTable
          pageSize={10}
          headers={[
            'Tanggal',
            'Rincian Jenis (M:N)',
            'Keluar Gudang',
            'Timbang Pengepul',
            'Susut',
            'Total',
            'Pengepul & Jadwal',
            'Aksi',
          ]}
          emptyText="Belum ada riwayat penjualan."
          rows={rows.map((item) => {
            const detailList = item.items || [];
            return [
              fmtDate(item.tanggal),
              <div style={{ display: 'grid', gap: 4 }}>
                {detailList.length > 0 ? (
                  detailList.map((d) => (
                    <div key={d.id_detail || d.jenis_sampah} style={{ fontSize: 11.5 }}>
                      <Badge variant="blue">{d.jenis_sampah}</Badge>{' '}
                      <span>
                        {fmtKg(d.berat_gudang)} → {fmtKg(d.berat_jual)}
                        {Number(d.berat_susut || 0) > 0 && (
                          <span className="negative"> (susut {fmtKg(d.berat_susut)})</span>
                        )}
                      </span>
                    </div>
                  ))
                ) : (
                  <Badge variant="blue">{item.jenis_sampah}</Badge>
                )}
              </div>,
              fmtKg(item.total_berat_gudang || item.berat_jual),
              fmtKg(item.berat_jual),
              <b className={Number(item.total_susut || 0) > 0 ? 'negative' : ''}>
                {fmtKg(item.total_susut || 0)}
              </b>,
              <b className="positive">{fmt(item.total)}</b>,
              <div>
                <b>{item.nama_pengepul || item.pembeli || '-'}</b>
                <small className="cell-sub">
                  {item.diluar_jadwal ? 'Di luar jadwal 2 minggu' : 'Sesuai siklus 2 minggu'}
                  {item.catatan ? ` · ${item.catatan}` : ''}
                </small>
              </div>,
              <button
                type="button"
                className="icon-action danger"
                title="Batalkan (void) penjualan"
                onClick={() => setVoidTarget(item)}
              >
                <RotateCcw size={14} />
              </button>,
            ];
          })}
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
        busy={deletingPengepul}
        onConfirm={handleDeletePengepul}
        onCancel={() => setDeletePengepul(null)}
      />

      <ConfirmDialog
        open={Boolean(voidTarget)}
        title="Batalkan Transaksi Penjualan"
        message={`Batalkan penjualan #${voidTarget?.id_penjualan} (${voidTarget?.jenis_sampah}, keluar gudang ${fmtKg(voidTarget?.total_berat_gudang || voidTarget?.berat_jual)}, senilai ${fmt(voidTarget?.total)})? Stok gudang semua jenis pada transaksi ini akan dikembalikan.`}
        confirmLabel="Ya, Batalkan Penjualan"
        danger
        busy={voiding}
        onConfirm={handleVoid}
        onCancel={() => setVoidTarget(null)}
      />
    </div>
  );
}
