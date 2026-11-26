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
      [
        'Tanggal',
        'Tipe',
        'Pihak / Nasabah',
        'Kategori / Keterangan',
        'Berat (kg)',
        'Nilai Kotor (Rp)',
        'Potongan Kas 10% (Rp)',
        'Nominal Bersih (Rp)',
        'Petugas',
      ],
      ledger.map((row) => [
        row.tanggal,
        row.tipe,
        row.pihak,
        row.kategori,
        Number(row.berat || 0),
        Number(row.nilai_kotor ?? row.nominal ?? 0),
        Number(row.potongan_kas ?? 0),
        Number(row.nominal || 0),
        row.petugas || '-',
      ])
    );
    notify('Laporan periode berhasil diekspor ke CSV.', 'info');
  }

  const periodTitle = `${MONTH_NAMES[(data.month || month) - 1] || ''} ${data.year || year}`;
  const kasOps = data.kasOperasionalPeriode ?? data.setor?.potonganKas ?? 0;

  return (
    <div className="page-enter">
      <Heading
        title="Laporan Bulanan & Kas Operasional"
        desc="Rangkuman setoran (10% Kas : 90% Nasabah), penarikan, penjualan multi-item & susut, serta tarif periode berlaku."
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
        <p>Laporan Operasional, Kas 10%, &amp; Susut Bulanan — Periode {periodTitle}</p>
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
            <small>Kas Operasional (Potongan 10%)</small>
            <b className="positive">{fmt(kasOps)}</b>
            <span>sumber utama kas operasional bank sampah</span>
          </div>

          <div>
            <small>Total Setoran ({data.setor?.jumlah_transaksi || 0} trx)</small>
            <b>{fmt(data.setor?.totalKotor ?? data.setor?.total)}</b>
            <span>
              {fmtKg(data.setor?.berat || 0)} · Hak Nasabah 90%: {fmt(data.setor?.totalNasabah ?? data.setor?.total)}
            </span>
          </div>

          <div>
            <small>Total Penarikan ({data.tarik?.jumlah_transaksi || 0} trx)</small>
            <b className="negative">{fmt(data.tarik?.total)}</b>
            <span>pencairan saldo anggota</span>
          </div>

          <div>
            <small>Total Penjualan ({data.jual?.jumlah_transaksi || 0} trx)</small>
            <b>{fmt(data.jual?.total)}</b>
            <span>
              Gudang {fmtKg(data.jual?.beratGudang ?? data.jual?.berat)} → Jual {fmtKg(data.jual?.berat || 0)}
            </span>
          </div>

          <div>
            <small>Total Selisih Susut Periode</small>
            <b className={Number(data.jual?.totalSusut || 0) > 0 ? 'negative' : ''}>
              {fmtKg(data.jual?.totalSusut || 0)}
            </b>
            <span>selisih berat gudang vs timbangan pengepul</span>
          </div>

          <div>
            <small>Total Kewajiban Saldo Nasabah</small>
            <b>{fmt(data.totalSaldoNasabah)}</b>
            <span>arus jual − tarik periode: {fmt(data.arusKasPeriode)}</span>
          </div>
        </div>

        <div className="two-col" style={{ marginTop: 18 }}>
          <div>
            <h3 className="sub-heading">Rincian Setoran (10% Kas : 90% Nasabah)</h3>
            <DataTable
              pageSize={0}
              headers={['Jenis', 'Berat', 'Kotor (100%)', 'Kas (10%)', 'Nasabah (90%)']}
              emptyText="Tidak ada setoran pada periode ini."
              rows={(data.detail || []).map((item) => [
                <b>{item.jenis}</b>,
                fmtKg(item.berat),
                fmt(item.kotor ?? item.total),
                <span className="negative">{fmt(item.potongan_kas ?? 0)}</span>,
                <b className="positive">{fmt(item.total)}</b>,
              ])}
            />
          </div>

          <div>
            <h3 className="sub-heading">Rincian Penjualan &amp; Susut per Jenis</h3>
            <DataTable
              pageSize={0}
              headers={['Jenis', 'Gudang', 'Jual', 'Susut', 'Total']}
              emptyText="Tidak ada penjualan pada periode ini."
              rows={(data.detailJual || []).map((item) => [
                <b>{item.jenis}</b>,
                fmtKg(item.berat_gudang ?? item.berat),
                fmtKg(item.berat),
                <span className={Number(item.berat_susut || 0) > 0 ? 'negative' : ''}>
                  {fmtKg(item.berat_susut || 0)}
                </span>,
                <b className="positive">{fmt(item.total)}</b>,
              ])}
            />
          </div>
        </div>

        {(data.hargaPeriode || []).length > 0 && (
          <div style={{ marginTop: 22 }}>
            <h3 className="sub-heading">
              Snapshot HargaPeriode Berlaku — {periodTitle}
            </h3>
            <DataTable
              pageSize={0}
              headers={['Jenis Sampah', 'Harga/kg', 'Status', 'Ditetapkan Oleh']}
              rows={(data.hargaPeriode || []).map((hp) => [
                <b>{hp.jenis_sampah}</b>,
                fmt(hp.harga_per_kg),
                <Badge variant={hp.status === 'terkunci' ? 'orange' : 'green'}>
                  {hp.status === 'terkunci' ? 'Terkunci' : 'Draft'}
                </Badge>,
                hp.ditetapkan_oleh || 'Sistem',
              ])}
            />
          </div>
        )}

        <h3 className="sub-heading" style={{ marginTop: 22 }}>
          Buku Transaksi Periode {periodTitle} ({(data.transaksi || []).length})
        </h3>

        <DataTable
          pageSize={15}
          headers={['Tanggal', 'Tipe', 'Pihak / Nasabah', 'Detail', 'Berat', 'Kas 10%', 'Nominal']}
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
            Number(tx.potongan_kas || 0) > 0 ? (
              <span className="negative">{fmt(tx.potongan_kas)}</span>
            ) : (
              '-'
            ),
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
