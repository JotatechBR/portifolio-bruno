// Verificação do comprador por código enviado ao e-mail + sessão curta em cookie HttpOnly.
// O código nunca é gravado legível: é derivado por HMAC do ID do desafio (só o servidor, com
// OTP_HASH_SECRET, consegue recalculá-lo) e no banco fica apenas um HMAC de verificação.
import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { enqueue } from './jobs.mjs';
import { hasKnownOrder } from './repositories.mjs';

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_MS = 60_000;
export const SESSION_TTL_MS = 30 * 60_000;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// 8 dígitos a partir de 64 bits de HMAC (viés desprezível: 2^64 / 10^8).
export function deriveCode(secret, challengeId) {
  const h = createHmac('sha256', secret).update(`code:${challengeId}`).digest();
  return (h.readBigUInt64BE(0) % 100_000_000n).toString().padStart(8, '0');
}

function codeHash(secret, challengeId, code) {
  return createHmac('sha256', secret).update(`check:${challengeId}:${code}`).digest('hex');
}

// Limite por janela de 1h em tabela compartilhada (vale para vários processos).
export async function hit(conn, bucket, limit, now = new Date()) {
  const windowStart = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  await conn.query(
    `INSERT INTO rate_limits (bucket, window_start, hits) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE hits = hits + 1`,
    [bucket, windowStart]
  );
  const [[row]] = await conn.query('SELECT hits FROM rate_limits WHERE bucket = ? AND window_start = ?', [bucket, windowStart]);
  return row.hits <= limit;
}

// Inicia a verificação. Resposta sempre igual, exista ou não compra para o e-mail.
// Retorna { challengeId } ou { error: 'rate_limited' | 'resend_wait' }.
export async function requestCode(conn, { cfg, email, ip, now = new Date() }) {
  const okIp = await hit(conn, `ip:${ip}`, cfg.limits.perIpHour, now);
  const okEmail = await hit(conn, `email:${sha256(email)}`, cfg.limits.perEmailHour, now);
  if (!okIp || !okEmail) return { error: 'rate_limited' };

  const [[last]] = await conn.query(
    'SELECT created_at FROM email_challenges WHERE email = ? ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
    [email]
  );
  if (last && now.getTime() - new Date(last.created_at).getTime() < RESEND_MS) return { error: 'resend_wait' };

  // novo desafio invalida os anteriores
  await conn.query(
    'UPDATE email_challenges SET superseded_at = ? WHERE email = ? AND consumed_at IS NULL AND superseded_at IS NULL',
    [now, email]
  );
  const challengeId = randomBytes(16).toString('hex');
  const deliverable = await hasKnownOrder(conn, email);
  const code = deriveCode(cfg.otpSecret, challengeId);
  await conn.query(
    `INSERT INTO email_challenges (id, email, code_hash, deliverable, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [challengeId, email, codeHash(cfg.otpSecret, challengeId, code), deliverable ? 1 : 0, new Date(now.getTime() + CODE_TTL_MS), now]
  );
  // só envia para e-mail com compra conhecida; a tarefa guarda apenas o ID do desafio
  if (deliverable) await enqueue(conn, 'email.code', { challengeId }, { dedupeKey: `code:${challengeId}`, maxAttempts: 4 });
  return { challengeId };
}

// Confere o código. Retorna { email } ou { error: 'invalid_challenge' | 'expired' | 'locked' | 'invalid_code' }.
export async function verifyCode(conn, { cfg, challengeId, code, now = new Date() }) {
  if (!/^[0-9a-f]{32}$/.test(challengeId)) return { error: 'invalid_challenge' };
  const [[ch]] = await conn.query('SELECT * FROM email_challenges WHERE id = ? FOR UPDATE', [challengeId]);
  if (!ch || ch.consumed_at || ch.superseded_at) return { error: 'invalid_challenge' };
  if (new Date(ch.expires_at) <= now) return { error: 'expired' };
  if (ch.attempts >= MAX_ATTEMPTS) return { error: 'locked' };
  await conn.query('UPDATE email_challenges SET attempts = attempts + 1 WHERE id = ?', [challengeId]);
  const clean = String(code).replace(/\D/g, '');
  const expected = Buffer.from(ch.code_hash, 'hex');
  const given = Buffer.from(codeHash(cfg.otpSecret, challengeId, clean), 'hex');
  // sem compra conhecida nenhum código foi enviado: nunca aceita
  if (!ch.deliverable || clean.length !== 8 || !timingSafeEqual(expected, given)) {
    return { error: ch.attempts + 1 >= MAX_ATTEMPTS ? 'locked' : 'invalid_code' };
  }
  await conn.query('UPDATE email_challenges SET consumed_at = ? WHERE id = ?', [now, challengeId]);
  return { email: ch.email };
}

export async function createSession(conn, email, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  await conn.query('INSERT INTO access_sessions (id_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)', [
    sha256(token),
    email,
    new Date(now.getTime() + SESSION_TTL_MS),
    now,
  ]);
  return token;
}

export async function getSession(conn, token, now = new Date()) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [[s]] = await conn.query('SELECT * FROM access_sessions WHERE id_hash = ?', [sha256(token)]);
  if (!s || s.revoked_at || new Date(s.expires_at) <= now) return null;
  return { email: s.email, expiresAt: new Date(s.expires_at) };
}

export async function revokeSession(conn, token, now = new Date()) {
  if (!token) return;
  await conn.query('UPDATE access_sessions SET revoked_at = ? WHERE id_hash = ?', [now, sha256(token)]);
}

// Tarefa de envio: recalcula o código a partir do ID (nada legível no banco).
export async function sendChallengeEmail(pool, cfg, mailer, challengeId, now = new Date()) {
  const [[ch]] = await pool.query('SELECT * FROM email_challenges WHERE id = ?', [challengeId]);
  if (!ch || !ch.deliverable || ch.consumed_at || ch.superseded_at || new Date(ch.expires_at) <= now) return 'skipped';
  await mailer.sendCode(ch.email, deriveCode(cfg.otpSecret, challengeId));
  return 'sent';
}
