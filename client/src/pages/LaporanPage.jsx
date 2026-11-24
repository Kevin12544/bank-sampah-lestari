import React, { useEffect, useState } from 'react';
import { Printer, Download, Filter } from 'lucide-react';
import { Badge, Card, DataTable, Heading } from '../components/UI.jsx';
import {
  MONTH_NAMES,
  dateNow,
  exportCsv,
  fmt,
  fmtDate,
  fmtKg,
  witaMonthYear,
} from '../utils/format.js';

export default function LaporanPage({ data, api, setData, notify }) {
  const initial = witaMonthYear();
  const [month, setMonth] = useState(data.month || initial.month);
  const [year, setYear] = useState(data.year || initial.year);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (data.month) setMonth(data.month);
    if (data.year) setYear(data.year);
  }, [data.month, data.year]);

  async function show() {
    if (loading) return;
    setLoading(true);
    try {
      const result = await api(`/laporan?month=${month}&year=${year}`);
      setData(result);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleExportCsv() {
    const ledger = data.transaksi || [];
    const monthLabel = MONTH_NAMES[(data.month || month) - 1] || month;
    exportCsv(
      `laporan-bank-sampah-lestari-${monthLabel.toLowerCase()}-${data.year || year}.csv`,
      ['Tanggal', 'Tipe', 'Pihak / Nasabah', 'Kategori / Keterangan', 'Berat (kg)', 'Nominal (Rp)', 'Petugas'],
      ledger.map((row) => [
        row.tanggal,
        row.tipe,
        row.pihak,
        row.kategori,
        Number(row.berat || 0),
        Number(row.nominal || 0),
        row.petugas || '-',
      ])
    );
    notify('Laporan periode berhasil diekspor ke CSV.', 'info');
  }

  const periodTitle = `${MONTH_NAMES[(data.month || month) - 1] || ''} ${data.year || year}`;

  return (
    <div className="page-enter">
      <Heading
        title="Laporan Bulanan"
        desc="Rangkuman setoran, penarikan, penjualan, arus kas, dan stok untuk periode yang dipilih."
        action={
          <>
            <button
              type="button"
              className="secondary-btn"
              onClick={handleExportCsv}
              disabled={!(data.transaksi || []).length}
            >
              <Download size={16} /> Ekspor CSV
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => window.print()}
            >
              <Printer size={17} /> Cetak Laporan
            </button>
          </>
        }
      />

      <div className="print-letterhead">
        <h2>BANK SAMPAH LESTARI</h2>
        <p>Laporan Operasional &amp; Keuangan Bulanan — Periode {periodTitle}</p>
        <small>Dicetak pada {fmtDate(dateNow())}</small>
      </div>

      <Card>
        <div className="filters no-print">
          <label>
            Bulan
            <select
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTH_NAMES.map((name, index) => (
                <option value={index + 1} key={name}>
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
            className="primary"
            onClick={show}
            disabled={loading}
          >
            <Filter size={15} />
            {loading ? 'Memuat...' : 'Tampilkan Laporan'}
          </button>
        </div>

        <div className="report-stats">
          <div>
            <small>Total Setoran ({data.setor?.jumlah_transaksi || 0} trx)</small>
            <b>{fmt(data.setor?.total)}</b>
            <span>{fmtKg(data.setor?.berat || 0)}</span>
          </div>

          <div>
            <small>Total Penarikan ({data.tarik?.jumlah_transaksi || 0} trx)</small>
            <b className="negative">{fmt(data.tarik?.total)}</b>
            <span>pencairan nasabah</span>
          </div>

          <div>
            <small>Total Penjualan ({data.jual?.jumlah_transaksi || 0} trx)</small>
            <b>{fmt(data.jual?.total)}</b>
            <span>{fmtKg(data.jual?.berat || 0)}</span>
          </div>

          <div>
            <small>Arus Kas Periode</small>
            <b className={Number(data.arusKasPeriode || 0) >= 0 ? 'positive' : 'negative'}>
              {fmt(data.arusKasPeriode)}
            </b>
            <span>penjualan − penarikan</span>
          </div>

          <div>
            <small>Estimasi Margin Periode</small>
            <b className={Number(data.estimasiMargin || 0) >= 0 ? 'positive' : 'negative'}>
              {fmt(data.estimasiMargin)}
            </b>
            <span>penjualan − setoran</span>
          </div>

          <div>
            <small>Total Kewajiban Saldo Nasabah</small>
            <b>{fmt(data.totalSaldoNasabah)}</b>
            <span>akumulasi seluruh anggota</span>
          </div>
        </div>

        <div className="two-col" style={{ marginTop: 18 }}>
          <div>
            <h3 className="sub-heading">Rincian Setoran per Jenis</h3>
            <DataTable
              pageSize={0}
              headers={['Jenis Sampah', 'Berat', 'Total Nilai']}
              emptyText="Tidak ada setoran pada periode ini."
              rows={(data.detail || []).map((item) => [
                <b>{item.jenis}</b>,
                fmtKg(item.berat),
                fmt(item.total),
              ])}
            />
          </div>

          <div>
            <h3 className="sub-heading">Rincian Penjualan per Jenis</h3>
            <DataTable
              pageSize={0}
              headers={['Jenis Sampah', 'Berat Terjual', 'Total Penjualan']}
              emptyText="Tidak ada penjualan pada periode ini."
              rows={(data.detailJual || []).map((item) => [
                <b>{item.jenis}</b>,
                fmtKg(item.berat),
                fmt(item.total),
              ])}
            />
          </div>
        </div>

        <h3 className="sub-heading" style={{ marginTop: 22 }}>
          Buku Transaksi Periode {periodTitle} ({(data.transaksi || []).length})
        </h3>

        <DataTable
          pageSize={15}
          headers={['Tanggal', 'Tipe', 'Pihak / Nasabah', 'Detail', 'Berat', 'Nominal']}
          emptyText="Tidak ada transaksi pada periode ini."
          rows={(data.transaksi || []).map((tx) => [
            fmtDate(tx.tanggal),
            <Badge
              variant={
                tx.tipe === 'Setoran'
                  ? 'green'
                  : tx.tipe === 'Penjualan'
                  ? 'blue'
                  : 'orange'
              }
            >
              {tx.tipe}
            </Badge>,
            <b>{tx.pihak}</b>,
            tx.kategori,
            Number(tx.berat || 0) > 0 ? fmtKg(tx.berat) : '-',
            <b className={tx.tipe === 'Penarikan' ? 'negative' : 'positive'}>
              {fmt(tx.nominal)}
            </b>,
          ])}
        />

        <div className="print-signatures">
          <div>
            <span>Mengetahui,</span>
            <b>Ketua Bank Sampah Lestari</b>
            <div className="sig-space" />
            <u>{data.ketuaNama || 'Meiske Rondonuwu'}</u>
          </div>
          <div>
            <span>Dibuat oleh,</span>
            <b>Bendahara</b>
            <div className="sig-space" />
            <u>________________________</u>
          </div>
        </div>
      </Card>
    </div>
  );
}
