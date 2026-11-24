import React, { useState } from 'react';
import { Wallet, Recycle, ArrowDownLeft, Scale } from 'lucide-react';
import { AnimatedValue, Badge, Card, DataTable, Heading } from '../components/UI.jsx';
import { fmt, fmtDate, fmtKg } from '../utils/format.js';

export default function SaldoPage({ data }) {
  const [filterType, setFilterType] = useState('all');

  const customer = data.customer;
  const summary = data.summary || {};
  const prices = data.prices || [];
  const items = (data.items || []).filter((tx) =>
    filterType === 'all' ? true : tx.tipe === filterType
  );

  return (
    <div className="page-enter">
      <Heading
        title="Saldo Saya"
        desc="Pantau saldo tabungan sampah, riwayat transaksi pribadi, dan daftar harga sampah terbaru."
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
        </Card>

        <div className="nasabah-mini-stats">
          <Card className="stat-card">
            <div className="stat-icon green"><Recycle size={20} /></div>
            <span>Total Nilai Setoran</span>
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
              item.tipe === 'Setoran'
                ? item.jenis_sampah
                : item.keterangan || 'Penarikan saldo',
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
                Daftar Harga Sampah Aktif
              </h3>
              <p>Acuan harga beli Bank Sampah Lestari per kilogram</p>
            </div>
          </div>

          <DataTable
            pageSize={0}
            headers={['Jenis Sampah', 'Harga/kg', 'Diperbarui']}
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
