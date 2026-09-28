// Bot API oficial via HTTP (sem framework): vínculo por /start, convites com solicitação de
// entrada, aprovação/recusa e remoção. Contratos: https://core.telegram.org/bots/api
import { createHash, randomBytes } from 'node:crypto';
import { withTransaction, isDuplicate } from './db.mjs';
import { enqueue, RetryableError, PermanentError } from './jobs.mjs';
import { getOrder, getEntitlement, getLinkByOrder, hasActiveAccess, linksByUser, markEvent, getInboundEvent } from './repositories.mjs';
import { entitlementActive } from './access.mjs';

export const TELEGRAM_API = 'https://api.telegram.org';
export const LINK_TOKEN_TTL_MS = 10 * 60_000;
export const INVITE_TTL_SEC = 10 * 60;
export const INVITE_PREFIX = 'bacc-'; // só convites com este nome são tratados pelo bot
const TIMEOUT_MS = 10_000;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export class TelegramError extends Error {
  constructor(code, description) {
    super(`Telegram ${code}: ${description}`);
    this.name = 'TelegramError';
    this.code = code;
    this.description = String(description || '');
  }
}

export function createTelegramClient({ token, baseUrl = TELEGRAM_API, fetchImpl = fetch }) {
  return async function call(method, params = {}) {
    if (!token) throw new RetryableError('TELEGRAM_BOT_TOKEN não configurado');
    let res;
    try {
      res = await fetchImpl(`${baseUrl}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new RetryableError(`Telegram indisponível (${e.name || 'rede'}) em ${method}`);
    }
    const body = await res.json().catch(() => null);
    if (body && body.ok) return body.result;
    const code = (body && body.error_code) || res.status;
    const desc = (body && body.description) || `HTTP ${res.status}`;
    if (code === 429) throw new RetryableError(`Telegram 429 em ${method}`, Number(body?.parameters?.retry_after) || 5);
    if (code >= 500) throw new RetryableError(`Telegram ${code} em ${method}`);
    throw new TelegramError(code, `${method}: ${desc}`);
  };
}

// ---------- token de vinculação (API /acesso) ----------
// 32 bytes em base64url (43 caracteres, dentro do limite de 64 do parâmetro start).
export async function issueLinkToken(conn, orderId, now = new Date()) {
  const token = randomBytes(32).toString('base64url');
  await conn.query(
    'UPDATE telegram_link_tokens SET superseded_at = ? WHERE order_id = ? AND consumed_at IS NULL AND superseded_at IS NULL',
    [now, orderId]
  );
  await conn.query('INSERT INTO telegram_link_tokens (token_hash, order_id, expires_at, created_at) VALUES (?, ?, ?, ?)', [
    sha256(token),
    orderId,
    new Date(now.getTime() + LINK_TOKEN_TTL_MS),
    now,
  ]);
  return token;
}

export const botStartUrl = (botUsername, token) => `https://t.me/${botUsername}?start=${token}`;

// ---------- processamento de updates (worker) ----------
const MEMBER = new Set(['member', 'administrator', 'creator']);
const isMember = (m) => m && (MEMBER.has(m.status) || (m.status === 'restricted' && m.is_member));

// Consome o token e vincula a compra à conta do remetente na mesma transação que agenda o convite.
export async function consumeStartToken(pool, { token, telegramUserId, now = new Date() }) {
  return withTransaction(pool, async (conn) => {
    const [[t]] = await conn.query('SELECT * FROM telegram_link_tokens WHERE token_hash = ? FOR UPDATE', [sha256(token)]);
    if (!t) return 'invalid';
    if (t.consumed_at) {
      if (String(t.consumed_by) !== String(telegramUserId)) return 'invalid';
    } else if (t.superseded_at || new Date(t.expires_at) <= now) {
      return 'expired';
    }
    const order = await getOrder(conn, t.order_id, { lock: true });
    const ent = await getEntitlement(conn, t.order_id, { lock: true });
    if (!order || order.revoked_at || !entitlementActive(ent, now)) return 'inactive';

    let link = await getLinkByOrder(conn, t.order_id, { lock: true });
    if (!link) {
      try {
        await conn.query('INSERT INTO telegram_links (order_id, telegram_user_id, linked_at) VALUES (?, ?, ?)', [
          t.order_id,
          telegramUserId,
          now,
        ]);
      } catch (e) {
        if (!isDuplicate(e)) throw e;
      }
      link = await getLinkByOrder(conn, t.order_id, { lock: true });
    }
    if (String(link.telegram_user_id) !== String(telegramUserId)) {
      // compra já vinculada a outra conta: não transfere automaticamente
      if (!t.consumed_at) await conn.query('UPDATE telegram_link_tokens SET consumed_at = ?, consumed_by = ? WHERE id = ?', [now, telegramUserId, t.id]);
      return 'other_account';
    }
    if (!t.consumed_at) await conn.query('UPDATE telegram_link_tokens SET consumed_at = ?, consumed_by = ? WHERE id = ?', [now, telegramUserId, t.id]);
    await enqueue(conn, 'telegram.send_invite', { orderId: String(t.order_id), telegramUserId: String(telegramUserId) });
    return 'linked';
  });
}

export function createTelegramOps({ cfg, pool, call, log = () => {} }) {
  const groupId = () => cfg.product.telegramGroupId;
  const siteAccess = () => (cfg.siteUrl ? `${cfg.siteUrl}/acesso/` : 'a página de ativação do site');

  // mensagem ao usuário: 403 (bot bloqueado) não é motivo para repetir a tarefa
  async function tell(chatId, text, extra = {}) {
    try {
      await call('sendMessage', { chat_id: chatId, text, ...extra });
    } catch (e) {
      if (e instanceof TelegramError && (e.code === 403 || e.code === 400)) log(`[telegram] mensagem não entregue: ${e.code}`);
      else throw e;
    }
  }

  async function getMember(userId) {
    try {
      return await call('getChatMember', { chat_id: groupId(), user_id: Number(userId) });
    } catch (e) {
      if (e instanceof TelegramError && e.code === 400) return null;
      throw e;
    }
  }

  async function revokeOpenInvites(userId, exceptId = null) {
    const [rows] = await pool.query(
      `SELECT * FROM telegram_invites WHERE telegram_user_id = ? AND group_id = ? AND status = 'open'${exceptId ? ' AND id <> ?' : ''}`,
      exceptId ? [userId, groupId(), exceptId] : [userId, groupId()]
    );
    for (const inv of rows) {
      try {
        await call('revokeChatInviteLink', { chat_id: groupId(), invite_link: inv.invite_link });
      } catch (e) {
        if (!(e instanceof TelegramError)) throw e; // 400 = já expirado/revogado
      }
      await pool.query(`UPDATE telegram_invites SET status = 'revoked' WHERE id = ?`, [inv.id]);
    }
  }

  async function markJoined(userId, now = new Date()) {
    await pool.query(
      `UPDATE telegram_links l JOIN entitlements e ON e.order_id = l.order_id
       SET l.joined_at = COALESCE(l.joined_at, ?)
       WHERE l.telegram_user_id = ? AND e.group_id = ? AND e.status = 'active'`,
      [now, userId, groupId()]
    );
  }

  // Tarefa: emitir convite pessoal (válido 10 min, com solicitação de entrada).
  async function sendInvite({ orderId, telegramUserId }) {
    const now = new Date();
    const [ent, link] = await Promise.all([getEntitlement(pool, orderId), getLinkByOrder(pool, orderId)]);
    if (!entitlementActive(ent, now) || !link || String(link.telegram_user_id) !== String(telegramUserId)) {
      await tell(telegramUserId, `Este acesso não está ativo. Se precisar, confira em ${siteAccess()}`);
      return;
    }
    if (String(ent.group_id) !== String(groupId())) throw new PermanentError('grupo do direito difere do configurado');

    const member = await getMember(telegramUserId);
    if (isMember(member)) {
      await markJoined(telegramUserId, now);
      await tell(telegramUserId, 'Seu acesso já está ativo: você já faz parte do grupo.');
      return;
    }
    // recompra depois de remoção: tira o banimento anterior (só se estiver banido)
    await call('unbanChatMember', { chat_id: groupId(), user_id: Number(telegramUserId), only_if_banned: true });

    const name = `${INVITE_PREFIX}${randomBytes(6).toString('hex')}`;
    const expires = new Date(now.getTime() + INVITE_TTL_SEC * 1000);
    const [ins] = await pool.query(
      `INSERT INTO telegram_invites (name, order_id, group_id, telegram_user_id, status, expires_at) VALUES (?, ?, ?, ?, 'creating', ?)`,
      [name, orderId, groupId(), telegramUserId, expires]
    );
    // sem member_limit: incompatível com creates_join_request
    const inv = await call('createChatInviteLink', {
      chat_id: groupId(),
      name,
      expire_date: Math.floor(expires.getTime() / 1000),
      creates_join_request: true,
    });
    await pool.query(`UPDATE telegram_invites SET invite_link = ?, status = 'open' WHERE id = ?`, [inv.invite_link, ins.insertId]);
    await revokeOpenInvites(telegramUserId, ins.insertId);
    await tell(telegramUserId, 'Pronto! Toque no botão abaixo e peça para entrar no grupo. O convite vale por 10 minutos e só funciona para esta conta.', {
      reply_markup: { inline_keyboard: [[{ text: 'Entrar no grupo', url: inv.invite_link }]] },
    });
  }

  // Tarefa: remover conta sem direito vigente (confere outras compras antes).
  async function removeMember({ telegramUserId, groupId: gid }) {
    if (String(gid) !== String(groupId())) throw new PermanentError('grupo desconhecido');
    if (await hasActiveAccess(pool, telegramUserId, gid)) return;
    await revokeOpenInvites(telegramUserId);
    try {
      await call('banChatMember', { chat_id: gid, user_id: Number(telegramUserId), revoke_messages: false });
    } catch (e) {
      // administrador/dono não pode ser removido pelo bot: registra e encerra
      if (e instanceof TelegramError && e.code === 400 && /admin|owner|creator/i.test(e.description)) throw new PermanentError(e.message);
      throw e instanceof TelegramError && e.code === 403 ? new RetryableError(`${e.message} (verifique as permissões do bot)`) : e;
    }
    await pool.query(
      `UPDATE telegram_links l JOIN entitlements e ON e.order_id = l.order_id SET l.joined_at = NULL
       WHERE l.telegram_user_id = ? AND e.group_id = ?`,
      [telegramUserId, gid]
    );
  }

  async function onStart(msg) {
    const m = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(msg.text || '');
    if (!m) return;
    const token = m[1];
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      await tell(msg.chatId, `Para ativar seu acesso, confirme o e-mail da compra em ${siteAccess()} e toque em "Conectar meu Telegram".`);
      return;
    }
    const outcome = await consumeStartToken(pool, { token, telegramUserId: msg.fromId });
    const replies = {
      linked: 'Conta conectada. Estou preparando seu convite...',
      invalid: `Este link não é válido. Gere um novo em ${siteAccess()}`,
      expired: `Este link expirou. Gere um novo em ${siteAccess()}`,
      inactive: 'Este acesso não está ativo.',
      other_account:
        'Esta compra já está conectada a outra conta do Telegram. Por segurança, a troca de conta não é automática: fale com o suporte do Bruno.',
    };
    await tell(msg.chatId, replies[outcome]);
  }

  async function onJoinRequest(r) {
    if (String(r.chatId) !== String(groupId())) return; // grupo não gerenciado: não interfere
    if (!r.inviteName || !r.inviteName.startsWith(INVITE_PREFIX)) return; // convite de terceiros: não interfere
    const now = new Date();
    const [[inv]] = await pool.query('SELECT * FROM telegram_invites WHERE name = ?', [r.inviteName]);
    const valid =
      inv &&
      String(inv.group_id) === String(r.chatId) &&
      String(inv.telegram_user_id) === String(r.userId) &&
      (inv.status === 'open' || inv.status === 'used') &&
      (!r.inviteLink || !inv.invite_link || r.inviteLink === inv.invite_link) &&
      r.date * 1000 <= new Date(inv.expires_at).getTime() + 60_000 &&
      (await hasActiveAccess(pool, r.userId, r.chatId, now));

    if (!valid) {
      try {
        await call('declineChatJoinRequest', { chat_id: r.chatId, user_id: Number(r.userId) });
      } catch (e) {
        if (!(e instanceof TelegramError && e.code === 400)) throw e; // pedido já resolvido
      }
      return;
    }
    try {
      await call('approveChatJoinRequest', { chat_id: r.chatId, user_id: Number(r.userId) });
    } catch (e) {
      if (!(e instanceof TelegramError && e.code === 400)) throw e;
      // repetição após timeout: se já é membro, o trabalho está concluído
      const member = await getMember(r.userId);
      if (!isMember(member)) {
        log(`[telegram] aprovação não aplicada: ${e.description}`);
        return;
      }
    }
    await pool.query(`UPDATE telegram_invites SET status = 'used' WHERE id = ?`, [inv.id]);
    await markJoined(r.userId, now);
    try {
      await call('revokeChatInviteLink', { chat_id: r.chatId, invite_link: inv.invite_link });
    } catch (e) {
      if (!(e instanceof TelegramError)) throw e;
    }
    // reembolso durante a aprovação: reconcilia na hora
    if (!(await hasActiveAccess(pool, r.userId, r.chatId, new Date()))) {
      await enqueue(pool, 'telegram.remove_member', { telegramUserId: String(r.userId), groupId: String(r.chatId) });
    }
  }

  async function onChatMember(u) {
    if (String(u.chatId) !== String(groupId())) return;
    const joined = MEMBER.has(u.newStatus) || (u.newStatus === 'restricted' && u.newIsMember);
    if (!joined) return;
    const links = await linksByUser(pool, u.userId);
    if (!links.length) return; // membro não ligado a compras: não mexemos
    if (await hasActiveAccess(pool, u.userId, u.chatId)) await markJoined(u.userId);
    else if (u.newStatus === 'member' || u.newStatus === 'restricted') {
      await enqueue(pool, 'telegram.remove_member', { telegramUserId: String(u.userId), groupId: String(u.chatId) });
    }
  }

  async function processUpdate({ eventId }) {
    const ev = await getInboundEvent(pool, eventId);
    if (!ev || ev.status === 'processed') return;
    const p = ev.payload;
    if (p.kind === 'start') await onStart(p);
    else if (p.kind === 'join_request') await onJoinRequest(p);
    else if (p.kind === 'chat_member') await onChatMember(p);
    await markEvent(pool, ev.id, 'processed');
  }

  return { sendInvite, removeMember, processUpdate, onStart, onJoinRequest };
}
