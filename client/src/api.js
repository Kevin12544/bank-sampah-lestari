const DEFAULT_API = 'https://bank-sampah-lestari.vercel.app/api';

function resolveApiUrl() {
  const envUrl = (import.meta.env.VITE_API_URL || '').trim();
  // Abaikan URL placeholder tak valid agar aplikasi tidak rusak
  if (!envUrl || /[<>]/.test(envUrl)) {
    return DEFAULT_API;
  }
  return envUrl.replace(/\/$/, '');
}

export const API_BASE = resolveApiUrl();

export async function apiRequest(path, { token = '', onUnauthorized, timeoutMs = 20000, ...opts } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(API_BASE + path, {
      ...opts,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(opts.headers || {}),
      },
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Permintaan melebihi batas waktu. Periksa koneksi internet Anda lalu coba lagi.');
    }
    console.error('API connection error:', error);
    throw new Error(
      'Tidak dapat terhubung ke server. Periksa koneksi internet atau status backend.'
    );
  } finally {
    clearTimeout(timer);
  }

  let result = null;
  try {
    const text = await response.text();
    result = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Server memberikan respons yang tidak valid. Periksa log backend.');
  }

  if (!response.ok) {
    if (response.status === 401 && path !== '/login' && typeof onUnauthorized === 'function') {
      onUnauthorized();
    }
    throw new Error(
      result?.error || `Permintaan gagal (kode ${response.status}).`
    );
  }

  return result;
}
