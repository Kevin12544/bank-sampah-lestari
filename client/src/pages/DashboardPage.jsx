import React from 'react';
import {
  Leaf,
  Users,
  Wallet,
  Recycle,
  ShoppingCart,
  FileText,
  Package,
  TrendingUp,
  Bell,
  Scale,
} from 'lucide-react';
import { AnimatedValue, Badge, Card } from '../components/UI.jsx';
import { fmt, fmtDate, fmtKg } from '../utils/format.js';

export default function DashboardPage({ data, user, setPage }) {
  const role = user?.role;
  const isManager = role === 'Ketua' || role === 'Bendahara';

  const cards = [
    {
      label: 'Total Nasabah',
      raw: Number(data.nasabah || 0),
      formatter: (v) => Math.round(v).toLocaleString('id-ID'),
      sub: 'nasabah terdaftar',
      Icon: Users,
      color: 'green',
    },
    {
      label: 'Saldo Kas Operasional',
      raw: Number(data.saldoKas || 0),
      formatter: (v) => fmt(v),
      sub: 'penjualan − penarikan',
      Icon: Wallet,
      color: Number(data.saldoKas || 0) < 0 ? 'red' : 'purple',
    },
    {
      label: 'Kewajiban Saldo Nasabah',
      raw: Number(data.totalSaldoNasabah || 0),
      formatter: (v) => fmt(v),
      sub: 'total simpanan anggota',
      Icon: TrendingUp,
      color: 'blue',
    },
    {
      label: 'Stok Sampah Gudang',
      raw: Number(data.totalStokKg || 0),
      formatter: (v) => fmtKg(v),
      sub: 'siap dijual ke pengepul',
      Icon: Package,
      color: 'orange',
    },
  ];

  const quickActions = [
    { id: 'setoran', label: 'Setoran Sampah', Icon: Recycle, roles: ['Ketua', 'Bendahara', 'Petugas Timbang'] },
    { id: 'penarikan', label: 'Penarikan Saldo', Icon: Wallet, roles: ['Ketua', 'Bendahara'] },
    { id: 'penjualan', label: 'Penjualan Pengepul', Icon: ShoppingCart, roles: ['Ketua', 'Bendahara'] },
    { id: 'nasabah', label: 'Data Nasabah', Icon: Users, roles: ['Ketua', 'Bendahara'] },
    { id: 'harga', label: 'Kelola Harga', Icon: Scale, roles: ['Ketua', 'Bendahara'] },
    { id: 'laporan', label: 'Laporan Bulanan', Icon: FileText, roles: ['Ketua', 'Bendahara'] },
    { id: 'notifikasi', label: 'Notifikasi', Icon: Bell, roles: ['Petugas Timbang'] },
  ].filter((item) => item.roles.includes(role));

  const chartItems = data.chart || [];
  const maxWeight = Math.max(1, ...chartItems.map((r) => Number(r.berat) || 0));

  const trend = data.monthlyTrend || [];
  const maxTrend = Math.max(
    1,
    ...trend.flatMap((m) => [Number(m.setor || 0), Number(m.penjualan || 0), Number(m.penarikan || 0)])
  );

  const badgeForType = (tipe) => {
    if (tipe === 'Setoran') return <Badge variant="green">Setoran</Badge>;
    if (tipe === 'Penjualan') return <Badge variant="blue">Penjualan</Badge>;
    return <Badge variant="orange">Penarikan</Badge>;
  };

  return (
    <div className="page-enter">
      <div className="welcome">
        <div>
          <span className="eyebrow light">RINGKASAN OPERASIONAL</span>
          <h2>Selamat datang, {user?.nama_user || 'Pengguna'}!</h2>
          <p>
            Pantau arus kas, kewajiban saldo nasabah, dan stok sampah secara real-time.
          </p>
        </div>

        <div className="welcome-mark">
          <Leaf size={62} />
        </div>
      </div>

      <div className="stat-grid">
        {cards.map((card, idx) => (
          <Card
            className="stat-card stagger-item"
            key={card.label}
            style={{ animationDelay: `${idx * 65}ms` }}
          >
            <div className={'stat-icon ' + card.color}>
              <card.Icon size={22} />
            </div>
            <span>{card.label}</span>
            <strong>
              <AnimatedValue value={card.raw} formatter={card.formatter} />
            </strong>
            <small>{card.sub}</small>
          </Card>
        ))}
      </div>

      <div className="mini-metrics">
        <div>
          <span>Total Nilai Setoran</span>
          <b>{fmt(data.setor)}</b>
          <small>{fmtKg(data.beratSetor)} terkumpul</small>
        </div>
        <div>
          <span>Total Penjualan Pengepul</span>
          <b>{fmt(data.penjualan)}</b>
          <small>{fmtKg(data.beratJual)} terjual</small>
        </div>
        <div>
          <span>Total Penarikan Nasabah</span>
          <b>{fmt(data.penarikan)}</b>
          <small>pencairan tunai</small>
        </div>
        <div>
          <span>Selisih Jual − Beli</span>
          <b className={Number(data.marginKotor || 0) >= 0 ? 'positive' : 'negative'}>
            {fmt(data.marginKotor)}
          </b>
          <small>estimasi margin kotor</small>
        </div>
      </div>

      <div className="two-col">
        <Card>
          <div className="card-title">
            <div>
              <h3>Distribusi &amp; Stok Sampah</h3>
              <p>Total terkumpul dan sisa stok gudang per jenis sampah</p>
            </div>

            <button
              type="button"
              className="text-button"
              onClick={() => setPage('setoran')}
            >
              Catat setoran →
            </button>
          </div>

          <div className="chart">
            {chartItems.map((item, idx) => {
              const collectedPct = Math.min(100, (Number(item.berat || 0) / maxWeight) * 100);
              return (
                <div className="bar-row" key={item.jenis}>
                  <span className="bar-label">
                    {item.jenis}
                    <small>Stok: {fmtKg(item.stok)}</small>
                  </span>
                  <div className="bar-track">
                    <i
                      className="bar-fill"
                      style={{
                        width: `${collectedPct}%`,
                        transitionDelay: `${idx * 45}ms`,
                      }}
                    />
                  </div>
                  <b>{fmtKg(item.berat)}</b>
                </div>
              );
            })}

            {!chartItems.length && (
              <p className="empty">Belum ada data setoran sampah.</p>
            )}
          </div>
        </Card>

        <Card>
          <div className="card-title">
            <div>
              <h3>Menu Pintas</h3>
              <p>Akses cepat sesuai peran ({role})</p>
            </div>
          </div>

          <div className="quick-grid">
            {quickActions.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => setPage(item.id)}
              >
                <item.Icon size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>

          {isManager && trend.length > 0 && (
            <div className="trend-box">
              <div className="trend-head">
                <h4>Tren 6 Bulan Terakhir</h4>
                <div className="trend-legend">
                  <span><i className="dot green" /> Setoran</span>
                  <span><i className="dot blue" /> Penjualan</span>
                  <span><i className="dot orange" /> Penarikan</span>
                </div>
              </div>
              <div className="trend-bars">
                {trend.map((m) => (
                  <div className="trend-col" key={m.key}>
                    <div className="trend-sticks">
                      <span
                        className="stick green"
                        style={{ height: `${Math.max(4, (m.setor / maxTrend) * 100)}%` }}
                        title={`Setoran ${m.label}: ${fmt(m.setor)}`}
                      />
                      <span
                        className="stick blue"
                        style={{ height: `${Math.max(4, (m.penjualan / maxTrend) * 100)}%` }}
                        title={`Penjualan ${m.label}: ${fmt(m.penjualan)}`}
                      />
                      <span
                        className="stick orange"
                        style={{ height: `${Math.max(4, (m.penarikan / maxTrend) * 100)}%` }}
                        title={`Penarikan ${m.label}: ${fmt(m.penarikan)}`}
                      />
                    </div>
                    <small>{m.label}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div className="card-title">
          <div>
            <h3>Aktivitas Transaksi Terbaru</h3>
            <p>Gabungan setoran, penarikan, dan penjualan terakhir</p>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tipe</th>
                <th>Pihak / Nasabah</th>
                <th>Tanggal</th>
                <th>Detail</th>
                <th>Berat</th>
                <th>Nominal</th>
              </tr>
            </thead>

            <tbody>
              {(data.recent || []).map((item) => (
                <tr key={item.uid || `${item.tipe}-${item.id}`}>
                  <td>{badgeForType(item.tipe)}</td>
                  <td><b>{item.nama}</b></td>
                  <td>{fmtDate(item.tanggal)}</td>
                  <td>{item.keterangan}</td>
                  <td>{Number(item.berat || 0) > 0 ? fmtKg(item.berat) : '-'}</td>
                  <td className={item.tipe === 'Penarikan' ? 'negative' : 'positive'}>
                    {item.tipe === 'Penarikan' ? '- ' : '+ '}
                    {fmt(item.nilai)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!data.recent?.length && (
            <p className="empty">Belum ada transaksi tercatat.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
