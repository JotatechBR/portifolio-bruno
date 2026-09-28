// E-mails transacionais via SMTP (Nodemailer). Só texto de ativação: sem campanhas.
import nodemailer from 'nodemailer';
import { RetryableError } from './jobs.mjs';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function createMailer(cfg, transport) {
  const t =
    transport ||
    (cfg.smtp.host
      ? nodemailer.createTransport({
          host: cfg.smtp.host,
          port: cfg.smtp.port,
          secure: cfg.smtp.port === 465,
          requireTLS: cfg.smtp.port !== 465,
          auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 20_000,
        })
      : null);

  async function send(msg) {
    if (!t || !cfg.smtp.from) throw new RetryableError('SMTP não configurado');
    try {
      await t.sendMail({ from: cfg.smtp.from, ...msg });
    } catch (e) {
      // 5xx permanentes (endereço inexistente) também voltam à fila, com limite de tentativas do job
      throw new RetryableError(`envio SMTP falhou (${e.responseCode || e.code || 'erro'})`);
    }
  }

  return {
    async sendAccessInstructions(to) {
      const url = `${cfg.siteUrl}/acesso/`;
      await send({
        to,
        subject: 'Seu acesso com Bruno',
        text:
          'Seu pagamento foi confirmado. Para ativar o acesso, abra o link abaixo e use o mesmo e-mail informado na compra.\n\n' +
          `Ativar meu acesso: ${url}\n`,
        html: `<p>Seu pagamento foi confirmado. Para ativar o acesso, abra o link abaixo e use o mesmo e-mail informado na compra.</p>
<p><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;background:#c9102d;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:600">Ativar meu acesso</a></p>
<p style="color:#555">Se o botão não abrir, copie este endereço: ${esc(url)}</p>`,
      });
    },

    async sendCode(to, code) {
      await send({
        to,
        subject: `Seu código de ativação: ${code}`,
        text:
          `Seu código para ativar o acesso é: ${code}\n\n` +
          'Ele vale por 10 minutos e foi solicitado na página de ativação de acesso do Bruno.\n' +
          'Se você não fez essa solicitação, ignore este e-mail.\n',
        html: `<p>Seu código para ativar o acesso é:</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">${esc(code)}</p>
<p>Ele vale por 10 minutos e foi solicitado na página de ativação de acesso do Bruno.</p>
<p style="color:#555">Se você não fez essa solicitação, ignore este e-mail.</p>`,
      });
    },
  };
}
