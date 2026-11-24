import bcrypt from "bcryptjs";
import { getClientIp } from "./validators.js";

// Dummy hash used to mitigate username timing enumeration on failed logins
const DUMMY_BCRYPT_HASH =
  "$2a$12$C6UzMDM.H6dfI/f/IKcEeO9u6M6J1S8jJ1yX2X0m5pW5tN6u3oQ4K";

export async function safeBcryptCompare(password, hash) {
  const target = hash || DUMMY_BCRYPT_HASH;
  const matched = await bcrypt.compare(password, target);
  return Boolean(hash && matched);
}

export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }

  next();
}

export function noStoreApi(_req, res, next) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  next();
}

export function createRateLimiter({
  windowMs = 60_000,
  max = 120,
  message = "Terlalu banyak permintaan. Coba lagi sebentar lagi."
} = {}) {
  const buckets = new Map();
  let lastSweep = Date.now();

  return (req, res, next) => {
    const now = Date.now();
    const key = getClientIp(req);

    // Periodic sweep to keep memory bounded
    if (now - lastSweep > windowMs) {
      for (const [entryKey, entry] of buckets.entries()) {
        if (entry.resetAt <= now) {
          buckets.delete(entryKey);
        }
      }
      lastSweep = now;
    }

    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      buckets.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({ error: message });
    }

    next();
  };
}

const USER_LOCKOUT_MAX = 5;
const IP_LOCKOUT_MAX = 20;
const LOCKOUT_MINUTES = 15;

export async function checkLoginLockout(pool, username, ip) {
  const keys = [
    `user:${username.toLowerCase()}`,
    `ip:${ip}`
  ];

  const { rows } = await pool.query(
    `SELECT key, attempts, locked_until
     FROM login_attempts
     WHERE key = ANY($1::text[])
       AND locked_until IS NOT NULL
       AND locked_until > NOW()`,
    [keys]
  );

  if (!rows.length) return { locked: false };

  const latestUntil = rows.reduce((maxDate, row) => {
    const d = new Date(row.locked_until);
    return d > maxDate ? d : maxDate;
  }, new Date(0));

  const remainingMin = Math.max(
    1,
    Math.ceil((latestUntil.getTime() - Date.now()) / 60_000)
  );

  return {
    locked: true,
    remainingMin,
    lockedUntil: latestUntil.toISOString()
  };
}

export async function recordFailedLogin(pool, username, ip) {
  const entries = [
    { key: `user:${username.toLowerCase()}`, limit: USER_LOCKOUT_MAX },
    { key: `ip:${ip}`, limit: IP_LOCKOUT_MAX }
  ];

  for (const item of entries) {
    await pool.query(
      `INSERT INTO login_attempts(key, attempts, locked_until, updated_at)
       VALUES($1, 1, NULL, NOW())
       ON CONFLICT(key) DO UPDATE SET
         attempts = CASE
           WHEN login_attempts.updated_at < NOW() - INTERVAL '30 minutes'
             THEN 1
           ELSE login_attempts.attempts + 1
         END,
         locked_until = CASE
           WHEN (
             CASE
               WHEN login_attempts.updated_at < NOW() - INTERVAL '30 minutes'
                 THEN 1
               ELSE login_attempts.attempts + 1
             END
           ) >= $2
             THEN NOW() + ($3 || ' minutes')::interval
           ELSE NULL
         END,
         updated_at = NOW()`,
      [item.key, item.limit, String(LOCKOUT_MINUTES)]
    );
  }
}

export async function clearFailedLogin(pool, username) {
  await pool.query(
    `DELETE FROM login_attempts WHERE key = $1`,
    [`user:${username.toLowerCase()}`]
  );
}

export async function recordAudit(
  db,
  { req = null, user = null, action, entity, entityId = "", detail = "" }
) {
  try {
    const actor = user || req?.user || null;
    const ip = req ? getClientIp(req) : "";

    await db.query(
      `INSERT INTO audit_logs
       (id_user, username, role, action, entity, entity_id, detail, ip_address)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        actor?.id || actor?.id_user || null,
        actor?.username || "anonymous",
        actor?.role || "anonymous",
        String(action || "UNKNOWN").slice(0, 64),
        String(entity || "system").slice(0, 64),
        String(entityId ?? "").slice(0, 64),
        String(detail || "").slice(0, 500),
        ip
      ]
    );
  } catch (error) {
    // Audit failure must never break the main transaction, just log it
    console.error("Failed to record audit log:", error);
  }
}
