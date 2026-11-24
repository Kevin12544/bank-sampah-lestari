import React, { useState } from 'react';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  Info,
  CheckCheck,
} from 'lucide-react';
import { Badge, Card, Heading } from '../components/UI.jsx';
import { fmtDateTime } from '../utils/format.js';

export default function NotificationsPage({ data, api, notify, reload }) {
  const [marking, setMarking] = useState(false);
  const rows = data.rows || [];
  const unread = Number(data.unreadCount || 0);

  async function markAllRead() {
    if (marking || unread === 0) return;
    setMarking(true);
    try {
      await api('/notifications/read-all', { method: 'POST' });
      notify('Semua notifikasi ditandai telah dibaca.', 'info');
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setMarking(false);
    }
  }

  const iconFor = (type) => {
    if (type === 'success') return <CheckCircle2 size={19} />;
    if (type === 'warning') return <AlertTriangle size={19} />;
    return <Info size={19} />;
  };

  const labelFor = (type) => {
    if (type === 'success') return <Badge variant="green">Transaksi</Badge>;
    if (type === 'warning') return <Badge variant="orange">Perhatian</Badge>;
    return <Badge variant="blue">Informasi</Badge>;
  };

  return (
    <div className="page-enter">
      <Heading
        title="Notifikasi"
        desc="Informasi terbaru terkait aktivitas dan transaksi sesuai hak akses akun Anda."
        action={
          unread > 0 && (
            <button
              type="button"
              className="secondary-btn"
              disabled={marking}
              onClick={markAllRead}
            >
              <CheckCheck size={16} />
              {marking ? 'Menandai...' : `Tandai Semua Dibaca (${unread})`}
            </button>
          )
        }
      />

      <div className="notification-list">
        {rows.map((item, idx) => (
          <Card
            className={`notification stagger-item ${item.is_read ? 'read' : 'unread'}`}
            key={item.id}
            style={{ animationDelay: `${Math.min(idx, 10) * 35}ms` }}
          >
            <div className={`notice-icon notice-${item.type || 'info'}`}>
              {iconFor(item.type)}
            </div>

            <div>
              <b>{item.message}</b>
              <small>{fmtDateTime(item.created_at)}</small>
            </div>

            {labelFor(item.type)}
          </Card>
        ))}
      </div>

      {!rows.length && (
        <Card>
          <div className="empty-block">
            <Bell size={28} />
            <p className="empty">Belum ada notifikasi untuk akun Anda.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
