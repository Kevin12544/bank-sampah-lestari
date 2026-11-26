import { formatRupiah, num, round2, round3 } from "./validators.js";

export const MONTH_NAMES_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember"
];

export const POTONGAN_KAS_PERSEN = 10;
export const DEFAULT_MIN_PENARIKAN = 50000;
export const PENJUALAN_SIKLUS_HARI = 14;

/**
 * H3: Hitung pembagian hasil setoran (10% Kas Operasional : 90% Nasabah)
 */
export function computeSetoranSplit(berat, harga, persenPotongan = POTONGAN_KAS_PERSEN) {
  const b = round3(berat);
  const h = round2(harga);
  const p = round2(persenPotongan);
  const nilai_kotor = round2(b * h);
  const potongan_kas = round2(nilai_kotor * (p / 100));
  const nilai_nasabah = round2(nilai_kotor - potongan_kas);

  return {
    berat: b,
    harga: h,
    nilai_kotor,
    persen_potongan: p,
    potongan_kas,
    nilai_nasabah
  };
}

/**
 * H2: Validasi aturan penarikan saldo
 * - Minimal Rp50.000 (Januari–November)
 * - Maksimal 1 kali per bulan per nasabah
 * - Pengecualian Desember (month === 12): boleh tarik seluruh saldo walau < Rp50.000
 */
export function validatePenarikanRules({
  amount,
  saldo,
  transactionDate,
  minPenarikan = DEFAULT_MIN_PENARIKAN,
  alreadyWithdrawnThisMonth = 0
}) {
  const amt = round2(amount);
  const bal = round2(saldo);
  const minVal = Math.max(0, round2(minPenarikan));

  const [yStr, mStr] = String(transactionDate || "").split("-");
  const txYear = Number(yStr);
  const txMonth = Number(mStr);
  const isDesember = txMonth === 12;
  const monthLabel = MONTH_NAMES_ID[txMonth - 1] || `Bulan ${txMonth}`;

  if (Number(alreadyWithdrawnThisMonth) >= 1) {
    return {
      ok: false,
      error: `Nasabah sudah melakukan penarikan pada bulan ${monthLabel} ${txYear}. Penarikan dibatasi maksimal 1 kali per bulan.`
    };
  }

  if (bal <= 0) {
    return {
      ok: false,
      error: "Saldo nasabah saat ini Rp 0 dan tidak dapat ditarik."
    };
  }

  if (amt > bal + 0.001) {
    return {
      ok: false,
      error: `Saldo nasabah tidak mencukupi. Saldo tersedia: Rp ${formatRupiah(bal)}.`
    };
  }

  if (!isDesember) {
    if (minVal > 0 && bal < minVal) {
      return {
        ok: false,
        error: `Saldo nasabah (Rp ${formatRupiah(bal)}) belum mencapai batas minimum penarikan Rp ${formatRupiah(minVal)}. Pengecualian tarik seluruh saldo hanya berlaku di bulan Desember.`
      };
    }

    if (minVal > 0 && amt < minVal) {
      return {
        ok: false,
        error: `Nominal penarikan minimal Rp ${formatRupiah(minVal)}. Pengecualian penarikan di bawah minimum hanya berlaku di bulan Desember untuk penarikan seluruh saldo.`
      };
    }
  } else {
    // Bulan Desember: boleh tarik seluruh saldo walau < minPenarikan
    if (minVal > 0 && amt < minVal && Math.abs(amt - bal) > 0.01) {
      return {
        ok: false,
        error: `Khusus bulan Desember, penarikan di bawah Rp ${formatRupiah(minVal)} hanya diperbolehkan untuk menarik seluruh saldo (Rp ${formatRupiah(bal)}).`
      };
    }
  }

  return {
    ok: true,
    isDesember,
    isFullDecemberWithdraw: isDesember && Math.abs(amt - bal) <= 0.01
  };
}

/**
 * H4: Hitung detail item penjualan multi-jenis + pencatatan susut
 */
export function computePenjualanItem({ berat_gudang, berat_jual, harga_jual }) {
  const bg = round3(berat_gudang);
  const bj = round3(berat_jual);
  const hj = round2(harga_jual);

  if (bg <= 0 || bj <= 0 || hj <= 0) {
    return {
      ok: false,
      error: "Berat gudang, berat timbangan pengepul, dan harga jual harus lebih dari 0."
    };
  }

  if (bg > 100_000 || bj > 100_000 || hj > 100_000_000) {
    return {
      ok: false,
      error: "Nilai berat atau harga jual melebihi batas wajar."
    };
  }

  if (bj > bg + 0.0005) {
    return {
      ok: false,
      error: `Berat timbangan pengepul (${bj} kg) tidak boleh melebihi berat yang dikeluarkan dari gudang (${bg} kg).`
    };
  }

  const berat_susut = round3(Math.max(0, bg - bj));
  const subtotal = round2(bj * hj);

  return {
    ok: true,
    berat_gudang: bg,
    berat_jual: bj,
    berat_susut,
    harga_jual: hj,
    subtotal
  };
}

function parseIsoUtcMs(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatUtcIso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * H4: Hitung status siklus penjualan 2 mingguan (14 hari)
 */
export function computePenjualanSchedule(
  lastSaleDateIso,
  referenceDateIso,
  intervalDays = PENJUALAN_SIKLUS_HARI
) {
  const refMs = parseIsoUtcMs(referenceDateIso);
  const lastMs = parseIsoUtcMs(lastSaleDateIso);

  if (!lastMs || !refMs) {
    return {
      intervalDays,
      lastSaleDate: null,
      nextScheduleDate: referenceDateIso || null,
      daysSinceLast: null,
      daysRemaining: 0,
      isDue: true
    };
  }

  const dayMs = 86_400_000;
  const daysSinceLast = Math.floor((refMs - lastMs) / dayMs);
  const nextMs = lastMs + intervalDays * dayMs;
  const daysRemaining = Math.max(0, intervalDays - daysSinceLast);

  return {
    intervalDays,
    lastSaleDate: lastSaleDateIso,
    nextScheduleDate: formatUtcIso(nextMs),
    daysSinceLast,
    daysRemaining,
    isDue: daysSinceLast >= intervalDays
  };
}

export function extractYearMonth(isoDate) {
  const [y, m] = String(isoDate || "").split("-").map(Number);
  return { year: num(y), month: num(m) };
}
