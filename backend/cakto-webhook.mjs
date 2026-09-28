// POST /api/webhooks/cakto: autentica, valida, grava evento + tarefa na mesma transação e só então
// responde 2xx. Nada de consulta externa aqui: o worker faz a reconciliação.
// Contrato: https://docs.cakto.com.br/conceitos/webhooks
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, readBody, requireJsonType, parseJson, sendJson } from './http.mjs';
import { withTransaction } from './db.mjs';
import { enqueue, requeueFailed } from './jobs.mjs';
import { insertInboundEvent } from './repositories.mjs';
import { normalizeOrder } from './cakto.mjs';

// Eventos com efeito sobre pedidos deste produto. Assinaturas não se aplicam (pagamento único).
export const ORDER_EVENTS = new Set([
  'purchase_approved',
  'purchase_refused',
  'refund',
  'chargeback',
  'pix_gerado',
  'boleto_gerado',
  'picpay_gerado',
  'openfinance_nubank_gerado',
]);

const safeEqual = (a, b) => {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
};

// Assinatura v1: HMAC-SHA256(secret, `${timestamp}.${corpo_bruto}`) em hex, header "v1=<hex>".
export function verifyCaktoSignature({ secret, timestamp, signature, raw, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300 }) {
  if (!secret || typeof timestamp !== 'string' || typeof signature !== 'string') return 'missing';
  if (!/^\d{9,11}$/.test(timestamp)) return 'bad_timestamp';
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return 'stale';
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), raw]))
    .digest();
  const candidates = signature
    .split(/[\s,]+/)
    .map((p) => /^v1=([0-9a-f]{64})$/i.exec(p.trim()))
    .filter(Boolean)
    .map((m) => Buffer.from(m[1], 'hex'));
  if (!candidates.length) return 'bad_format';
  return candidates.some((c) => c.length === expected.length && timingSafeEqual(c, expected)) ? 'ok' : 'mismatch';
}

// Chave estável por pedido + tipo + marco da transição (nunca horário da entrega ou assinatura).
export function caktoDedupeKey(event, o) {
  const marker =
    event === 'purchase_approved'
      ? o.paidAt?.toISOString()
      : event === 'refund'
        ? o.refundedAt?.toISOString()
        : event === 'chargeback'
          ? o.chargedbackAt?.toISOString()
          : o.status;
  const h = createHash('sha256').update(`${o.caktoOrderId}|${event}|${marker || ''}`).digest('hex');
  return `cakto:${h}`;
}

function minimalPayload(event, o) {
  return {
    event,
    order: {
      id: o.caktoOrderId,
      status: o.status,
      productId: o.productId,
      offerId: o.offerId,
      productName: o.productName,
      email: o.email,
      amountCents: o.amountCents,
      paidAt: o.paidAt,
      refundedAt: o.refundedAt,
      chargedbackAt: o.chargedbackAt,
    },
  };
}

export function createCaktoWebhookHandler({ cfg, pool, log = console }) {
  return async function handle(req, res) {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
    requireJsonType(req);
    const raw = await readBody(req, 256 * 1024);

    // 1) autenticação antes de qualquer escrita
    const secret = cfg.cakto.webhookSecret;
    let body;
    if (cfg.cakto.webhookAuth === 'signature') {
      const result = verifyCaktoSignature({
        secret,
        timestamp: req.headers['x-cakto-timestamp'],
        signature: req.headers['x-cakto-signature'],
        raw,
        toleranceSec: cfg.cakto.toleranceSec,
      });
      if (result !== 'ok') {
        log.warn?.(`[cakto-webhook] assinatura rejeitada: ${result}`);
        throw new HttpError(401, 'invalid_signature');
      }
      body = parseJson(raw);
      // defesa extra: o campo secret, quando presente, também precisa conferir
      if (body && body.secret !== undefined && !safeEqual(body.secret, secret)) throw new HttpError(401, 'invalid_signature');
    } else {
      // modo explícito "secret_field" (somente se a conta não enviar assinatura)
      body = parseJson(raw);
      if (!body || typeof body.secret !== 'string' || !safeEqual(body.secret, secret)) throw new HttpError(401, 'invalid_secret');
    }

    // 2) schema do envelope
    if (!body || typeof body !== 'object' || typeof body.event !== 'string' || !/^[a-z0-9_]{3,64}$/.test(body.event)) {
      throw new HttpError(400, 'invalid_envelope');
    }
    const records = Array.isArray(body.data) ? body.data : body.data && typeof body.data === 'object' ? [body.data] : null;
    if (!records || records.length === 0 || records.length > 100) throw new HttpError(400, 'invalid_envelope');

    // 3) grava tudo numa transação; 2xx só depois do commit
    const product = cfg.product;
    const summary = await withTransaction(pool, async (conn) => {
      const out = { queued: 0, ignored: 0, duplicate: 0 };
      for (const rec of records) {
        let o;
        try {
          o = normalizeOrder(rec);
        } catch {
          const key = `cakto:bad:${createHash('sha256').update(JSON.stringify(rec ?? null)).digest('hex')}`;
          await insertInboundEvent(conn, { source: 'cakto', dedupeKey: key, eventType: body.event, externalRef: null, payload: { event: body.event }, status: 'ignored' });
          out.ignored++;
          continue;
        }
        const relevant =
          ORDER_EVENTS.has(body.event) &&
          o.productId === product.caktoProductId &&
          (!product.caktoOfferId || !o.offerId || o.offerId === product.caktoOfferId);
        const key = caktoDedupeKey(body.event, o);
        const ev = await insertInboundEvent(conn, {
          source: 'cakto',
          dedupeKey: key,
          eventType: body.event,
          externalRef: o.caktoOrderId,
          payload: minimalPayload(body.event, o),
          status: relevant ? 'received' : 'ignored',
        });
        if (!relevant) {
          out.ignored++;
          continue;
        }
        if (ev.inserted) {
          await enqueue(conn, 'cakto.event', { eventId: String(ev.id) }, { dedupeKey: `event:${ev.id}` });
          out.queued++;
        } else {
          // reentrega: se a tarefa anterior falhou de vez, reabre; se está pendente, segue na fila
          await requeueFailed(conn, { dedupeKey: `event:${ev.id}` });
          out.duplicate++;
        }
      }
      return out;
    });
    sendJson(res, 200, { ok: true, ...summary });
  };
}
