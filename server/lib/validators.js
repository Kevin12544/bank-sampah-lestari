export const ROLES = ["Ketua", "Bendahara", "Petugas Timbang", "Nasabah"];

export const num = value => {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
};

export const round2 = value =>
  Math.round((num(value) + Number.EPSILON) * 100) / 100;

export const round3 = value =>
  Math.round((num(value) + Number.EPSILON) * 1000) / 1000;

export const validNumber = value =>
  value !== null &&
  value !== undefined &&
  value !== "" &&
  typeof value !== "boolean" &&
  Number.isFinite(Number(value));

export const parsePositiveInt = value => {
  if (value === null || value === undefined || value === "") return null;
  const str = String(value).trim();
  if (!/^\d+$/.test(str)) return null;
  const parsed = Number(str);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

export const cleanText = (value, maxLength = 255) => {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);
};

export const validUsername = value =>
  typeof value === "string" && /^[a-zA-Z0-9._-]{3,32}$/.test(value.trim());

export const validPhone = value => {
  const cleaned = cleanText(value, 24);
  if (!cleaned) return true;
  return /^[0-9+\-\s()]{6,24}$/.test(cleaned);
};

export const validatePasswordStrength = password => {
  if (typeof password !== "string") {
    return "Password wajib berupa teks.";
  }
  if (password.length < 8) {
    return "Password minimal 8 karakter.";
  }
  if (password.length > 128) {
    return "Password maksimal 128 karakter.";
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password harus mengandung kombinasi huruf dan angka.";
  }
  return null;
};

export const witaNowParts = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Makassar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    iso: `${values.year}-${values.month}-${values.day}`
  };
};

export const today = () => witaNowParts().iso;

export const validDate = value => {
  if (!value) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d &&
    y >= 2000 &&
    y <= 2100
  );
};

export const formatRupiah = value => num(value).toLocaleString("id-ID");

export const getClientIp = req => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().slice(0, 64);
  }
  return String(req.ip || req.socket?.remoteAddress || "unknown").slice(0, 64);
};
