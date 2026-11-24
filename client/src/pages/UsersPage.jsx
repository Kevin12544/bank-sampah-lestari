import React, { useState } from 'react';
import {
  UserPlus,
  KeyRound,
  Edit3,
  ShieldCheck,
  ShieldOff,
  Search,
  RefreshCw,
} from 'lucide-react';
import {
  Badge,
  Card,
  DataTable,
  Heading,
  Modal,
} from '../components/UI.jsx';
import { fmtDateTime } from '../utils/format.js';

const ROLES = ['Ketua', 'Bendahara', 'Petugas Timbang', 'Nasabah'];

function generateStrongPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += letters[Math.floor(Math.random() * letters.length)];
  }
  for (let i = 0; i < 4; i++) {
    out += digits[Math.floor(Math.random() * digits.length)];
  }
  return out;
}

export default function UsersPage({ data, user, api, notify, reload }) {
  const users = data.users || [];
  const unlinkedNasabah = (data.nasabah || []).filter((n) => !n.id_user);

  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    username: '',
    nama_user: '',
    role: 'Petugas Timbang',
    password: '',
    id_nasabah: '',
  });
  const [saving, setSaving] = useState(false);

  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ nama_user: '', role: '', is_active: true });

  const [resetTarget, setResetTarget] = useState(null);
  const [resetPwd, setResetPwd] = useState('');

  const filtered = users.filter((u) =>
    `${u.username || ''} ${u.nama_user || ''} ${u.role || ''} ${u.no_buku || ''}`
      .toLowerCase()
      .includes(q.toLowerCase())
  );

  async function handleCreate(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const res = await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          username: createForm.username.trim().toLowerCase(),
          nama_user: createForm.nama_user.trim(),
          role: createForm.role,
          password: createForm.password,
          id_nasabah: createForm.role === 'Nasabah' && createForm.id_nasabah
            ? Number(createForm.id_nasabah)
            : null,
        }),
      });
      notify(res.message || 'Akun berhasil dibuat.', 'success');
      setCreateOpen(false);
      setCreateForm({
        username: '',
        nama_user: '',
        role: 'Petugas Timbang',
        password: '',
        id_nasabah: '',
      });
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleEdit(e) {
    e.preventDefault();
    if (!editTarget || saving) return;
    setSaving(true);
    try {
      const res = await api(`/users/${editTarget.id_user}`, {
        method: 'PUT',
        body: JSON.stringify(editForm),
      });
      notify(res.message || 'Akun diperbarui.', 'success');
      setEditTarget(null);
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleResetPassword(e) {
    e.preventDefault();
    if (!resetTarget || saving) return;
    setSaving(true);
    try {
      const res = await api(`/users/${resetTarget.id_user}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: resetPwd }),
      });
      notify(res.message || 'Kata sandi direset.', 'success');
      setResetTarget(null);
      setResetPwd('');
      await reload();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const roleBadge = (role) => {
    if (role === 'Ketua') return <Badge variant="purple">Ketua</Badge>;
    if (role === 'Bendahara') return <Badge variant="blue">Bendahara</Badge>;
    if (role === 'Petugas Timbang') return <Badge variant="orange">Petugas Timbang</Badge>;
    return <Badge variant="green">Nasabah</Badge>;
  };

  return (
    <div className="page-enter">
      <Heading
        title="Manajemen Pengguna"
        desc="Kelola akun pengurus dan nasabah, hak akses role, status aktif, serta reset kata sandi."
        action={
          <button
            type="button"
            className="primary"
            onClick={() => {
              setCreateForm({
                username: '',
                nama_user: '',
                role: 'Petugas Timbang',
                password: generateStrongPassword(),
                id_nasabah: '',
              });
              setCreateOpen(true);
            }}
          >
            <UserPlus size={16} /> Tambah Pengguna
          </button>
        }
      />

      <Card>
        <div className="table-toolbar">
          <h3>
            Daftar Akun <span className="count">{filtered.length}</span>
          </h3>
          <div className="search">
            <Search size={15} />
            <input
              placeholder="Cari username, nama, role..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <DataTable
          pageSize={15}
          headers={['Username', 'Nama', 'Role', 'Status', 'Login Terakhir', 'Aksi']}
          rows={filtered.map((item) => {
            const isSelf = Number(item.id_user) === Number(user?.id);
            return [
              <div>
                <b className="mono">{item.username}</b>
                {item.no_buku && (
                  <small className="cell-sub">Tautan: {item.no_buku}</small>
                )}
              </div>,
              <div>
                <b>{item.nama_user}</b>
                {isSelf && <small className="cell-sub">(Akun Anda)</small>}
              </div>,
              roleBadge(item.role),
              item.is_active ? (
                <Badge variant="green">
                  <ShieldCheck size={12} /> Aktif
                </Badge>
              ) : (
                <Badge variant="red">
                  <ShieldOff size={12} /> Nonaktif
                </Badge>
              ),
              item.last_login_at ? fmtDateTime(item.last_login_at) : 'Belum pernah',
              <div className="action-row">
                <button
                  type="button"
                  className="icon-action"
                  title="Ubah nama, role, atau status"
                  onClick={() => {
                    setEditTarget(item);
                    setEditForm({
                      nama_user: item.nama_user,
                      role: item.role,
                      is_active: Boolean(item.is_active),
                    });
                  }}
                >
                  <Edit3 size={14} />
                </button>
                <button
                  type="button"
                  className="icon-action"
                  title="Reset kata sandi"
                  onClick={() => {
                    setResetTarget(item);
                    setResetPwd(generateStrongPassword());
                  }}
                >
                  <KeyRound size={14} />
                </button>
              </div>,
            ];
          })}
        />
      </Card>

      <Modal
        open={createOpen}
        onClose={saving ? undefined : () => setCreateOpen(false)}
        title="Tambah Akun Pengguna"
        subtitle="Pengguna baru akan diminta memperbarui kata sandi setelah login."
        width={480}
      >
        <form className="stack-form" onSubmit={handleCreate}>
          <div className="form-grid">
            <label>
              Username *
              <input
                required
                minLength={3}
                maxLength={32}
                placeholder="huruf/angka/titik"
                value={createForm.username}
                onChange={(e) =>
                  setCreateForm({ ...createForm, username: e.target.value })
                }
              />
            </label>
            <label>
              Role *
              <select
                value={createForm.role}
                onChange={(e) =>
                  setCreateForm({ ...createForm, role: e.target.value })
                }
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Nama Lengkap *
            <input
              required
              maxLength={120}
              value={createForm.nama_user}
              onChange={(e) =>
                setCreateForm({ ...createForm, nama_user: e.target.value })
              }
            />
          </label>

          {createForm.role === 'Nasabah' && (
            <label>
              Tautkan ke Rekening Nasabah (opsional)
              <select
                value={createForm.id_nasabah}
                onChange={(e) =>
                  setCreateForm({ ...createForm, id_nasabah: e.target.value })
                }
              >
                <option value="">-- Pilih nasabah tanpa akun --</option>
                {unlinkedNasabah.map((n) => (
                  <option key={n.id_nasabah} value={n.id_nasabah}>
                    {n.nama} ({n.no_buku})
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Kata Sandi Sementara *
            <div className="input-with-icon">
              <input
                type="text"
                required
                minLength={8}
                value={createForm.password}
                onChange={(e) =>
                  setCreateForm({ ...createForm, password: e.target.value })
                }
              />
              <button
                type="button"
                className="eye-btn"
                title="Buat kata sandi acak"
                onClick={() =>
                  setCreateForm({
                    ...createForm,
                    password: generateStrongPassword(),
                  })
                }
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </label>

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setCreateOpen(false)}
              disabled={saving}
            >
              Batal
            </button>
            <button className="primary" disabled={saving}>
              {saving ? 'Membuat...' : 'Buat Akun'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(editTarget)}
        onClose={saving ? undefined : () => setEditTarget(null)}
        title={`Ubah Akun — ${editTarget?.username || ''}`}
        subtitle="Menonaktifkan akun atau mengganti role akan langsung mencabut sesi aktif."
        width={440}
      >
        <form className="stack-form" onSubmit={handleEdit}>
          <label>
            Nama Lengkap *
            <input
              required
              maxLength={120}
              value={editForm.nama_user}
              onChange={(e) =>
                setEditForm({ ...editForm, nama_user: e.target.value })
              }
            />
          </label>

          <label>
            Role *
            <select
              value={editForm.role}
              disabled={Number(editTarget?.id_user) === Number(user?.id)}
              onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={editForm.is_active}
              disabled={Number(editTarget?.id_user) === Number(user?.id)}
              onChange={(e) =>
                setEditForm({ ...editForm, is_active: e.target.checked })
              }
            />
            <span>
              <b>Akun Aktif</b>
              <small>Hilangkan centang untuk memblokir akses login akun ini.</small>
            </span>
          </label>

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setEditTarget(null)}
              disabled={saving}
            >
              Batal
            </button>
            <button className="primary" disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(resetTarget)}
        onClose={saving ? undefined : () => setResetTarget(null)}
        title={`Reset Kata Sandi — ${resetTarget?.username || ''}`}
        subtitle="Catat kata sandi baru ini dan serahkan secara aman kepada pengguna."
        width={440}
      >
        <form className="stack-form" onSubmit={handleResetPassword}>
          <label>
            Kata Sandi Baru *
            <div className="input-with-icon">
              <input
                type="text"
                required
                minLength={8}
                value={resetPwd}
                onChange={(e) => setResetPwd(e.target.value)}
              />
              <button
                type="button"
                className="eye-btn"
                title="Buat kata sandi acak"
                onClick={() => setResetPwd(generateStrongPassword())}
              >
                <RefreshCw size={15} />
              </button>
            </div>
          </label>

          <div className="modal-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setResetTarget(null)}
              disabled={saving}
            >
              Batal
            </button>
            <button className="primary" disabled={saving}>
              {saving ? 'Mereset...' : 'Terapkan Kata Sandi Baru'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
