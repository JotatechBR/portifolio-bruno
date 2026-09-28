// Configuração do bot lendo segredos do ambiente/.env (nada de token na linha de comando).
//   node tools/telegram-setup.mjs check         confere bot, grupo e permissões do bot no grupo
//   node tools/telegram-setup.mjs set-webhook   registra PUBLIC_SITE_URL/api/webhooks/telegram com o segredo
import { loadEnvFile, readConfig, requireConfig } from '../backend/config.mjs';
import { createTelegramClient } from '../backend/telegram.mjs';

loadEnvFile();
const cfg = readConfig();
const cmd = process.argv[2];
const call = createTelegramClient({ token: cfg.telegram.botToken });

try {
  if (cmd === 'check') {
    requireConfig(cfg, 'telegram');
    const me = await call('getMe');
    console.log(`bot: @${me.username} (id ${me.id})`, me.username === cfg.telegram.botUsername ? 'ok' : '!= TELEGRAM_BOT_USERNAME');
    const chat = await call('getChat', { chat_id: cfg.product.telegramGroupId });
    console.log(`grupo: ${chat.title} (${chat.type})`, chat.username ? `AVISO: grupo público @${chat.username}` : 'privado');
    if (chat.join_by_request === false || chat.join_by_request === undefined) console.log('info: o grupo não exige aprovação para todos os links; revise links antigos/permissões de convite.');
    const m = await call('getChatMember', { chat_id: cfg.product.telegramGroupId, user_id: me.id });
    const need = ['can_invite_users', 'can_restrict_members'];
    console.log(`status do bot no grupo: ${m.status}`);
    for (const p of need) console.log(`  ${p}: ${m[p] ? 'sim' : 'NÃO (necessário)'}`);
    const wh = await call('getWebhookInfo');
    console.log(`webhook: ${wh.url || '(nenhum)'}  pendentes: ${wh.pending_update_count}${wh.last_error_message ? `  último erro: ${wh.last_error_message}` : ''}`);
  } else if (cmd === 'set-webhook') {
    requireConfig(cfg, 'telegram', 'telegram-webhook', 'site');
    if (!cfg.siteUrl.startsWith('https://')) throw new Error('PUBLIC_SITE_URL precisa ser https para o webhook do Telegram');
    await call('setWebhook', {
      url: `${cfg.siteUrl}/api/webhooks/telegram`,
      secret_token: cfg.telegram.webhookSecret,
      allowed_updates: ['message', 'chat_join_request', 'chat_member', 'my_chat_member'],
      drop_pending_updates: false,
    });
    console.log(`webhook registrado em ${cfg.siteUrl}/api/webhooks/telegram`);
  } else {
    console.log('uso: node tools/telegram-setup.mjs check | set-webhook');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('falhou:', e.message);
  process.exitCode = 1;
}
