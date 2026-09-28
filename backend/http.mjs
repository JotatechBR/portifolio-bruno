// Helpers HTTP para node:http: corpo com limite, JSON, cookies, IP e respostas.
import { parseCookie, stringifySetCookie } from 'cookie';

export class HttpError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Lê o stream uma única vez e devolve os bytes originais (necessários para a assinatura).
export function readBody(req, limit = 64 * 1024) {
  return new Promise((resolvePromise, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, 'body_too_large'));
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        reject(new HttpError(413, 'body_too_large'));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolvePromise(Buffer.concat(chunks));
      }
    });
    req.on('error', (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}

export function requireJsonType(req) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'unsupported_media_type');
}

export function parseJson(buf) {
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

// Aceita só os campos esperados, todos string.
export function pickStrings(obj, fields) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new HttpError(400, 'invalid_body');
  const out = {};
  for (const [name, max] of Object.entries(fields)) {
    const v = obj[name];
    if (typeof v !== 'string' || v.length > max) throw new HttpError(400, 'invalid_body');
    out[name] = v;
  }
  return out;
}

export function sendJson(res, status, body, headers = {}) {
  if (res.headersSent || res.writableEnded) return;
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}

export function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  return parseCookie(raw)[name] || null;
}

export function sessionCookie(cfg, value, maxAgeSec) {
  return stringifySetCookie({
    name: cfg.cookie.name,
    value,
    path: '/',
    httpOnly: true,
    secure: cfg.cookie.secure,
    sameSite: 'strict',
    maxAge: maxAgeSec,
  });
}

// IP do cliente. X-Forwarded-For só é considerado com TRUST_PROXY_HOPS configurado:
// usa o endereço acrescentado pelo proxy de confiança mais externo (contando da direita).
export function clientIp(req, hops) {
  if (hops > 0) {
    const list = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length >= hops) return list[list.length - hops].slice(0, 64);
  }
  return String(req.socket.remoteAddress || 'unknown').slice(0, 64);
}

// Proteção CSRF: Origin precisa ser o próprio site (cookie também é SameSite=Strict).
export function requireSameOrigin(req, cfg) {
  const origin = req.headers.origin;
  if (!origin || !cfg.origins.has(origin)) throw new HttpError(403, 'forbidden_origin');
}
