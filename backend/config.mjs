// Configuração privada do backend (somente servidor). Lê process.env e valida o formato.
// Nada aqui pode ser importado pelo frontend.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Carrega .env da raiz, se existir, sem sobrescrever variáveis já definidas no ambiente.
export function loadEnvFile(path = resolve('.env')) {
  if (existsSync(path) && typeof process.loadEnvFile === 'function') process.loadEnvFile(path);
}

export class ConfigError extends Error {
  constructor(missing) {
    super(`Configuração pendente: ${missing.join(', ')}`);
    this.name = 'ConfigError';
    this.missing = missing;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function int(v, def, min, max) {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Valor inteiro inválido: ${v}`);
  return n;
}

// ACCESS_POLICY: "lifetime" ou "days:N". Sem valor = política pendente: nenhum acesso é concedido.
function parsePolicy(v) {
  if (!v) return null;
  if (v === 'lifetime') return { kind: 'lifetime' };
  const m = /^days:(\d{1,4})$/.exec(v);
  if (m && Number(m[1]) > 0) return { kind: 'days', days: Number(m[1]) };
  throw new Error('ACCESS_POLICY deve ser "lifetime" ou "days:N"');
}

// Conexão: DATABASE_URL ou as variáveis já usadas no projeto (DB_HOST, DB_PORT, DB_NAME, DB_USER,
// DB_PASSWORD, DB_SSL). Devolve opções do mysql2 ou null.
export function dbOptions(env = process.env) {
  if (env.DATABASE_URL) return { uri: env.DATABASE_URL };
  if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER) return null;
  const ssl = /^(1|true|required)$/i.test(env.DB_SSL || '');
  return {
    host: env.DB_HOST,
    port: int(env.DB_PORT, 3306, 1, 65535),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD || '',
    // TLS ativo; o certificado do servidor não é verificado (decisão do proprietário: sem arquivo CA)
    ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

export function readConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const siteUrl = (env.PUBLIC_SITE_URL || '').replace(/\/+$/, '');
  if (siteUrl && !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(siteUrl)) throw new Error('PUBLIC_SITE_URL deve ser só esquema + domínio');
  if (production && siteUrl && !siteUrl.startsWith('https://')) throw new Error('PUBLIC_SITE_URL precisa ser https em produção');

  const insecureCookies = env.ACCESS_INSECURE_COOKIES === '1';
  if (insecureCookies && production) throw new Error('ACCESS_INSECURE_COOKIES não pode ser usado em produção');

  const origins = new Set();
  if (siteUrl) origins.add(siteUrl);
  if (!production) {
    for (const p of [5173, 4173, Number(env.PORT) || 3000]) {
      origins.add(`http://localhost:${p}`);
      origins.add(`http://127.0.0.1:${p}`);
    }
  }

  const authMode = env.CAKTO_WEBHOOK_AUTH || 'signature';
  if (!['signature', 'secret_field'].includes(authMode)) throw new Error('CAKTO_WEBHOOK_AUTH deve ser "signature" ou "secret_field"');

  const botUsername = env.TELEGRAM_BOT_USERNAME || '';
  if (botUsername && !/^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(botUsername)) throw new Error('TELEGRAM_BOT_USERNAME inválido (sem @)');
  const groupId = env.TELEGRAM_GROUP_ID || '';
  if (groupId && !/^-\d{5,20}$/.test(groupId)) throw new Error('TELEGRAM_GROUP_ID deve ser o ID numérico negativo do grupo');

  const productId = env.CAKTO_PRODUCT_ID || '';
  if (productId && !UUID.test(productId) && !/^[A-Za-z0-9_-]{3,64}$/.test(productId)) throw new Error('CAKTO_PRODUCT_ID inválido');
  const offerId = env.CAKTO_OFFER_ID || '';
  if (offerId && !/^[A-Za-z0-9_-]{3,64}$/.test(offerId)) throw new Error('CAKTO_OFFER_ID inválido');

  const cfg = {
    production,
    siteUrl,
    origins,
    port: int(env.PORT, 3000, 1, 65535),
    trustProxyHops: int(env.TRUST_PROXY_HOPS, 0, 0, 5),
    cookie: { secure: !insecureCookies, name: insecureCookies ? 'bruno_access' : '__Host-bruno_access' },
    db: dbOptions(env),
    // Relação explícita: produto interno -> Cakto -> grupo -> política
    product: {
      key: 'cpa-chines',
      caktoProductId: productId,
      caktoOfferId: offerId, // opcional: restringe a uma oferta do produto
      telegramGroupId: groupId,
      policy: parsePolicy(env.ACCESS_POLICY),
    },
    cakto: {
      webhookSecret: env.CAKTO_WEBHOOK_SECRET || '',
      webhookAuth: authMode,
      clientId: env.CAKTO_CLIENT_ID || '',
      clientSecret: env.CAKTO_CLIENT_SECRET || '',
      toleranceSec: 300,
    },
    telegram: {
      botToken: env.TELEGRAM_BOT_TOKEN || '',
      botUsername,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || '',
    },
    smtp: {
      host: env.SMTP_HOST || '',
      port: int(env.SMTP_PORT, 587, 1, 65535),
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.EMAIL_FROM || '',
    },
    otpSecret: env.OTP_HASH_SECRET || '',
    limits: {
      perEmailHour: int(env.ACCESS_LIMIT_EMAIL_HOUR, 5, 1, 1000),
      perIpHour: int(env.ACCESS_LIMIT_IP_HOUR, 20, 1, 10000),
    },
  };
  return cfg;
}

// Lista o que falta para cada parte (sem expor valores).
export function missingFor(cfg, part) {
  const m = [];
  const need = (ok, name) => ok || m.push(name);
  if (part === 'db' || part === 'api' || part === 'worker') need(cfg.db, 'DATABASE_URL ou DB_HOST/DB_NAME/DB_USER');
  if (part === 'api' || part === 'worker') {
    need(cfg.otpSecret.length >= 32, 'OTP_HASH_SECRET (>= 32 caracteres)');
  }
  if (part === 'cakto-webhook') {
    need(cfg.cakto.webhookSecret, 'CAKTO_WEBHOOK_SECRET');
    need(cfg.product.caktoProductId, 'CAKTO_PRODUCT_ID');
  }
  if (part === 'cakto-api') {
    need(cfg.cakto.clientId, 'CAKTO_CLIENT_ID');
    need(cfg.cakto.clientSecret, 'CAKTO_CLIENT_SECRET');
  }
  if (part === 'telegram') {
    need(cfg.telegram.botToken, 'TELEGRAM_BOT_TOKEN');
    need(cfg.telegram.botUsername, 'TELEGRAM_BOT_USERNAME');
    need(cfg.product.telegramGroupId, 'TELEGRAM_GROUP_ID');
  }
  if (part === 'telegram-webhook') need(cfg.telegram.webhookSecret.length >= 16, 'TELEGRAM_WEBHOOK_SECRET');
  if (part === 'smtp') {
    need(cfg.smtp.host, 'SMTP_HOST');
    need(cfg.smtp.from, 'EMAIL_FROM');
  }
  if (part === 'site') need(cfg.siteUrl, 'PUBLIC_SITE_URL');
  if (part === 'policy') need(cfg.product.policy, 'ACCESS_POLICY');
  return m;
}

export function requireConfig(cfg, ...parts) {
  const m = parts.flatMap((p) => missingFor(cfg, p));
  if (m.length) throw new ConfigError(m);
}
