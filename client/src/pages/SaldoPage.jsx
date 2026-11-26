import React, { useState } from 'react';
import { Wallet, Recycle, ArrowDownLeft, Scale } from 'lucide-react';
import { AnimatedValue, Badge, Card, DataTable, Heading } from '../components/UI.jsx';
import { fmt, fmtDate, fmtKg } from '../utils/format.js';

export default function SaldoPage({ data }) {
  const [filterType, setFilterType] = useState('all');

  const customer = data.customer;
  const summary = data.summary || {};
  const prices = data.prices || [];
  const minPenarikan =
    data.minPenarikan !== undefined ? Number(data.minPenarikan) : 50000;
  const potonganPersen = Number(data.potonganKasPersen ?? 10);
  const items = (data.items || []).filter((tx) =>
    filterType === 'all' ? true : tx.tipe === filterType
  );

  return (
    <div className="page-enter">
      <Heading
        title="Saldo Saya"
        desc="Pantau saldo tabungan sampah (hak 90% setoran), riwayat transaksi pribadi, dan tarif harga periode berlaku."
      />

      <div className="saldo-hero-grid">
        <Card className="my-balance">
          <div className="stat-icon green">
            <Wallet size={22} />
          </div>

          <span>Saldo Tersedia</span>
          <strong>
            <AnimatedValue value={Number(customer?.saldo || 0)} formatter={fmt} />
          </strong>

          <small>
            {customer
              ? `${customer.nama} · No. Buku ${customer.no_buku}`
              : 'Rekening nasabah belum ditautkan ke akun ini.'}
          </small>

          <small style={{ marginTop: 8, opacity: 0.92, lineHeight: 1.5 }}>
            Penarikan min. <b>{fmt(minPenarikan)}</b> · Maks. <b>1×/bulan</b> · Bulan <b>Desember</b> boleh tarik seluruh saldo.
            {data.sudahTarikBulanIni && ' (Status: sudah menarik bulan ini)'}
          </small>
          <small style={{ marginTop: 4, opacity: 0.88 }}>
            Bagi hasil setoran: <b>{100 - potonganPersen}%</b> saldo nasabah · <b>{potonganPersen}%</b> kas operasional.
          </small>
        </Card>

        <div className="nasabah-mini-stats">
          <Card className="stat-card">
            <div className="stat-icon green"><Recycle size={20} /></div>
            <span>Total Hak Setoran (90%)</span>
            <strong>{fmt(summary.totalSetor)}</strong>
            <small>{fmtKg(summary.totalBeratKg)} sampah disetor</small>
          </Card>

          <Card className="stat-card">
            <div className="stat-icon orange"><ArrowDownLeft size={20} /></div>
            <span>Total Penarikan</span>
            <strong>{fmt(summary.totalTarik)}</strong>
            <small>{summary.jumlahTransaksi || 0} total transaksi</small>
          </Card>
        </div>
      </div>

      <div className="two-col" style={{ marginTop: 18 }}>
        <Card>
          <div className="table-toolbar wrap-toolbar">
            <h3>Riwayat Transaksi</h3>
            <div className="seg-tabs">
              {[
                ['all', 'Semua'],
                ['Setoran', 'Setoran'],
                ['Penarikan', 'Penarikan'],
              ].map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  className={filterType === id ? 'seg-btn active' : 'seg-btn'}
                  onClick={() => setFilterType(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <DataTable
            pageSize={10}
            headers={['Tanggal', 'Tipe', 'Detail', 'Berat', 'Nominal']}
            emptyText="Belum ada riwayat transaksi."
            rows={items.map((item) => [
              fmtDate(item.tanggal),
              <Badge variant={item.tipe === 'Setoran' ? 'green' : 'orange'}>
                {item.tipe}
              </Badge>,
              item.tipe === 'Setoran' ? (
                <div>
                  <b>{item.jenis_sampah}</b>
                  {Number(item.potongan_kas || 0) > 0 && (
                    <small className="cell-sub">
                      Kotor {fmt(item.nilai_kotor)} · Kas 10%: {fmt(item.potongan_kas)}
                    </small>
                  )}
                </div>
              ) : (
                item.keterangan || 'Penarikan saldo'
              ),
              Number(item.berat || 0) > 0 ? fmtKg(item.berat) : '-',
              item.tipe === 'Setoran' ? (
                <b className="positive">+ {fmt(item.nilai)}</b>
              ) : (
                <b className="negative">- {fmt(item.nilai)}</b>
              ),
            ])}
          />
        </Card>

        <Card>
          <div className="card-title">
            <div>
              <h3>
                <Scale size={15} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Daftar Harga Periode {data.periodeLabel || 'Aktif'}
              </h3>
              <p>Harga ditetapkan tiap awal bulan (setoran lama tetap pakai harga saat setor)</p>
            </div>
          </div>

          <DataTable
            pageSize={0}
            headers={['Jenis Sampah', 'Harga/kg', 'Berlaku']}
            emptyText="Daftar harga belum tersedia."
            rows={prices.map((p) => [
              <b>{p.jenis_sampah}</b>,
              <b className="positive">{fmt(p.harga_per_kg)}</b>,
              fmtDate(p.tgl_mulai),
            ])}
          />
        </Card>
      </div>
    </div>
  );
}
