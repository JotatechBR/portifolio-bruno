// POST /api/webhooks/telegram: valida o secret_token, deduplica update_id e grava evento + tarefa
// antes de responder 2xx.
import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, readBody, requireJsonType, parseJson, sendJson } from './http.mjs';
import { withTransaction } from './db.mjs';
import { enqueue, requeueFailed } from './jobs.mjs';
import { insertInboundEvent } from './repositories.mjs';

const same = (a, b) =>
  timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

const id = (v) => (Number.isSafeInteger(v) ? String(v) : null);

// Extrai só o necessário de cada tipo de update. null = update sem interesse.
export function extractUpdate(u) {
  if (u.message && u.message.chat && u.message.from) {
    const m = u.message;
    if (m.chat.type !== 'private' || typeof m.text !== 'string' || !m.text.startsWith('/start')) return null;
    return { kind: 'start', chatId: id(m.chat.id), fromId: id(m.from.id), text: m.text.slice(0, 120) };
  }
  if (u.chat_join_request && u.chat_join_request.chat && u.chat_join_request.from) {
    const r = u.chat_join_request;
    return {
      kind: 'join_request',
      chatId: id(r.chat.id),
      userId: id(r.from.id),
      date: Number(r.date) || 0,
      inviteName: r.invite_link && typeof r.invite_link.name === 'string' ? r.invite_link.name.slice(0, 32) : null,
      inviteLink: r.invite_link && typeof r.invite_link.invite_link === 'string' ? r.invite_link.invite_link.slice(0, 255) : null,
    };
  }
  if (u.chat_member && u.chat_member.chat && u.chat_member.new_chat_member?.user) {
    const c = u.chat_member;
    return {
      kind: 'chat_member',
      chatId: id(c.chat.id),
      userId: id(c.new_chat_member.user.id),
      newStatus: String(c.new_chat_member.status || '').slice(0, 16),
      newIsMember: Boolean(c.new_chat_member.is_member),
    };
  }
  if (u.my_chat_member && u.my_chat_member.chat) {
    // permissões do bot mudaram: só registro para acompanhamento
    return {
      kind: 'my_chat_member',
      chatId: id(u.my_chat_member.chat.id),
      newStatus: String(u.my_chat_member.new_chat_member?.status || '').slice(0, 16),
    };
  }
  return null;
}

export function createTelegramWebhookHandler({ cfg, pool }) {
  return async function handle(req, res) {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (typeof header !== 'string' || !same(header, cfg.telegram.webhookSecret)) throw new HttpError(401, 'invalid_secret');
    requireJsonType(req);
    const update = parseJson(await readBody(req, 256 * 1024));
    if (!update || !Number.isSafeInteger(update.update_id)) throw new HttpError(400, 'invalid_update');

    const data = extractUpdate(update);
    await withTransaction(pool, async (conn) => {
      const actionable = Boolean(data && data.kind !== 'my_chat_member' && data.chatId && (data.fromId || data.userId));
      const ev = await insertInboundEvent(conn, {
        source: 'telegram',
        dedupeKey: `tg:${update.update_id}`,
        eventType: data ? data.kind : 'other',
        externalRef: String(update.update_id),
        payload: data || {},
        status: actionable ? 'received' : 'ignored',
      });
      if (!actionable) return;
      if (ev.inserted) await enqueue(conn, 'telegram.update', { eventId: String(ev.id) }, { dedupeKey: `event:${ev.id}` });
      else await requeueFailed(conn, { dedupeKey: `event:${ev.id}` });
    });
    sendJson(res, 200, { ok: true });
  };
}
