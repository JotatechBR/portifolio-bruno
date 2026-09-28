// Roteador de /api. Todo ramo termina com uma resposta JSON; nunca cai no fallback da home.
import { readConfig, missingFor, ConfigError } from './config.mjs';
import { createPool, withTransaction } from './db.mjs';
import {
  HttpError,
  readBody,
  requireJsonType,
  parseJson,
  pickStrings,
  sendJson,
  getCookie,
  sessionCookie,
  clientIp,
  requireSameOrigin,
} from './http.mjs';
import { normalizeEmail, isEmail } from './cakto.mjs';
import { createCaktoWebhookHandler } from './cakto-webhook.mjs';
import { createTelegramWebhookHandler } from './telegram-webhook.mjs';
import { requestCode, verifyCode, createSession, getSession, revokeSession, SESSION_TTL_MS } from './verification.mjs';
import { ordersByEmail, getOrder, getEntitlement } from './repositories.mjs';
import { accessStateForOrder, entitlementActive } from './access.mjs';
import { issueLinkToken, botStartUrl } from './telegram.mjs';
import { createSocialProofHandler } from './social-proof.mjs';

export function createApiHandler({ cfg = readConfig(), pool, log = console } = {}) {
  let db = pool || null;
  const getPool = () => {
    const miss = missingFor(cfg, 'api');
    if (miss.length) throw new ConfigError(miss);
    if (!db) db = createPool(cfg.db);
    return db;
  };

  const needs = (...parts) => {
    const miss = parts.flatMap((p) => missingFor(cfg, p));
    if (miss.length) throw new ConfigError(miss);
  };

  async function readJson(req, fields) {
    requireJsonType(req);
    const body = parseJson(await readBody(req, 4 * 1024));
    return pickStrings(body, fields);
  }

  async function session(req) {
    const token = getCookie(req, cfg.cookie.name);
    const s = token ? await getSession(getPool(), token) : null;
    if (!s) throw new HttpError(401, 'unauthenticated');
    return { ...s, token };
  }

  // atividade pública: só compras aprovadas e confirmadas, anonimizadas (ver social-proof.mjs)
  const socialProof = createSocialProofHandler({ cfg, getPool: () => getPool(), log });

  const routes = {
    'GET /api/social-proof/recent': (req, res) => socialProof(req, res, sendJson),

    'POST /api/webhooks/cakto': async (req, res) => {
      needs('cakto-webhook');
      await createCaktoWebhookHandler({ cfg, pool: getPool(), log })(req, res);
    },

    'POST /api/webhooks/telegram': async (req, res) => {
      needs('telegram-webhook');
      await createTelegramWebhookHandler({ cfg, pool: getPool() })(req, res);
    },

    'POST /api/access/request-code': async (req, res) => {
      requireSameOrigin(req, cfg);
      const { email: raw } = await readJson(req, { email: 320 });
      const email = normalizeEmail(raw);
      if (!isEmail(email)) throw new HttpError(400, 'invalid_email');
      const ip = clientIp(req, cfg.trustProxyHops);
      const r = await withTransaction(getPool(), (conn) => requestCode(conn, { cfg, email, ip }));
      if (r.error) throw new HttpError(429, r.error);
      sendJson(res, 200, { ok: true, challenge_id: r.challengeId });
    },

    'POST /api/access/verify-code': async (req, res) => {
      requireSameOrigin(req, cfg);
      const { challenge_id: challengeId, code } = await readJson(req, { challenge_id: 64, code: 32 });
      const r = await withTransaction(getPool(), async (conn) => {
        const v = await verifyCode(conn, { cfg, challengeId, code });
        if (v.error) return v;
        return { token: await createSession(conn, v.email) };
      });
      if (r.error) throw new HttpError(r.error === 'invalid_code' ? 400 : 410, r.error);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(cfg, r.token, SESSION_TTL_MS / 1000) });
    },

    'GET /api/access/status': async (req, res) => {
      const s = await session(req);
      const pool = getPool();
      const orders = await ordersByEmail(pool, s.email);
      const accesses = [];
      for (const o of orders) {
        if (o.product_id !== cfg.product.caktoProductId) continue;
        accesses.push({ ref: String(o.id), product: o.product_name || 'Acesso', state: await accessStateForOrder(pool, o) });
      }
      sendJson(res, 200, {
        email: s.email,
        bot_url: cfg.telegram.botUsername ? `https://t.me/${cfg.telegram.botUsername}` : null,
        accesses,
      });
    },

    'POST /api/access/telegram-link': async (req, res) => {
      requireSameOrigin(req, cfg);
      const s = await session(req);
      needs('telegram');
      const { ref } = await readJson(req, { ref: 20 });
      if (!/^\d{1,19}$/.test(ref)) throw new HttpError(400, 'invalid_ref');
      const token = await withTransaction(getPool(), async (conn) => {
        const order = await getOrder(conn, ref, { lock: true });
        // a identidade vem da sessão: pedido de outro e-mail é tratado como inexistente
        if (!order || order.email !== s.email) throw new HttpError(404, 'not_found');
        const ent = await getEntitlement(conn, order.id);
        if (order.revoked_at || !entitlementActive(ent)) throw new HttpError(409, 'inactive');
        return issueLinkToken(conn, order.id);
      });
      sendJson(res, 200, { url: botStartUrl(cfg.telegram.botUsername, token) });
    },

    'POST /api/access/logout': async (req, res) => {
      requireSameOrigin(req, cfg);
      const token = getCookie(req, cfg.cookie.name);
      if (token) await revokeSession(getPool(), token);
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(cfg, '', 0) });
    },
  };

  // Retorna true quando a requisição era de /api (e já foi respondida).
  return async function handleApi(req, res) {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return false;
    const route = routes[`${req.method} ${path}`];
    try {
      if (!route) {
        const exists = Object.keys(routes).some((k) => k.endsWith(` ${path}`));
        throw new HttpError(exists ? 405 : 404, exists ? 'method_not_allowed' : 'not_found');
      }
      await route(req, res);
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.code });
      } else if (err instanceof ConfigError) {
        log.error?.(`[api] ${req.method} ${path}: ${err.message}`);
        sendJson(res, 503, { error: 'not_configured' });
      } else {
        log.error?.(`[api] ${req.method} ${path}: ${err.code || ''} ${String(err.message).slice(0, 200)}`);
        sendJson(res, 500, { error: 'internal_error' });
      }
    }
    if (!res.writableEnded) sendJson(res, 500, { error: 'internal_error' });
    return true;
  };
}
