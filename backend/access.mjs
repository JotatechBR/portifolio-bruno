// Regra de acesso centralizada: usada pelo worker (Cakto/expiração), pela API (/acesso) e pelo bot.
import { enqueue } from './jobs.mjs';
import { getOrder, getEntitlement, getLinkByOrder } from './repositories.mjs';

// Pedido elegível: pago, confirmado na API da Cakto, não revogado, do produto configurado e com
// política de acesso definida. Sem política configurada, nada é concedido.
export function orderEligible(order, product) {
  return Boolean(
    order &&
      order.status === 'paid' &&
      order.verified_at &&
      order.paid_at &&
      !order.revoked_at &&
      product.policy &&
      product.telegramGroupId &&
      order.product_id === product.caktoProductId &&
      (!product.caktoOfferId || !order.offer_id || order.offer_id === product.caktoOfferId)
  );
}

// Período do acesso a partir da data de pagamento confirmada.
export function accessWindow(order, policy) {
  const start = new Date(order.paid_at);
  if (policy.kind === 'lifetime') return { startsAt: start, endsAt: null };
  return { startsAt: start, endsAt: new Date(start.getTime() + policy.days * 86_400_000) };
}

export function entitlementActive(ent, now = new Date()) {
  return Boolean(ent && ent.status === 'active' && (!ent.ends_at || new Date(ent.ends_at) > now));
}

// Aplica a decisão para um pedido (dentro de uma transação). Idempotente.
export async function reconcileOrder(conn, product, orderId, now = new Date()) {
  const order = await getOrder(conn, orderId, { lock: true });
  const ent = await getEntitlement(conn, orderId, { lock: true });
  const eligible = orderEligible(order, product);

  if (eligible && !ent) {
    const { startsAt, endsAt } = accessWindow(order, product.policy);
    if (endsAt && endsAt <= now) return 'expired_before_grant';
    await conn.query(
      `INSERT INTO entitlements (order_id, group_id, status, starts_at, ends_at) VALUES (?, ?, 'active', ?, ?)`,
      [orderId, product.telegramGroupId, startsAt, endsAt]
    );
    // e-mail de orientação: uma única vez por pedido, mesmo com reentregas
    await enqueue(conn, 'email.access_instructions', { orderId: String(orderId) }, { dedupeKey: `access-email:${orderId}` });
    return 'granted';
  }

  if (!eligible && ent && ent.status === 'active') {
    const reason = order.revoked_reason || 'not_eligible';
    await conn.query(`UPDATE entitlements SET status = 'revoked', revoke_reason = ? WHERE id = ?`, [reason, ent.id]);
    await scheduleRemoval(conn, orderId, ent.group_id);
    return 'revoked';
  }
  return 'unchanged';
}

// Agenda a remoção da conta vinculada (o job confere outros direitos antes de remover).
export async function scheduleRemoval(conn, orderId, groupId) {
  const link = await getLinkByOrder(conn, orderId);
  if (!link) return;
  await enqueue(conn, 'telegram.remove_member', { telegramUserId: String(link.telegram_user_id), groupId: String(groupId) });
}

// Encerra direitos vencidos (política por dias).
export async function expireDue(pool, now = new Date()) {
  const conn = await pool.getConnection();
  let n = 0;
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM entitlements WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ? LIMIT 200 FOR UPDATE SKIP LOCKED`,
      [now]
    );
    for (const e of rows) {
      await conn.query(`UPDATE entitlements SET status = 'expired', revoke_reason = 'expired' WHERE id = ?`, [e.id]);
      await scheduleRemoval(conn, e.order_id, e.group_id);
      n++;
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  return n;
}

// Estado exibido na página /acesso (sem expor detalhes internos).
export async function accessStateForOrder(conn, order, now = new Date()) {
  const ent = await getEntitlement(conn, order.id);
  if (order.revoked_at || (ent && !entitlementActive(ent, now))) return 'inactive';
  if (!ent) return 'pending';
  const link = await getLinkByOrder(conn, order.id);
  if (!link) return 'available';
  return link.joined_at ? 'active' : 'linked';
}
