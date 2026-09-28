// Consultas parametrizadas. Todas recebem a conexão/transação do chamador.

// Status da Cakto que encerram o direito de forma definitiva.
export const REVOKING_STATUS = { refunded: 'refund', chargedback: 'chargeback' };

// ---------- pedidos ----------
export async function getOrderByCaktoId(conn, caktoOrderId, { lock = false } = {}) {
  const [rows] = await conn.query(`SELECT * FROM orders WHERE cakto_order_id = ?${lock ? ' FOR UPDATE' : ''}`, [caktoOrderId]);
  return rows[0] || null;
}

export async function getOrder(conn, id, { lock = false } = {}) {
  const [rows] = await conn.query(`SELECT * FROM orders WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  return rows[0] || null;
}

export async function ordersByEmail(conn, email) {
  const [rows] = await conn.query('SELECT * FROM orders WHERE email = ? ORDER BY created_at DESC, id DESC', [email]);
  return rows;
}

export async function hasKnownOrder(conn, email) {
  const [rows] = await conn.query('SELECT 1 FROM orders WHERE email = ? LIMIT 1', [email]);
  return rows.length > 0;
}

// Grava/atualiza um pedido sem nunca "desfazer" reembolso/chargeback nem rebaixar um pagamento
// confirmado por eventos atrasados. Só dados verificados na API (verified=true) marcam "paid".
export async function upsertOrder(conn, o, { verified }, now = new Date()) {
  const current = await getOrderByCaktoId(conn, o.caktoOrderId, { lock: true });
  const revokeReason = REVOKING_STATUS[o.status] || null;

  if (!current) {
    const status = o.status === 'paid' && !verified ? 'awaiting_verification' : o.status;
    const [r] = await conn.query(
      `INSERT INTO orders (cakto_order_id, product_id, offer_id, product_name, email, status, amount_cents, paid_at,
                           verified_at, revoked_at, revoked_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        o.caktoOrderId,
        o.productId,
        o.offerId,
        o.productName,
        o.email,
        status,
        o.amountCents,
        verified ? o.paidAt : null,
        verified ? now : null,
        revokeReason ? now : null,
        revokeReason,
      ]
    );
    return getOrder(conn, r.insertId);
  }

  const sets = [];
  const vals = [];
  const set = (col, v) => {
    sets.push(`${col} = ?`);
    vals.push(v);
  };

  if (current.revoked_at) {
    // definitivo: nada reativa
  } else if (revokeReason) {
    set('status', o.status);
    set('revoked_at', now);
    set('revoked_reason', revokeReason);
  } else if (verified) {
    set('status', o.status);
    set('verified_at', now);
    if (o.status === 'paid') set('paid_at', o.paidAt);
  } else if (current.status !== 'paid' && current.status !== 'awaiting_verification') {
    // evento não verificado só atualiza pedidos ainda não pagos
    set('status', o.status === 'paid' ? 'awaiting_verification' : o.status);
  }
  if (verified) {
    // dados reais da API prevalecem
    set('email', o.email);
    set('product_id', o.productId);
    if (o.offerId) set('offer_id', o.offerId);
    if (o.productName) set('product_name', o.productName);
    if (o.amountCents !== null) set('amount_cents', o.amountCents);
  }
  if (sets.length) await conn.query(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, [...vals, current.id]);
  return getOrder(conn, current.id);
}

// ---------- direitos ----------
export async function getEntitlement(conn, orderId, { lock = false } = {}) {
  const [rows] = await conn.query(`SELECT * FROM entitlements WHERE order_id = ?${lock ? ' FOR UPDATE' : ''}`, [orderId]);
  return rows[0] || null;
}

// ---------- Telegram ----------
export async function getLinkByOrder(conn, orderId, { lock = false } = {}) {
  const [rows] = await conn.query(`SELECT * FROM telegram_links WHERE order_id = ?${lock ? ' FOR UPDATE' : ''}`, [orderId]);
  return rows[0] || null;
}

export async function linksByUser(conn, telegramUserId) {
  const [rows] = await conn.query('SELECT * FROM telegram_links WHERE telegram_user_id = ?', [telegramUserId]);
  return rows;
}

// Existe algum direito vigente (qualquer compra) desta conta para este grupo?
export async function hasActiveAccess(conn, telegramUserId, groupId, now = new Date(), { excludeOrderId = null } = {}) {
  const [rows] = await conn.query(
    `SELECT e.order_id FROM telegram_links l
       JOIN entitlements e ON e.order_id = l.order_id
       JOIN orders o ON o.id = e.order_id
     WHERE l.telegram_user_id = ? AND e.group_id = ? AND e.status = 'active'
       AND (e.ends_at IS NULL OR e.ends_at > ?) AND o.revoked_at IS NULL
       ${excludeOrderId ? 'AND e.order_id <> ?' : ''}
     LIMIT 1`,
    excludeOrderId ? [telegramUserId, groupId, now, excludeOrderId] : [telegramUserId, groupId, now]
  );
  return rows.length > 0;
}

// ---------- eventos recebidos ----------
// Insere o evento; se já existia, devolve o existente (inserted=false).
export async function insertInboundEvent(conn, { source, dedupeKey, eventType, externalRef, payload, status = 'received' }) {
  const [r] = await conn.query(
    `INSERT INTO inbound_events (source, dedupe_key, event_type, external_ref, payload, status)
     VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [source, dedupeKey, eventType, externalRef, JSON.stringify(payload), status]
  );
  return { id: r.insertId, inserted: r.affectedRows === 1 };
}

export async function getInboundEvent(conn, id) {
  const [rows] = await conn.query('SELECT * FROM inbound_events WHERE id = ?', [id]);
  const ev = rows[0] || null;
  if (ev && typeof ev.payload === 'string') ev.payload = JSON.parse(ev.payload);
  return ev;
}

export async function markEvent(conn, id, status, error = null) {
  await conn.query('UPDATE inbound_events SET status = ?, error = ?, processed_at = ? WHERE id = ?', [
    status,
    error ? String(error).slice(0, 480) : null,
    new Date(),
    id,
  ]);
}
