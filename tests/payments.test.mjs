// Testes unitários do fluxo de pagamento e acesso. NÃO acessam banco de dados, Cakto, Telegram
// nem SMTP: o único banco existente é o de produção e nenhum teste pode gravar pedidos nele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { CAKTO_CHECKOUT_URL, ACCESS_PATH, CTA_POSITIONS, TESTIMONIALS, ACCESS_POLICY } from '../src/content/site.js';
import { checkoutAttrs, validateCheckout, validateTelegram, publishableTestimonials, renderPage } from '../vite.config.js';
import { verifyCaktoSignature, caktoDedupeKey } from '../backend/cakto-webhook.mjs';
import { toCents, normalizeOrder } from '../backend/cakto.mjs';
import { readConfig, dbOptions } from '../backend/config.mjs';
import { orderEligible, accessWindow, entitlementActive } from '../backend/access.mjs';
import { deriveCode } from '../backend/verification.mjs';
import { extractUpdate } from '../backend/telegram-webhook.mjs';
import { sanitizeError } from '../backend/jobs.mjs';
import { timeLabel, toPublicEvents, createSocialProofHandler } from '../backend/social-proof.mjs';
import { pickUtms, withUtms } from '../src/js/checkout.js';
import { parseEvents } from '../src/js/sales-activity.js';

const EXPECTED_CHECKOUT = 'https://pay.cakto.com.br/43y9aa2';

// ---------------------------------------------------------------- sem banco
test('todos os CTAs de compra usam exatamente o checkout informado, com a posição', () => {
  assert.equal(CAKTO_CHECKOUT_URL, EXPECTED_CHECKOUT);
  assert.equal(ACCESS_POLICY, 'lifetime');
  for (const pos of CTA_POSITIONS) {
    assert.equal(checkoutAttrs(pos), `href="${EXPECTED_CHECKOUT}" data-action-kind="purchase" data-cta-position="${pos}"`);
  }
  assert.throws(() => checkoutAttrs('rodape'), /posição/);
});

test('checkout inválido é recusado no build', () => {
  for (const bad of ['javascript:alert(1)', 'http://pay.cakto.com.br/x', 'https://evil.com/x', 'https://u:p@pay.cakto.com.br/x', 'data:text/html,x', 'https://pay.cakto.com.br/x?a=1']) {
    assert.throws(() => validateCheckout(bad), /checkout|URL/);
  }
});

test('convite de grupo do Telegram é recusado como contato e no HTML', () => {
  for (const invite of ['https://t.me/+abcDEF123', 'https://t.me/joinchat/abc', 'https://telegram.me/+x']) {
    assert.throws(() => validateTelegram(invite, 't'), /convites de grupo/);
  }
  assert.equal(validateTelegram('https://t.me/bruno', 't'), 'https://t.me/bruno');
  assert.throws(() => renderPage('<a href="https://t.me/+segredo">x</a>'), /convite/);
});

test('depoimentos: só verificados e autorizados; lista vazia não gera seção', () => {
  assert.deepEqual(TESTIMONIALS, []);
  const list = [
    { quote: 'a', name: 'n', verified: true, authorized: true },
    { quote: 'b', name: 'n', verified: true, authorized: false },
    { quote: 'c', name: 'n', verified: false, authorized: true },
    { quote: '', name: 'n', verified: true, authorized: true },
  ];
  assert.deepEqual(publishableTestimonials(list).map((t) => t.quote), ['a']);
  assert.equal(renderPage('{{testimonials}}'), '');
});

test('UTMs: só os cinco parâmetros conhecidos seguem para o checkout', () => {
  const u = pickUtms('?utm_source=ig&utm_medium=bio&gclid=x&email=a@b.com&utm_term=cpa&token=abc');
  assert.equal(u.toString(), 'utm_source=ig&utm_medium=bio&utm_term=cpa');
  assert.equal(withUtms(EXPECTED_CHECKOUT, u), `${EXPECTED_CHECKOUT}?utm_source=ig&utm_medium=bio&utm_term=cpa`);
  assert.equal(withUtms(EXPECTED_CHECKOUT, pickUtms('?fbclid=1')), EXPECTED_CHECKOUT);
});

test('prova social: rótulos de tempo e nenhum dado pessoal na resposta', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  assert.equal(timeLabel(new Date('2026-09-27T11:48:00Z'), now), 'há 12 min');
  assert.equal(timeLabel(new Date('2026-09-27T11:59:50Z'), now), 'há 1 min');
  assert.equal(timeLabel(new Date('2026-09-27T09:00:00Z'), now), 'há 3 h');
  assert.equal(timeLabel(new Date('2026-09-26T10:00:00Z'), now), 'há 1 dia');
  assert.equal(timeLabel(new Date('2026-09-20T10:00:00Z'), now), null, 'fora da janela');
  assert.equal(timeLabel(new Date('2026-09-28T10:00:00Z'), now), null, 'futuro');
  const events = toPublicEvents([new Date('2026-09-27T11:48:00Z')], now);
  assert.deepEqual(events, [{ type: 'access_approved', timeLabel: 'há 12 min' }]);
  assert.deepEqual(Object.keys(events[0]).sort(), ['timeLabel', 'type']);
});

test('prova social: sem banco configurado responde lista vazia, sem consultar nada', async () => {
  const handler = createSocialProofHandler({ cfg: { db: null, product: { caktoProductId: '' } }, getPool: () => assert.fail('não deve abrir banco') });
  let out;
  await handler({}, {}, (res, status, body) => (out = { status, body }));
  assert.deepEqual(out, { status: 200, body: [] });
});

test('faixa: o navegador só aceita eventos reais no formato esperado', () => {
  assert.deepEqual(parseEvents([{ type: 'access_approved', timeLabel: 'há 12 min' }]), ['Novo acesso confirmado • há 12 min']);
  assert.deepEqual(parseEvents([{ type: 'access_approved', timeLabel: '<img src=x>' }, { type: 'saque', timeLabel: 'há 1 min' }]), []);
  assert.deepEqual(parseEvents({ fake: true }), []);
});

test('HTML compilado (se houver build): checkout em todos os CTAs, sem convite e sem Telegram obrigatório', { skip: !existsSync('dist/index.html') }, () => {
  const html = readFileSync('dist/index.html', 'utf8');
  const purchase = [...html.matchAll(/<a [^>]*data-action-kind="purchase"[^>]*>/g)].map((m) => m[0]);
  assert.ok(purchase.length >= CTA_POSITIONS.length);
  for (const a of purchase) assert.match(a, /href="https:\/\/pay\.cakto\.com\.br\/43y9aa2"/);
  const positions = new Set(purchase.map((a) => /data-cta-position="([a-z_]+)"/.exec(a)[1]));
  assert.deepEqual([...positions].sort(), [...CTA_POSITIONS].sort());
  assert.ok((html.match(new RegExp(`href="${ACCESS_PATH}"`, 'g')) || []).length >= 2);
  assert.doesNotMatch(html, /t\.me\/\+|joinchat/);
  assert.doesNotMatch(html, /aria-disabled/);
});

function sign(secret, ts, raw) {
  return `v1=${createHmac('sha256', secret).update(`${ts}.`).update(raw).digest('hex')}`;
}

test('assinatura Cakto: ausente, inválida, antiga e corpo alterado falham', () => {
  const secret = 's3cr3t';
  const raw = Buffer.from('{"event":"purchase_approved","data":{}}');
  const now = Math.floor(Date.now() / 1000);
  const ts = String(now);
  assert.equal(verifyCaktoSignature({ secret, timestamp: ts, signature: sign(secret, ts, raw), raw, nowSec: now }), 'ok');
  assert.equal(verifyCaktoSignature({ secret, timestamp: undefined, signature: undefined, raw, nowSec: now }), 'missing');
  assert.equal(verifyCaktoSignature({ secret, timestamp: ts, signature: sign('outro', ts, raw), raw, nowSec: now }), 'mismatch');
  const old = String(now - 600);
  assert.equal(verifyCaktoSignature({ secret, timestamp: old, signature: sign(secret, old, raw), raw, nowSec: now }), 'stale');
  const altered = Buffer.from('{"event":"purchase_approved","data":{} }');
  assert.equal(verifyCaktoSignature({ secret, timestamp: ts, signature: sign(secret, ts, raw), raw: altered, nowSec: now }), 'mismatch');
  assert.equal(verifyCaktoSignature({ secret, timestamp: ts, signature: 'abc', raw, nowSec: now }), 'bad_format');
});

test('valores monetários viram centavos inteiros sem ponto flutuante', () => {
  assert.equal(toCents(49.99), 4999);
  assert.equal(toCents('49.99'), 4999);
  assert.equal(toCents('10'), 1000);
  assert.equal(toCents('0.105'), 11);
  assert.equal(toCents(null), null);
  assert.equal(toCents('abc'), null);
});

const product = { caktoProductId: 'prod-1', caktoOfferId: '', telegramGroupId: '-1001', policy: { kind: 'lifetime' } };
const paidOrder = { status: 'paid', verified_at: new Date(), paid_at: new Date('2026-01-01T00:00:00Z'), revoked_at: null, product_id: 'prod-1', offer_id: null };

test('regra de acesso: só pedido pago, confirmado na API, não revogado, do produto certo', () => {
  assert.equal(orderEligible(paidOrder, product), true);
  assert.equal(orderEligible({ ...paidOrder, verified_at: null }, product), false, 'webhook sem consulta à API não libera');
  assert.equal(orderEligible({ ...paidOrder, status: 'waiting_payment' }, product), false, 'pix gerado não libera');
  assert.equal(orderEligible({ ...paidOrder, revoked_at: new Date() }, product), false, 'reembolso é definitivo');
  assert.equal(orderEligible({ ...paidOrder, product_id: 'outro' }, product), false, 'produto desconhecido não libera');
  assert.equal(orderEligible(paidOrder, { ...product, policy: null }), false, 'sem política definida não libera');
});

test('acesso vitalício não tem fim; política por dias calcula o fim a partir do pagamento', () => {
  assert.deepEqual(accessWindow(paidOrder, { kind: 'lifetime' }), { startsAt: paidOrder.paid_at, endsAt: null });
  assert.equal(accessWindow(paidOrder, { kind: 'days', days: 30 }).endsAt.toISOString(), '2026-01-31T00:00:00.000Z');
  assert.equal(entitlementActive({ status: 'active', ends_at: null }), true);
  assert.equal(entitlementActive({ status: 'active', ends_at: new Date(Date.now() - 1000) }), false);
  assert.equal(entitlementActive({ status: 'revoked', ends_at: null }), false);
});

test('ACCESS_POLICY=lifetime é aceito; valores inventados são recusados', () => {
  assert.deepEqual(readConfig({ ACCESS_POLICY: 'lifetime' }).product.policy, { kind: 'lifetime' });
  assert.equal(readConfig({}).product.policy, null);
  assert.throws(() => readConfig({ ACCESS_POLICY: 'forever' }), /ACCESS_POLICY/);
});

test('conexão MySQL por DB_*: TLS ativo sem arquivo CA', () => {
  const o = dbOptions({ DB_HOST: 'h', DB_PORT: '3306', DB_NAME: 'bruno', DB_USER: 'u', DB_PASSWORD: 'p', DB_SSL: 'true' });
  assert.deepEqual(o.ssl, { rejectUnauthorized: false });
  assert.equal(o.database, 'bruno');
  assert.equal(dbOptions({ DB_HOST: 'h', DB_NAME: 'bruno', DB_USER: 'u' }).ssl, undefined);
});

test('reentrega do mesmo evento gera a mesma chave; reembolso gera outra', () => {
  const o = normalizeOrder({ id: 'b3df956e-1998-4322-b091-ac0c54f7b4ba', status: 'paid', paidAt: '2026-01-01T00:00:00Z', product: { id: 'p' }, customer: { email: 'A@B.com ' } });
  assert.equal(o.email, 'a@b.com');
  assert.equal(caktoDedupeKey('purchase_approved', o), caktoDedupeKey('purchase_approved', { ...o }));
  assert.notEqual(caktoDedupeKey('purchase_approved', o), caktoDedupeKey('refund', o));
  assert.throws(() => normalizeOrder({ id: '../x' }), /id/);
});

test('código de verificação: 8 dígitos, depende do segredo e do desafio', () => {
  const a = deriveCode('s'.repeat(32), 'a'.repeat(32));
  assert.match(a, /^\d{8}$/);
  assert.equal(a, deriveCode('s'.repeat(32), 'a'.repeat(32)));
  assert.notEqual(a, deriveCode('t'.repeat(32), 'a'.repeat(32)));
  assert.notEqual(a, deriveCode('s'.repeat(32), 'b'.repeat(32)));
});

test('updates do Telegram: só /start em conversa privada; pedido de entrada guarda o convite', () => {
  assert.equal(extractUpdate({ message: { chat: { id: -5, type: 'group' }, from: { id: 1 }, text: '/start x' } }), null);
  assert.equal(extractUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, text: 'oi' } }), null);
  assert.equal(extractUpdate({ message: { chat: { id: 1, type: 'private' }, from: { id: 1 }, text: '/start abc' } }).kind, 'start');
  const jr = extractUpdate({ chat_join_request: { chat: { id: -1001 }, from: { id: 7 }, date: 1, invite_link: { invite_link: 'https://t.me/+x', name: 'bacc-1' } } });
  assert.deepEqual([jr.kind, jr.chatId, jr.userId, jr.inviteName], ['join_request', '-1001', '7', 'bacc-1']);
});

test('erros gravados não expõem token do bot nem Bearer', () => {
  const msg = sanitizeError(new Error('falhou https://api.telegram.org/bot123:ABC_def/sendMessage Bearer abc.def'));
  assert.doesNotMatch(msg, /123:ABC_def|abc\.def/);
});
