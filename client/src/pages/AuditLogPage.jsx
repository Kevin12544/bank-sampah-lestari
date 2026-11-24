import React, { useState } from 'react';
import { Search, Shield } from 'lucide-react';
import { Badge, Card, DataTable, Heading } from '../components/UI.jsx';
import { fmtDateTime } from '../utils/format.js';

export default function AuditLogPage({ data }) {
  const [q, setQ] = useState('');
  const [filterAction, setFilterAction] = useState('');

  const rows = data.rows || [];
  const actions = Array.from(new Set(rows.map((r) => r.action))).sort();

  const filtered = rows.filter((item) => {
    if (filterAction && item.action !== filterAction) return false;
    if (!q.trim()) return true;
    return `${item.username} ${item.role} ${item.action} ${item.entity} ${item.detail}`
      .toLowerCase()
      .includes(q.toLowerCase());
  });

  const variantFor = (action) => {
    if (action.includes('FAIL') || action.includes('LOCK') || action.includes('VOID') || action.includes('DELETE')) {
      return 'red';
    }
    if (action.includes('PASSWORD') || action.includes('RESET') || action.includes('LOGOUT')) {
      return 'orange';
    }
    if (action.includes('CREATE') || action.includes('SUCCESS')) {
      return 'green';
    }
    return 'blue';
  };

  return (
    <div className="page-enter">
      <Heading
        title="Log Audit Keamanan & Transaksi"
        desc="Rekam jejak seluruh aktivitas penting sistem untuk transparansi dan keamanan operasional."
      />

      <Card>
        <div className="table-toolbar wrap-toolbar">
          <h3>
            <Shield size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Riwayat Aktivitas <span className="count">{filtered.length}</span>
          </h3>

          <div className="toolbar-controls">
            <select
              className="compact-select"
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
            >
              <option value="">Semua Aksi</option>
              {actions.map((act) => (
                <option key={act} value={act}>
                  {act}
                </option>
              ))}
            </select>

            <div className="search">
              <Search size={15} />
              <input
                placeholder="Cari pengguna atau detail..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DataTable
          pageSize={15}
          headers={['Waktu', 'Pengguna', 'Aksi', 'Detail Aktivitas', 'IP']}
          emptyText="Belum ada catatan audit."
          rows={filtered.map((item) => [
            <span className="cell-nowrap">{fmtDateTime(item.created_at)}</span>,
            <div>
              <b className="mono">{item.username}</b>
              <small className="cell-sub">{item.role}</small>
            </div>,
            <Badge variant={variantFor(item.action)}>{item.action}</Badge>,
            <span className="audit-detail">{item.detail}</span>,
            <span className="mono cell-sub">{item.ip_address || '-'}</span>,
          ])}
        />
      </Card>
    </div>
  );
}
