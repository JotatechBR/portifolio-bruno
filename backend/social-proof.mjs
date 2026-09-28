// GET /api/social-proof/recent: atividade real e anônima para a faixa do site.
// Fonte única: pedidos do produto configurado que chegaram por purchase_approved, foram
// confirmados na API da Cakto (verified_at), estão pagos e não foram revogados.
// A resposta leva só { type, timeLabel }: nunca nome, e-mail, telefone, documento, valor ou ID.

export const WINDOW_HOURS = 48;
export const MAX_EVENTS = 5;
const CACHE_MS = 60_000;

// "há 12 min", "há 3 h", "há 1 dia". Nada acima da janela; nada no futuro.
export function timeLabel(paidAt, now = new Date()) {
  const diff = now.getTime() - new Date(paidAt).getTime();
  if (!Number.isFinite(diff) || diff < 0 || diff > WINDOW_HOURS * 3_600_000) return null;
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `há ${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'há 1 dia' : `há ${d} dias`;
}

export async function recentApprovals(conn, product, now = new Date()) {
  if (!product.caktoProductId) return [];
  const since = new Date(now.getTime() - WINDOW_HOURS * 3_600_000);
  const [rows] = await conn.query(
    `SELECT o.paid_at FROM orders o
      WHERE o.product_id = ? AND o.status = 'paid' AND o.verified_at IS NOT NULL
        AND o.revoked_at IS NULL AND o.paid_at IS NOT NULL AND o.paid_at >= ? AND o.paid_at <= ?
        AND EXISTS (SELECT 1 FROM inbound_events e
                     WHERE e.source = 'cakto' AND e.event_type = 'purchase_approved'
                       AND e.status = 'processed' AND e.external_ref = o.cakto_order_id)
      ORDER BY o.paid_at DESC
      LIMIT ${MAX_EVENTS}`,
    [product.caktoProductId, since, now]
  );
  return rows.map((r) => new Date(r.paid_at));
}

// Converte as datas em eventos públicos (sem identificadores).
export function toPublicEvents(dates, now = new Date()) {
  return dates
    .map((d) => timeLabel(d, now))
    .filter(Boolean)
    .map((label) => ({ type: 'access_approved', timeLabel: label }));
}

// Handler com cache curto em memória: a rota é pública e não pode virar carga no banco.
// Sem banco ou produto configurado, ou com erro, responde [] (o site mantém as mensagens fixas).
export function createSocialProofHandler({ cfg, getPool, log = console, now = () => new Date() }) {
  let cache = { at: 0, dates: [] };
  return async function handle(req, res, sendJson) {
    const t = now();
    if (t.getTime() - cache.at > CACHE_MS) {
      let dates = [];
      try {
        if (cfg.db && cfg.product.caktoProductId) dates = await recentApprovals(getPool(), cfg.product, t);
      } catch (err) {
        log.error?.(`[social-proof] ${err.code || ''} ${String(err.message).slice(0, 120)}`);
      }
      cache = { at: t.getTime(), dates };
    }
    sendJson(res, 200, toPublicEvents(cache.dates, t), { 'Cache-Control': 'public, max-age=60' });
  };
}
