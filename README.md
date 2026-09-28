# Bruno — Comunidade privada de CPA Chinês e Bets

Página de vendas do acesso vitalício ao grupo privado do Bruno no Telegram. Compra pela Cakto,
liberação só depois do webhook validado no servidor, ativação individual pelo bot.
Vite + HTML semântico + CSS + JS modular.
Three.js só é carregado (import dinâmico) pela cena 3D opcional do hero.

## Comandos

```bash
npm install
npm run dev        # desenvolvimento em http://localhost:5173
npm run build      # versão de produção em dist/
npm run preview    # serve dist/ localmente (Vite)
node server        # ou npm start: serve dist/ em http://localhost:3000 (PORT=xxxx para mudar)
npm run assets     # regenera GLB + renders (AVIF/WebP) + imagem Open Graph
npm run fonts      # recopia as fontes WOFF2 para public/fonts
node tools/screenshots.mjs 390,1440 --full   # capturas de revisão (após o build)
node tools/checks.mjs                        # menu, foco, sem JS, compra/contato, contraste, bytes
node tools/screenshots.mjs 390,1440 --full --path=/acesso/   # capturas da página de ativação
```

Pagamento e ativação (detalhes em "Pagamento e ativação"):

```bash
npm run dev:api          # servidor Node (API /api) na 3000, usado pelo Vite via proxy
npm run db:migrate       # cria/atualiza as tabelas no MySQL (idempotente, nunca apaga dados)
npm run worker           # processo da fila: Cakto, e-mails, Telegram, vencimentos
npm run check:payments   # verificação técnica do build, das rotas e da configuração (sem valores)
npm run test:payments    # testes unitários (não acessam o banco)
npm run telegram:check   # confere bot, grupo e permissões do bot
npm run telegram:webhook # registra o webhook do bot com o segredo
```

`assets`, `screenshots` e `checks` usam o Chrome instalado (`CHROME_PATH` para outro caminho).

## Alterar textos, checkout e ofertas

Tudo fica em `src/content/site.js`; o build grava o conteúdo direto no HTML (a página funciona
sem JavaScript):

- `CAKTO_CHECKOUT_URL`: fonte única da compra (`https://pay.cakto.com.br/43y9aa2`). Todos
  os CTAs de compra usam esse endereço, marcados com `data-cta-position` (`hero`, `header`,
  `how_it_works`, `offer`, `mobile_sticky`, `final`). O build só aceita `https://pay.cakto.com.br/...`
  e não depende de `TELEGRAM_URL`. No navegador, só `utm_source`, `utm_medium`, `utm_campaign`,
  `utm_content` e `utm_term` da URL atual são repassados ao checkout.
- `ACCESS_POLICY`: precisa ser `lifetime` (o texto anuncia acesso vitalício e deve bater com o
  `.env` do servidor).
- `PRICE_LABEL`: vazio = a oferta mostra "Condição disponível no checkout". Preencha só com o valor
  real cadastrado na Cakto.
- `COPY`, `CTA`, `BENEFITS`, `FIT`, `STEPS`, `OFFER_INCLUDES`, `FAQ`, `TICKER_MESSAGES`, `NAV`,
  `LEGAL_LINKS`: textos da página. `
` nos títulos é uma quebra de linha intencional.
- `TESTIMONIALS`: só depoimentos reais com `verified: true` e `authorized: true`. Lista vazia = a
  seção não existe na página.
- `TELEGRAM_URL`: contato pessoal do Bruno (pendente; vazio = nenhum contato exibido). Convites de
  grupo (`t.me/+...`, `joinchat`) interrompem o build, no HTML e em qualquer arquivo do bundle.
- `GA4_MEASUREMENT_ID`: vazio = nenhum script de métricas. Com um ID, a página envia
  `checkout_click` (com `cta_position`), `activation_click` e `faq_open`; falhas nunca bloqueiam
  a navegação.
- `SITE_URL`: domínio definitivo; ativa `canonical` e URLs absolutas de Open Graph.
- `ACCESS_PATH`: página de ativação (`/acesso/`).

Páginas institucionais: `termos/`, `privacidade/` e `reembolso/` (sem prazos inventados: o
reembolso remete às condições cadastradas na Cakto).

### Faixa de atividade (prova social real)

A faixa do topo mostra mensagens institucionais fixas. O navegador consulta
`GET /api/social-proof/recent` (`backend/social-proof.mjs`), que só devolve pedidos do produto
configurado que chegaram por `purchase_approved`, foram confirmados na API da Cakto, estão pagos,
não foram revogados e têm até 48 h. A resposta é `[{ "type": "access_approved", "timeLabel": "há 12 min" }]`,
sem nome, e-mail, valor ou ID, com cache de 60 s. Sem eventos (ou sem banco), a faixa continua só
com as mensagens fixas; nada é gerado no navegador.

Depois de editar, rode `npm run build`.

## Pagamento e ativação

Fluxo: o visitante paga no checkout da Cakto → a Cakto envia o webhook assinado → o backend grava
o evento e uma tarefa → o worker consulta o pedido na API da Cakto (só concede com o pedido
confirmado como pago, do produto configurado) → cria o direito de acesso e envia o e-mail
"Seu acesso com Bruno" → o comprador abre `/acesso/`, informa o e-mail da compra, recebe um código
de 8 dígitos e confirma → toca em "Conectar meu Telegram" → no bot, toca em Iniciar → o bot vincula
a conta à compra e envia um convite pessoal (10 min, com solicitação de entrada) → quando a mesma
conta pede para entrar, o bot confere o direito de novo e aprova. Reembolso, chargeback e fim do
prazo revogam o direito e removem a conta do grupo, a menos que ela tenha outra compra válida.

Não depende do redirect pós-pagamento da Cakto: o e-mail e o link "Já comprei" levam a `/acesso/`.
Se a conta tiver o redirect, configure o retorno para `https://SEU_DOMINIO/acesso/` (é só
navegação; não prova pagamento).

### Configuração (variáveis privadas)

Copie `.env.example` para `.env` no servidor e preencha (o arquivo explica cada campo). O `.env` é
lido por `server.js`, pelo worker e pelas ferramentas; nunca vai para `dist/` nem para o Git.
Segredos nunca usam prefixo `VITE_`.

1. **Banco**: MySQL 8. `DATABASE_URL=mysql://usuario:senha@host:3306/banco` ou as variáveis
   `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` (já usadas no `.env`),
   depois `npm run db:migrate`.
2. **Produto**: `CAKTO_PRODUCT_ID` (painel da Cakto; também aparece em `data.product.id` do
   webhook). Opcional: `CAKTO_OFFER_ID`. **`ACCESS_POLICY`** (`lifetime` ou `days:N`, contado a
   partir do pagamento): sem ela, pagamentos ficam registrados mas nenhum acesso é concedido.
3. **Webhook Cakto**: no painel, crie o webhook para `https://SEU_DOMINIO/api/webhooks/cakto`,
   produto CPA CHINES, eventos `purchase_approved`, `purchase_refused`, `refund`, `chargeback`,
   `pix_gerado`, `boleto_gerado`. Copie o segredo mostrado pelo painel para `CAKTO_WEBHOOK_SECRET`.
   A validação usa `X-Cakto-Timestamp` + `X-Cakto-Signature` (HMAC-SHA256, tolerância de 5 min).
4. **API Cakto**: crie uma credencial com escopo de leitura de pedidos e preencha
   `CAKTO_CLIENT_ID`/`CAKTO_CLIENT_SECRET`.
5. **Bot**: crie com o @BotFather (`/newbot`), preencha `TELEGRAM_BOT_TOKEN` e
   `TELEGRAM_BOT_USERNAME` (sem @). Adicione o bot ao grupo privado como administrador com
   "Convidar usuários via link" e "Banir usuários". Para o `TELEGRAM_GROUP_ID` (negativo, ex.
   `-100…`; o grupo não precisa de username): encaminhe uma mensagem do grupo para um bot de ID ou
   veja `chat.id` em uma atualização. Confira tudo com `npm run telegram:check`.
6. **Webhook do bot**: gere `TELEGRAM_WEBHOOK_SECRET` (ex.:
   `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`), defina
   `PUBLIC_SITE_URL` e rode `npm run telegram:webhook`.
7. **E-mail**: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`. Configure SPF e
   DKIM do domínio do remetente no provedor de e-mail. Teste enviando um código para um e-mail
   de uma compra de teste em ambiente de homologação.
8. **Códigos**: `OTP_HASH_SECRET` com 32+ caracteres aleatórios.

Revise os links de convite antigos e as permissões do grupo: se o grupo tiver um link permanente
público ou membros que possam convidar livremente, a restrição por compra não está completa. O
bot não revoga links de terceiros nem remove membros antigos.

### Execução

Desenvolvimento (três terminais):

```bash
npm run dev       # site em http://localhost:5173 (encaminha /api para a 3000; API_PORT muda a porta)
npm run dev:api   # API na 3000 (sem dist/, serve só /api)
npm run worker    # fila
```

Em desenvolvimento via http, defina `ACCESS_INSECURE_COOKIES=1` e `NODE_ENV=development` no `.env`
local para o cookie de sessão funcionar sem HTTPS (proibido em produção).

Produção (servidor Node persistente):

```bash
npm ci && npm run build && npm run db:migrate
npm start         # site + API na PORT (atrás de HTTPS; ajuste TRUST_PROXY_HOPS ao proxy)
npm run worker    # processo separado, supervisionado (systemd, pm2 ou serviço da hospedagem)
```

`npm run preview` só serve arquivos estáticos: não é o servidor de produção da API. Sem o worker
rodando, pagamentos ficam gravados mas acessos, e-mails e ações do bot não acontecem.

### Acompanhamento e reprocessamento

- Tarefas com falha: `SELECT id, type, attempts, last_error FROM jobs WHERE status = 'failed';`
- Reprocessar uma tarefa (depois de corrigir a causa):
  `UPDATE jobs SET status='pending', attempts=0, run_at=NOW(3) WHERE id = ?;`
- Eventos recebidos: tabela `inbound_events` (dados mínimos; eventos de teste com pedido
  inexistente ficam como `ignored`).
- Uma conta já vinculada a uma compra não é transferida automaticamente para outra conta do
  Telegram: a troca é manual, após conferir a compra.

### Limitações conhecidas

- Não impede que o comprador compartilhe a própria conta do Telegram; impede que um convite
  compartilhado autorize outra conta.
- Eventos de assinatura são registrados e ignorados: o produto é de pagamento único.
- A Cakto não reenvia automaticamente respostas não-2xx; falhas de configuração (HTTP 503) exigem
  reenvio pelo painel/API da Cakto depois de corrigidas.

## Estrutura

```
index.html               conteúdo essencial (gerado com os dados de site.js no build)
vite.config.js           plugin que monta as páginas a partir de site.js (CTAs, FAQ, faixa, monograma),
                         bloqueia convites do grupo; páginas: home, /acesso/, /termos/,
                         /privacidade/, /reembolso/; proxy de /api no desenvolvimento
termos/, privacidade/, reembolso/   páginas institucionais
src/content/site.js      configuração central (inclui checkout e caminho de ativação)
acesso/index.html        página de ativação (sem 3D)
src/js/access.js         interface da ativação (e-mail, código, Telegram)
src/styles/access.css    estilos da ativação, restritos a .access-page
server.js                servidor de produção: /api + arquivos de dist/
backend/                 API, webhooks, fila, Cakto, e-mail, Telegram (só servidor)
migrations/              SQL incremental (npm run db:migrate)
tests/payments.test.mjs  testes do pagamento, do acesso, da página e da prova social (sem banco)
tools/checks-payments.mjs, tools/telegram-setup.mjs, tools/migrate-payments.mjs
src/styles/tokens.css    cores, tipografia, espaço, raio, movimento
src/styles/main.css      layout e componentes
src/js/                  cabeçalho, menu (<dialog>), entradas, carregador do 3D, checkout (UTMs +
                         métricas), faq, sticky-cta (CTA móvel), sales-activity (faixa)
src/three/               palco compartilhado (luz, câmera, ambiente), desenho do B, cena do hero
tools/studio/            modelagem procedural + estúdio de render (Chrome headless)
tools/render-assets.mjs  pipeline de assets
public/                  fontes, modelo GLB, imagens, favicon
```

## Assets e licenças

- **Monograma B e fichas**: desenho e modelagem próprios deste projeto (`src/three/monogram-shape.js`,
  `tools/studio/build-models.js`). Geometria em polígonos com chanfros, sem fonte extrudada.
  Renders feitos com Three.js a partir do mesmo GLB que o site carrega. Iluminação por softboxes
  procedurais (sem HDR de terceiros). É uma proposta visual, não uma marca registrada de Bruno.
- **Barlow Condensed** (600, 700) e **Manrope** (400, 600): SIL Open Font License 1.1, via
  pacotes @fontsource; licenças em `public/fonts/LICENSE-*.txt`. Subconjunto latin (U+0000–00FF),
  cobre todos os acentos do português.
- **Three.js**: licença MIT.
- **Foto de Bruno**: fornecida pelo cliente. Original em `tools/source/bruno-original.jpeg`
  (fora de `public/`, não é publicado). Tratamento (recorte 3:4, P&B, vinheta) em
  `node tools/process-photo.mjs [foto]`, que gera `public/img/bruno-600/900.avif|webp`.
  Para trocar a foto, rode o script com o novo arquivo e ajuste `CROP` se o enquadramento mudar.
