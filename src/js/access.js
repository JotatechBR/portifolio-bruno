// Página /acesso/: confirma o e-mail da compra e conecta o Telegram.
// Não decide nada sobre pagamento: só mostra o que a API autenticada responde.
// Nada de código, sessão ou token em localStorage; o challenge_id fica só na memória da página.

const API = '/api/access';
const TIMEOUT_MS = 12000;
const POLL_MS = 15000;
const POLL_MAX = 8;
const BOT_URL = /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{3,31}$/;
const LINK_URL = /^https:\/\/t\.me\/[A-Za-z][A-Za-z0-9_]{3,31}\?start=[A-Za-z0-9_-]{1,64}$/;

const MSG = {
  codeSent: 'Se identificarmos uma compra para esse e-mail, enviaremos um código. Confira também a pasta de spam.',
  temporary: 'Não foi possível concluir agora. Tente novamente em instantes.',
  expired: 'O código expirou. Solicite um novo.',
  invalidCode: 'Código incorreto. Confira e tente novamente.',
  locked: 'Muitas tentativas com este código. Solicite um novo.',
  tooMany: 'Muitas solicitações. Aguarde alguns minutos e tente novamente.',
  wait: 'Aguarde um minuto antes de pedir outro código.',
  badEmail: 'Informe um e-mail válido.',
  badCode: 'Digite os 8 números do código.',
  sessionEnded: 'Sua verificação expirou. Confirme o e-mail novamente.',
};

const STATE = {
  pending: 'Ainda não recebemos a confirmação. Se você acabou de pagar, aguarde e tente novamente.',
  available: 'Seu acesso está disponível.',
  linked: 'Abra o bot no Telegram para concluir sua entrada.',
  active: 'Seu acesso já foi ativado.',
  inactive: 'Este acesso não está ativo.',
};

const $ = (sel) => document.querySelector(sel);
const steps = {
  email: $('[data-step="email"]'),
  code: $('[data-step="code"]'),
  status: $('[data-step="status"]'),
};
const message = $('[data-message]');
const emailForm = $('[data-form="email"]');
const codeForm = $('[data-form="code"]');
const list = $('[data-accesses]');

let challengeId = null;
let pollTimer = null;
let pollCount = 0;

function say(text, tone = 'info') {
  message.textContent = text || '';
  message.dataset.tone = tone;
}

function show(step, { focus = true } = {}) {
  for (const [name, el] of Object.entries(steps)) el.hidden = name !== step;
  if (focus) steps[step].querySelector('h2')?.focus();
}

// fetch com tempo limite; nunca lança: erro de rede vira { network: true }
async function api(path, { method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}/${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* resposta sem JSON */
    }
    return { status: res.status, ok: res.ok, data: data || {} };
  } catch {
    return { status: 0, ok: false, network: true, data: {} };
  } finally {
    clearTimeout(timer);
  }
}

// trava o botão de envio durante a requisição
async function busy(form, fn) {
  const btn = form.querySelector('button[type="submit"]');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    await fn();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

function markInvalid(input, invalid) {
  if (invalid) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

emailForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = emailForm.elements.email;
  const email = input.value.trim();
  const valid = email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  markInvalid(input, !valid);
  if (!valid) {
    say(MSG.badEmail, 'error');
    input.focus();
    return;
  }
  busy(emailForm, async () => {
    say('');
    const r = await api('request-code', { method: 'POST', body: { email } });
    if (r.ok && typeof r.data.challenge_id === 'string') {
      challengeId = r.data.challenge_id;
      codeForm.reset();
      show('code');
      say(MSG.codeSent);
    } else if (r.status === 429) {
      say(r.data.error === 'resend_wait' ? MSG.wait : MSG.tooMany, 'error');
    } else if (r.status === 400) {
      markInvalid(input, true);
      say(MSG.badEmail, 'error');
    } else {
      say(MSG.temporary, 'error');
    }
  });
});

codeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = codeForm.elements.code;
  const code = input.value.replace(/\D/g, ''); // aceita colar com espaços ou hífen
  const valid = code.length === 8;
  markInvalid(input, !valid);
  if (!valid) {
    say(MSG.badCode, 'error');
    input.focus();
    return;
  }
  if (!challengeId) {
    show('email');
    say(MSG.expired, 'error');
    return;
  }
  busy(codeForm, async () => {
    say('');
    const r = await api('verify-code', { method: 'POST', body: { challenge_id: challengeId, code } });
    if (r.ok) {
      challengeId = null;
      await loadStatus({ focus: true });
      return;
    }
    const err = r.data.error;
    if (err === 'expired' || err === 'locked' || err === 'invalid_challenge') {
      challengeId = null;
      show('email');
      say(err === 'locked' ? MSG.locked : MSG.expired, 'error');
    } else if (err === 'invalid_code') {
      markInvalid(input, true);
      say(MSG.invalidCode, 'error');
      input.select();
    } else if (r.status === 429) {
      say(MSG.tooMany, 'error');
    } else {
      say(MSG.temporary, 'error');
    }
  });
});

$('[data-restart]').addEventListener('click', () => {
  challengeId = null;
  show('email');
  say('');
});

function renderAccesses(data) {
  $('[data-email-label]').textContent = data.email ? `E-mail confirmado: ${data.email}` : '';
  list.replaceChildren();
  const items = Array.isArray(data.accesses) && data.accesses.length ? data.accesses : [{ state: 'pending' }];
  const botUrl = typeof data.bot_url === 'string' && BOT_URL.test(data.bot_url) ? data.bot_url : null;

  for (const acc of items) {
    const li = document.createElement('li');
    li.className = 'access-item';
    if (acc.product) {
      const name = document.createElement('p');
      name.className = 'access-item__name';
      name.textContent = acc.product;
      li.append(name);
    }
    const state = document.createElement('p');
    state.className = 'access-item__state';
    state.textContent = STATE[acc.state] || STATE.pending;
    li.append(state);

    const actions = document.createElement('div');
    actions.className = 'access-item__actions';
    if ((acc.state === 'available' || acc.state === 'linked') && typeof acc.ref === 'string') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = acc.state === 'available' ? 'btn btn--primary' : 'access-link-button';
      btn.textContent = acc.state === 'available' ? 'Conectar meu Telegram' : 'Gerar novo link do Telegram';
      btn.addEventListener('click', () => connectTelegram(acc.ref, btn, li));
      actions.append(btn);
      if (acc.state === 'linked' && botUrl) actions.prepend(botLink(botUrl, 'Abrir o bot no Telegram', true));
    } else if (acc.state === 'active' && botUrl) {
      actions.append(botLink(botUrl, 'Abrir o bot no Telegram', true));
    }
    if (actions.childElementCount) li.append(actions);
    if (acc.state === 'available') {
      const hint = document.createElement('p');
      hint.className = 'access-item__hint';
      hint.textContent = 'No Telegram, toque em Iniciar para o bot liberar sua entrada no grupo.';
      li.append(hint);
    }
    list.append(li);
  }
  return items.some((a) => a.state === 'pending' || a.state === 'linked');
}

function botLink(href, text, primary) {
  const a = document.createElement('a');
  a.className = primary ? 'btn btn--primary' : 'access-link-button';
  a.href = href;
  a.rel = 'noopener';
  a.textContent = text;
  return a;
}

async function connectTelegram(ref, btn, li) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  try {
    const r = await api('telegram-link', { method: 'POST', body: { ref } });
    if (r.status === 401) {
      show('email');
      say(MSG.sessionEnded, 'error');
      return;
    }
    const url = r.ok && typeof r.data.url === 'string' && LINK_URL.test(r.data.url) ? r.data.url : null;
    if (!url) {
      say(r.status === 409 ? STATE.inactive : MSG.temporary, 'error');
      if (r.status === 409) loadStatus({ focus: false });
      return;
    }
    const link = botLink(url, 'Abrir o Telegram e tocar em Iniciar', true);
    btn.replaceWith(link);
    li.querySelector('.access-item__hint')?.remove();
    const hint = document.createElement('p');
    hint.className = 'access-item__hint';
    hint.textContent = 'O link vale por 10 minutos. Depois de tocar em Iniciar, o bot envia o convite para o grupo.';
    li.append(hint);
    link.focus();
    say('Link do Telegram pronto.');
    startPolling();
  } finally {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
  }
}

async function loadStatus({ focus, fromPoll = false }) {
  const r = await api('status');
  if (r.status === 401) {
    stopPolling();
    show('email', { focus });
    return false;
  }
  if (!r.ok) {
    say(MSG.temporary, 'error');
    return null;
  }
  const waiting = renderAccesses(r.data);
  show('status', { focus });
  say('');
  if (!waiting) stopPolling();
  else if (!fromPoll) startPolling();
  return waiting ? 'waiting' : true;
}

// atualização automática limitada; pausa com a aba oculta
function startPolling() {
  if (pollTimer) return;
  pollCount = 0;
  schedule();
}
function schedule() {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    if (document.hidden) return; // retoma em visibilitychange
    pollCount += 1;
    const r = await loadStatus({ focus: false, fromPoll: true });
    if (r === 'waiting' && pollCount < POLL_MAX) schedule();
  }, POLL_MS);
}
function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !steps.status.hidden && pollCount < POLL_MAX && !pollTimer) schedule();
});

$('[data-refresh]').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    pollCount = 0;
    await loadStatus({ focus: false });
  } finally {
    btn.disabled = false;
  }
});

$('[data-logout]').addEventListener('click', async () => {
  stopPolling();
  await api('logout', { method: 'POST', body: {} });
  show('email');
  say('Você saiu.');
});

// retoma a sessão existente, se houver
loadStatus({ focus: false }).then((ok) => {
  if (ok === null) show('email', { focus: false });
});
