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

  const isLegacy = data.kasOperasional === undefined;
  const persenPotongan = Number(data.potonganKasPersen ?? 10);
  const setorKotor = Number(data.setorKotor ?? data.setor ?? 0);
  const kasOperasional = isLegacy
    ? Math.round(setorKotor * (persenPotongan / 100) * 100) / 100
    : Number(data.kasOperasional || 0);
  const hakNasabahSetor = isLegacy
    ? Math.round((setorKotor - kasOperasional) * 100) / 100
    : Number(data.setor || 0);
  const arusKasPenjualan = Number(data.arusKasPenjualan ?? data.saldoKas ?? 0);

  const schedule = (() => {
    if (data.schedule) return data.schedule;
    const lastSale = (data.recent || []).find((r) => r.tipe === 'Penjualan');
    if (!lastSale?.tanggal) return null;
    const [ly, lm, ld] = String(lastSale.tanggal).split('-').map(Number);
    const nowStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar' }).format(new Date());
    const [ny, nm, nd] = nowStr.split('-').map(Number);
    const dayMs = 86_400_000;
    const lastMs = Date.UTC(ly, lm - 1, ld);
    const nowMs = Date.UTC(ny, nm - 1, nd);
    const daysSinceLast = Math.floor((nowMs - lastMs) / dayMs);
    return {
      isDue: daysSinceLast >= 14,
      daysRemaining: Math.max(0, 14 - daysSinceLast),
      nextScheduleDate: new Date(lastMs + 14 * dayMs).toISOString().slice(0, 10),
    };
  })();

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
      label: `Kas Operasional (${persenPotongan}%)`,
      raw: kasOperasional,
      formatter: (v) => fmt(v),
      sub: isLegacy
        ? `estimasi ${persenPotongan}% dari setoran`
        : `potongan ${persenPotongan}% dari setoran`,
      Icon: Wallet,
      color: 'purple',
    },
    {
      label: 'Kewajiban Saldo Nasabah',
      raw: Number(data.totalSaldoNasabah || 0),
      formatter: (v) => fmt(v),
      sub: 'akumulasi hak 90% nasabah',
      Icon: TrendingUp,
      color: 'blue',
    },
    {
      label: 'Stok Sampah Gudang',
      raw: Number(data.totalStokKg || 0),
      formatter: (v) => fmtKg(v),
      sub: `susut tercatat: ${fmtKg(data.totalSusutKg || 0)}`,
      Icon: Package,
      color: 'orange',
    },
  ];

  const quickActions = [
    { id: 'setoran', label: 'Setoran Sampah', Icon: Recycle, roles: ['Ketua', 'Bendahara', 'Petugas Timbang'] },
    { id: 'penarikan', label: 'Penarikan Saldo', Icon: Wallet, roles: ['Ketua', 'Bendahara'] },
    { id: 'penjualan', label: 'Penjualan Pengepul', Icon: ShoppingCart, roles: ['Ketua', 'Bendahara'] },
    { id: 'nasabah', label: 'Data Nasabah', Icon: Users, roles: ['Ketua', 'Bendahara'] },
    { id: 'harga', label: 'Harga Periode', Icon: Scale, roles: ['Ketua', 'Bendahara'] },
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
            Pantau kas operasional (potongan {persenPotongan}%), saldo nasabah (90%), stok gudang, susut, dan siklus penjualan 2 mingguan.
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
          <span>Nilai Setoran (100% Kotor)</span>
          <b>{fmt(setorKotor)}</b>
          <small>
            {fmtKg(data.beratSetor)} · Hak 90%: {fmt(hakNasabahSetor)}
          </small>
        </div>
        <div>
          <span>Total Penjualan Pengepul</span>
          <b>{fmt(data.penjualan)}</b>
          <small>
            {fmtKg(data.beratJual)} terjual · Susut {fmtKg(data.totalSusutKg || 0)}
          </small>
        </div>
        <div>
          <span>Total Penarikan Nasabah</span>
          <b>{fmt(data.penarikan)}</b>
          <small>Arus jual − tarik: {fmt(arusKasPenjualan)}</small>
        </div>
        <div>
          <span>Siklus Jual 2 Mingguan</span>
          <b className={schedule?.isDue !== false ? 'positive' : ''}>
            {schedule?.isDue !== false
              ? 'Siap Dijual'
              : `${schedule.daysRemaining} hari lagi`}
          </b>
          <small>
            {schedule?.nextScheduleDate
              ? `Jadwal: ${fmtDate(schedule.nextScheduleDate)}`
              : 'Siklus 14 hari pengepul'}
          </small>
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
                    <small>
                      Stok: {fmtKg(item.stok)}
                      {Number(item.susut || 0) > 0 ? ` · Susut: ${fmtKg(item.susut)}` : ''}
                    </small>
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
