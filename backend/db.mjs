// Pool MySQL (mysql2) e transações. Datas sempre em UTC; IDs grandes (Telegram) como string.
import mysql from 'mysql2/promise';

// db: string (URL) ou opções do mysql2 (ver dbOptions em config.mjs)
export function createPool(db, extra = {}) {
  return mysql.createPool({
    ...(typeof db === 'string' ? { uri: db } : db),
    connectionLimit: 10,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    dateStrings: false,
    ...extra,
  });
}

// Executa fn(conn) numa transação; desfaz em qualquer erro.
export async function withTransaction(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* conexão já perdida */
    }
    throw err;
  } finally {
    conn.release();
  }
}

export const isDuplicate = (err) => err && err.code === 'ER_DUP_ENTRY';
