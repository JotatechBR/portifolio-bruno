// Processo separado que executa a fila (npm run worker). Deve rodar sempre, supervisionado
// (systemd, pm2, serviço da hospedagem). Reiniciar é seguro: tarefas em andamento voltam à fila
// quando o lease vence.
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import { loadEnvFile, readConfig, requireConfig } from './config.mjs';
import { createPool, withTransaction } from './db.mjs';
import { runOne, PermanentError, RetryableError } from './jobs.mjs';
import { createCaktoClient, normalizeOrder, OrderNotFoundError } from './cakto.mjs';
import { upsertOrder, getOrder, getEntitlement, getInboundEvent, markEvent } from './repositories.mjs';
import { reconcileOrder, expireDue, entitlementActive } from './access.mjs';
import { createMailer } from './email.mjs';
import { sendChallengeEmail } from './verification.mjs';
import { createTelegramClient, createTelegramOps } from './telegram.mjs';

const REVOKE_EVENT_STATUS = { refund: 'refunded', chargeback: 'chargedback' };

// Pedido gravado no evento (JSON) -> objeto com datas.
function fromPayload(o) {
  const d = (v) => (v ? new Date(v) : null);
  return { ...o, caktoOrderId: o.id, paidAt: d(o.paidAt), refundedAt: d(o.refundedAt), chargedbackAt: d(o.chargedbackAt) };
}

export function createHandlers({ cfg, pool, cakto, mailer, telegram, log = () => {} }) {
  const product = cfg.product;

  async function caktoEvent({ eventId }) {
    const ev = await getInboundEvent(pool, eventId);
    if (!ev || ev.status === 'processed' || ev.status === 'ignored') return;
    const { event } = ev.payload;
    const o = fromPayload(ev.payload.order);

    if (event === 'purchase_approved') {
      // reconciliação obrigatória na API antes de conceder qualquer acesso
      let api;
      try {
        api = await cakto.getOrder(o.caktoOrderId);
      } catch (e) {
        if (e instanceof OrderNotFoundError) {
          await markEvent(pool, ev.id, 'ignored', 'pedido não encontrado na Cakto (possível evento de teste)');
          return;
        }
        throw e;
      }
      const real = normalizeOrder(api);
      if (real.caktoOrderId !== o.caktoOrderId) throw new PermanentError('API devolveu outro pedido');
      if (real.productId !== product.caktoProductId) {
        await markEvent(pool, ev.id, 'ignored', 'produto divergente na API');
        return;
      }
      real.offerId = real.offerId || o.offerId;
      if (product.caktoOfferId && real.offerId && real.offerId !== product.caktoOfferId) {
        await markEvent(pool, ev.id, 'ignored', 'oferta divergente');
        return;
      }
      if (!real.email) throw new PermanentError('API não informou o e-mail do comprador');
      const settled = real.status === 'paid' || real.status === 'refunded' || real.status === 'chargedback';
      await withTransaction(pool, async (conn) => {
        const order = await upsertOrder(conn, real, { verified: true });
        await reconcileOrder(conn, product, order.id);
        if (settled) await markEvent(conn, ev.id, 'processed');
      });
      if (!settled) throw new RetryableError(`pagamento ainda não confirmado na API (status ${real.status})`);
      if (!product.policy) log('[worker] ACCESS_POLICY não configurada: pagamento registrado, acesso pendente.');
      return;
    }

    await withTransaction(pool, async (conn) => {
      const data = REVOKE_EVENT_STATUS[event] ? { ...o, status: REVOKE_EVENT_STATUS[event] } : o;
      const order = await upsertOrder(conn, data, { verified: false });
      await reconcileOrder(conn, product, order.id);
      await markEvent(conn, ev.id, 'processed');
    });
  }

  async function accessInstructions({ orderId }) {
    if (!cfg.siteUrl) throw new RetryableError('PUBLIC_SITE_URL não configurado');
    const order = await getOrder(pool, orderId);
    const ent = await getEntitlement(pool, orderId);
    if (!order || !order.email || !entitlementActive(ent)) return; // revogado antes do envio
    await mailer.sendAccessInstructions(order.email);
  }

  return {
    'cakto.event': caktoEvent,
    'email.access_instructions': accessInstructions,
    'email.code': ({ challengeId }) => sendChallengeEmail(pool, cfg, mailer, challengeId),
    'telegram.update': (p) => telegram.processUpdate(p),
    'telegram.send_invite': (p) => telegram.sendInvite(p),
    'telegram.remove_member': (p) => telegram.removeMember(p),
  };
}

export function createDeps(cfg, overrides = {}) {
  const pool = overrides.pool || createPool(cfg.db);
  const cakto = overrides.cakto || createCaktoClient({ clientId: cfg.cakto.clientId, clientSecret: cfg.cakto.clientSecret });
  const mailer = overrides.mailer || createMailer(cfg);
  const call = overrides.telegramCall || createTelegramClient({ token: cfg.telegram.botToken });
  const telegram = createTelegramOps({ cfg, pool, call, log: overrides.log });
  return { pool, cakto, mailer, telegram, call };
}

// Laço principal: tarefas + varredura de vencimentos a cada minuto.
export async function startWorker({ cfg, deps, log = console.log }) {
  const handlers = createHandlers({ cfg, ...deps, log });
  const workerId = `${hostname()}-${process.pid}`.slice(0, 64);
  let stopping = false;
  let lastSweep = 0;
  const stop = () => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  log(`[worker] iniciado (${workerId})`);
  while (!stopping) {
    try {
      if (Date.now() - lastSweep > 60_000) {
        lastSweep = Date.now();
        const n = await expireDue(deps.pool);
        if (n) log(`[worker] ${n} acesso(s) vencido(s)`);
      }
      const worked = await runOne(deps.pool, handlers, { workerId, log });
      if (!worked) await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      log(`[worker] erro no laço: ${e.code || ''} ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  log('[worker] encerrando');
  await deps.pool.end();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadEnvFile();
  const cfg = readConfig();
  requireConfig(cfg, 'worker');
  startWorker({ cfg, deps: createDeps(cfg) }).catch((e) => {
    console.error('[worker] falhou:', e.message);
    process.exit(1);
  });
}
