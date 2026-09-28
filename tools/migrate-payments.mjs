// Aplica, em ordem, as migrations SQL pendentes de migrations/. Idempotente: registra cada arquivo
// aplicado em schema_migrations e nunca apaga dados.
// Uso: npm run db:migrate   (lê DATABASE_URL ou DB_* do ambiente ou do .env)
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadEnvFile, dbOptions } from '../backend/config.mjs';

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const FORBIDDEN = /\b(DROP|TRUNCATE)\b/i;

export async function migrate(db, log = console.log) {
  const conn = await mysql.createConnection({ ...(typeof db === 'string' ? { uri: db } : db), multipleStatements: true, timezone: 'Z' });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(191) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [rows] = await conn.query('SELECT name, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    const files = readdirSync(DIR).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
    let count = 0;
    for (const f of files) {
      const sql = readFileSync(DIR + f, 'utf8');
      const sum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(f)) {
        if (applied.get(f) !== sum) log(`[migrate] AVISO: ${f} foi alterado depois de aplicado (não reaplicado).`);
        continue;
      }
      if (FORBIDDEN.test(sql.replace(/--.*$/gm, ''))) throw new Error(`${f} contém DROP/TRUNCATE: recusado`);
      log(`[migrate] aplicando ${f}`);
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [f, sum]);
      count++;
    }
    log(count ? `[migrate] ${count} migration(s) aplicada(s).` : '[migrate] nada pendente.');
  } finally {
    await conn.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadEnvFile();
  const db = dbOptions();
  if (!db) {
    console.error('Banco não configurado: defina DATABASE_URL ou DB_HOST/DB_NAME/DB_USER (.env ou ambiente).');
    process.exit(1);
  }
  migrate(db).catch((e) => {
    console.error('[migrate] falhou:', e.code || '', e.message);
    process.exit(1);
  });
}
