// Cliente da API pública da Cakto (OAuth2 client credentials) e normalização de pedidos.
// Contratos: https://docs.cakto.com.br/authentication e /api-reference/orders/retrieve
import { RetryableError, PermanentError } from './jobs.mjs';

export const CAKTO_API = 'https://api.cakto.com.br';
const ORDER_ID = /^[A-Za-z0-9-]{8,64}$/;
const TIMEOUT_MS = 10_000;

export class OrderNotFoundError extends PermanentError {
  constructor() {
    super('pedido não encontrado na Cakto');
    this.name = 'OrderNotFoundError';
  }
}

// Valor monetário (número ou texto decimal) -> centavos inteiros, sem aritmética de ponto flutuante.
export function toCents(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const frac = (m[3] || '').padEnd(3, '0');
  let cents = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1n; // arredonda meia unidade para cima
  const n = Number(m[1] ? -cents : cents);
  return Number.isSafeInteger(n) ? n : null;
}

export const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
export const isEmail = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function date(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Extrai só os campos necessários de um pedido (webhook ou API). Lança se faltar o essencial.
export function normalizeOrder(d) {
  if (!d || typeof d !== 'object') throw new PermanentError('pedido inválido');
  const id = typeof d.id === 'string' ? d.id : '';
  if (!ORDER_ID.test(id)) throw new PermanentError('pedido sem id válido');
  const productId = d.product && typeof d.product.id === 'string' ? d.product.id : '';
  const email = normalizeEmail(d.customer && d.customer.email);
  return {
    caktoOrderId: id,
    productId,
    offerId: d.offer && typeof d.offer.id === 'string' ? d.offer.id.slice(0, 64) : null,
    productName: d.product && typeof d.product.name === 'string' ? d.product.name.slice(0, 160) : null,
    email: isEmail(email) ? email : '',
    status: typeof d.status === 'string' ? d.status.slice(0, 32) : 'unknown',
    amountCents: toCents(d.amount),
    paidAt: date(d.paidAt),
    refundedAt: date(d.refundedAt),
    chargedbackAt: date(d.chargedbackAt),
    createdAt: date(d.createdAt),
  };
}

export function createCaktoClient({ clientId, clientSecret, baseUrl = CAKTO_API, fetchImpl = fetch }) {
  let token = null; // { value, expiresAt }

  async function request(url, init) {
    try {
      return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      throw new RetryableError(`Cakto indisponível (${e.name || 'rede'})`);
    }
  }

  async function getToken() {
    if (token && token.expiresAt > Date.now()) return token.value;
    if (!clientId || !clientSecret) throw new RetryableError('credenciais da API Cakto não configuradas');
    const res = await request(`${baseUrl}/public_api/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret }).toString(),
    });
    if (!res.ok) throw new RetryableError(`token Cakto recusado (HTTP ${res.status})`);
    const body = await res.json().catch(() => ({}));
    if (typeof body.access_token !== 'string') throw new RetryableError('resposta de token Cakto inválida');
    const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    // renova um pouco antes de expirar
    token = { value: body.access_token, expiresAt: Date.now() + Math.max(30, ttl - 120) * 1000 };
    return token.value;
  }

  async function getOrder(id) {
    if (!ORDER_ID.test(id)) throw new PermanentError('id de pedido inválido');
    for (let attempt = 0; attempt < 2; attempt++) {
      const t = await getToken();
      const res = await request(`${baseUrl}/public_api/orders/${encodeURIComponent(id)}/`, {
        headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' },
      });
      if (res.status === 401 && attempt === 0) {
        token = null; // token revogado/expirado: renova uma vez
        continue;
      }
      if (res.status === 404) throw new OrderNotFoundError();
      if (!res.ok) throw new RetryableError(`consulta de pedido Cakto falhou (HTTP ${res.status})`);
      const body = await res.json().catch(() => null);
      if (!body) throw new RetryableError('resposta de pedido Cakto inválida');
      return body;
    }
    throw new RetryableError('token Cakto recusado');
  }

  return { getOrder };
}
