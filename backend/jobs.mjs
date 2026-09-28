// Fila durável no próprio MySQL: tarefas com tentativas, próxima execução, lease e recuperação.
// Tarefas "running" com lease vencido (processo reiniciado no meio) voltam a ser elegíveis.
import { randomBytes } from 'node:crypto';

export const LEASE_MS = 60_000;

// Erro transitório: a tarefa volta para a fila (opcionalmente com espera sugerida).
export class RetryableError extends Error {
  constructor(message, retryAfterSec) {
    super(message);
    this.name = 'RetryableError';
    this.retryAfterSec = retryAfterSec;
  }
}

// Erro definitivo: não adianta repetir (ex.: dados inválidos).
export class PermanentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentError';
  }
}

// Remove qualquer coisa parecida com token/segredo antes de gravar a mensagem de erro.
export function sanitizeError(err) {
  const msg = String((err && (err.message || err.code)) || err || 'erro')
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, 'bot<token>')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <token>')
    .replace(/(password|pass|secret|token)=([^&\s]+)/gi, '$1=<redacted>');
  return msg.slice(0, 480);
}

// Enfileira dentro da transação do chamador. Com dedupeKey, repetir é inofensivo.
export async function enqueue(conn, type, payload, { dedupeKey = null, runAt = new Date(), maxAttempts = 12 } = {}) {
  const [r] = await conn.query(
    `INSERT INTO jobs (type, payload, dedupe_key, run_at, max_attempts) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [type, JSON.stringify(payload), dedupeKey, runAt, maxAttempts]
  );
  return r.insertId || null;
}

// Reabre tarefa que falhou definitivamente (reprocessamento controlado).
export async function requeueFailed(conn, { id, dedupeKey } = {}) {
  const [r] = await conn.query(
    `UPDATE jobs SET status = 'pending', attempts = 0, run_at = ?, locked_until = NULL, last_error = NULL
     WHERE status = 'failed' AND ${id ? 'id = ?' : 'dedupe_key = ?'}`,
    [new Date(), id || dedupeKey]
  );
  return r.affectedRows;
}

// Reserva uma tarefa vencida com SKIP LOCKED (vários workers não pegam a mesma).
export async function claimJob(pool, workerId, now = new Date()) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT id FROM jobs
       WHERE (status = 'pending' AND run_at <= ?) OR (status = 'running' AND locked_until < ?)
       ORDER BY run_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
      [now, now]
    );
    if (!rows.length) {
      await conn.commit();
      return null;
    }
    const id = rows[0].id;
    await conn.query(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_by = ?, locked_until = ? WHERE id = ?`,
      [workerId, new Date(now.getTime() + LEASE_MS), id]
    );
    const [[job]] = await conn.query('SELECT * FROM jobs WHERE id = ?', [id]);
    await conn.commit();
    job.payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : job.payload;
    return job;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

function backoffMs(attempt) {
  // 15s, 30s, 1min, 2min ... até 1h
  return Math.min(3_600_000, 15_000 * 2 ** Math.max(0, attempt - 1));
}

export async function finishJob(pool, job, workerId) {
  await pool.query(`UPDATE jobs SET status = 'done', locked_until = NULL, last_error = NULL WHERE id = ? AND locked_by = ?`, [
    job.id,
    workerId,
  ]);
}

export async function failJob(pool, job, workerId, err, now = new Date()) {
  const permanent = err instanceof PermanentError;
  const exhausted = job.attempts >= job.max_attempts;
  const delay = err && err.retryAfterSec ? err.retryAfterSec * 1000 + 1000 : backoffMs(job.attempts);
  await pool.query(
    `UPDATE jobs SET status = ?, run_at = ?, locked_until = NULL, last_error = ? WHERE id = ? AND locked_by = ?`,
    [permanent || exhausted ? 'failed' : 'pending', new Date(now.getTime() + delay), sanitizeError(err), job.id, workerId]
  );
  return permanent || exhausted ? 'failed' : 'retry';
}

// Executa no máximo uma tarefa. Retorna false quando a fila está vazia.
export async function runOne(pool, handlers, { workerId = `w-${randomBytes(4).toString('hex')}`, log = () => {}, now } = {}) {
  const job = await claimJob(pool, workerId, now ? now() : new Date());
  if (!job) return false;
  const handler = handlers[job.type];
  try {
    if (!handler) throw new PermanentError(`tipo de tarefa desconhecido: ${job.type}`);
    await handler(job.payload, job);
    await finishJob(pool, job, workerId);
    log(`[job ${job.id}] ${job.type} ok`);
  } catch (err) {
    const outcome = await failJob(pool, job, workerId, err, now ? now() : new Date());
    log(`[job ${job.id}] ${job.type} ${outcome}: ${sanitizeError(err)}`);
  }
  return true;
}
