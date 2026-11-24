import React, { useState } from 'react';
import {
  Recycle,
  Wallet,
  Search,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import {
  Badge,
  Card,
  ConfirmDialog,
  DataTable,
  Heading,
  ReceiptModal,
} from '../components/UI.jsx';
import { dateNow, fmt, fmtDate, fmtKg } from '../utils/format.js';

export default function SetoranPage({ data, user, api, notify, reload }) {
  const [customer, setCustomer] = useState('');
  const [items, setItems] = useState({});
  const [tanggal, setTanggal] = useState(dateNow());
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState(null);

  const [search, setSearch] = useState('');
  const [voidTarget, setVoidTarget] = useState(null);
  const [voiding, setVoiding] = useState(false);

  const canVoid = user?.role === 'Ketua' || user?.role === 'Bendahara';
  const prices = data.prices || [];
  const customers = data.customers || [];
  const history = data.history || [];

  const selectedCustomer = customers.find(
    (c) => String(c.id_nasabah) === String(customer)
  );

  const activeItems = prices
    .map((price) => ({
      jenis: price.jenis_sampah,
      harga: Number(price.harga_per_kg || 0),
      berat: Number(items[price.jenis_sampah] || 0),
    }))
    .filter((i) => i.berat > 0);

  const totalBerat = activeItems.reduce((sum, i) => sum + i.berat, 0);
  const total = activeItems.reduce(
    (sum, i) => sum + Math.round(i.berat * i.harga * 100) / 100,
    0
  );

  async function save(e) {
    e.preventDefault();
    if (saving) return;

    if (!customer) {
      notify('Pilih nasabah terlebih dahulu.', 'error');
      return;
    }

    if (!activeItems.length) {
      notify('Masukkan berat minimal satu jenis sampah lebih dari 0 kg.', 'error');
      return;
    }

    setSaving(true);
    try {
      const result = await api('/setoran', {
        method: 'POST',
        body: JSON.stringify({
          id_nasabah: Number(customer),
          tanggal,
          items: activeItems.map((i) => ({ jenis: i.jenis, berat: i.berat })),
        }),
      });

      notify('Setoran tersimpan. Nilai: ' + fmt(result.total), 'success');
      setItems({});
      if (result.receipt) {
        setReceipt(result.receipt);
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
      const res = await api(`/setoran/${voidTarget.id_setor}`, {
        method: 'DELETE',
      });
      notify(res.message || 'Setoran dibatalkan.', 'warning');
      setVoidTarget(null);
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setVoiding(false);
    }
  }

  const filteredHistory = history.filter((row) =>
    `${row.nama_nasabah || ''} ${row.no_buku || ''} ${row.jenis_sampah || ''} ${row.petugas || ''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="page-enter">
      <Heading
        title="Pencatatan Setoran Sampah"
        desc="Catat berat sampah nasabah. Saldo bertambah otomatis berdasarkan harga aktif."
      />

      <form onSubmit={save}>
        <div className="transaction-layout">
          <Card>
            <h3>Detail Setoran</h3>

            <div className="form-grid" style={{ marginTop: 14 }}>
              <label>
                Nama Nasabah *
                <select
                  value={customer}
                  onChange={(e) => setCustomer(e.target.value)}
                  required
                >
                  <option value="">Pilih nasabah</option>
                  {customers.map((item) => (
                    <option value={item.id_nasabah} key={item.id_nasabah}>
                      {item.nama} — {item.no_buku}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Tanggal Setoran *
                <input
                  type="date"
                  value={tanggal}
                  onChange={(e) => setTanggal(e.target.value)}
                  required
                />
              </label>
            </div>

            {selectedCustomer && (
              <div className="balance-hint" style={{ marginTop: 12 }}>
                <span>
                  Saldo saat ini ({selectedCustomer.no_buku})
                </span>
                <b>{fmt(selectedCustomer.saldo)}</b>
              </div>
            )}

            <div className="section-label">Jenis dan Berat Sampah</div>

            <div className="weight-grid">
              {prices.map((price) => {
                const val = items[price.jenis_sampah] || '';
                const hasVal = Number(val) > 0;
                return (
                  <label
                    key={price.id_harga}
                    className={hasVal ? 'weight-active' : ''}
                  >
                    <span>
                      {price.jenis_sampah}
                      <small>{fmt(price.harga_per_kg)}/kg</small>
                    </span>

                    <div>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0"
                        value={val}
                        onChange={(e) =>
                          setItems({
                            ...items,
                            [price.jenis_sampah]: e.target.value,
                          })
                        }
                      />
                      kg
                    </div>
                  </label>
                );
              })}
            </div>

            <button className="primary full" disabled={saving}>
              <Recycle size={17} />
              {saving ? 'Menyimpan Setoran...' : 'Simpan Setoran'}
            </button>
          </Card>

          <Card className="summary-card">
            <div className="stat-icon green">
              <Wallet size={22} />
            </div>

            <h3>Ringkasan Setoran</h3>
            <p>Total estimasi nilai setoran ({fmtKg(totalBerat)})</p>
            <strong>{fmt(total)}</strong>

            {activeItems.length > 0 && (
              <div className="summary-breakdown">
                {activeItems.map((i) => (
                  <div key={i.jenis}>
                    <span>
                      <CheckCircle2 size={13} /> {i.jenis} ({fmtKg(i.berat)})
                    </span>
                    <b>{fmt(i.berat * i.harga)}</b>
                  </div>
                ))}
              </div>
            )}

            {selectedCustomer && total > 0 && (
              <div className="summary-projected">
                <span>Estimasi saldo akhir</span>
                <b>{fmt(Number(selectedCustomer.saldo || 0) + total)}</b>
              </div>
            )}

            <div className="summary-note">
              Nilai akhir dihitung di server secara atomik berdasarkan harga aktif dan dicatat ke log audit.
            </div>
          </Card>
        </div>
      </form>

      <Card style={{ marginTop: 18 }}>
        <div className="table-toolbar">
          <h3>
            Riwayat Setoran Terbaru <span className="count">{filteredHistory.length}</span>
          </h3>
          <div className="search">
            <Search size={15} />
            <input
              placeholder="Cari nasabah, jenis, petugas..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <DataTable
          pageSize={10}
          headers={[
            'Tanggal',
            'Nasabah',
            'Jenis Sampah',
            'Berat',
            'Nilai Setoran',
            'Petugas',
            ...(canVoid ? ['Aksi'] : []),
          ]}
          emptyText="Belum ada riwayat setoran."
          rows={filteredHistory.map((row) => {
            const cols = [
              fmtDate(row.tanggal),
              <div>
                <b>{row.nama_nasabah}</b>
                <small className="cell-sub">{row.no_buku}</small>
              </div>,
              <Badge variant="green">{row.jenis_sampah}</Badge>,
              fmtKg(row.berat_awal),
              <b className="positive">+ {fmt(row.nilai_setor)}</b>,
              row.petugas,
            ];
            if (canVoid) {
              cols.push(
                <button
                  type="button"
                  className="icon-action danger"
                  title="Batalkan (void) setoran ini"
                  onClick={() => setVoidTarget(row)}
                >
                  <RotateCcw size={14} />
                </button>
              );
            }
            return cols;
          })}
        />
      </Card>

      <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />

      <ConfirmDialog
        open={Boolean(voidTarget)}
        title="Batalkan Transaksi Setoran"
        message={`Batalkan setoran ${voidTarget?.jenis_sampah} ${fmtKg(voidTarget?.berat_awal)} milik ${voidTarget?.nama_nasabah} (${fmt(voidTarget?.nilai_setor)})? Saldo nasabah dan stok sampah akan dikurangi kembali.`}
        confirmLabel="Ya, Batalkan Setoran"
        danger
        busy={voiding}
        onConfirm={handleVoid}
        onCancel={() => setVoidTarget(null)}
      />
    </div>
  );
}
