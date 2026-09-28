// Configuração central da página de vendas.
// Todo o conteúdo comercial fica aqui; o HTML é gerado a partir destes dados no build
// (vite.config.js), então a página funciona completa sem JavaScript.
//
// Regras deste arquivo (só dados PÚBLICOS):
// - nunca coloque o convite do grupo (t.me/+... ou joinchat): o build recusa;
// - nunca coloque segredos: eles ficam no .env do servidor;
// - não invente números, resultados, prazos, garantias ou depoimentos.

// ---------------------------------------------------------------- produto e compra

// Checkout hospedado na Cakto: fonte única da URL de compra. Todos os CTAs de compra usam
// exatamente este endereço (o navegador só acrescenta utm_* presentes na URL da página).
export const CAKTO_CHECKOUT_URL = 'https://pay.cakto.com.br/36vbbvz_1136589';

// Política de acesso anunciada. Precisa refletir ACCESS_POLICY do servidor (hoje "lifetime").
export const ACCESS_POLICY = 'lifetime';

// Preço exibido na oferta. Vazio = não há valor confirmado aqui; a página mostra PRICE_FALLBACK.
// Preencha somente com o valor real cadastrado na Cakto (ex.: 'R$ 97').
export const PRICE_LABEL = '';
export const PRICE_FALLBACK = 'Condição disponível no checkout';

// Página onde o comprador confirma o e-mail da compra e conecta o Telegram.
export const ACCESS_PATH = '/acesso/';

// ---------------------------------------------------------------- contato e site

// Contato PESSOAL do Bruno (https://t.me/usuario). PENDENTE: enquanto estiver vazio, nenhum
// contato é exibido. Nunca use o convite do grupo pago aqui.
export const TELEGRAM_URL = '';

// Domínio definitivo (ex.: 'https://www.exemplo.com.br'): gera canonical e Open Graph absolutos.
export const SITE_URL = '';

// Google Analytics 4 (ex.: 'G-XXXXXXXXXX'). Vazio = nenhum script de métricas é carregado.
export const GA4_MEASUREMENT_ID = '';

// Endpoint interno com compras realmente aprovadas (anonimizadas). Ver backend/social-proof.mjs.
export const SOCIAL_PROOF_ENDPOINT = '/api/social-proof/recent';

// ---------------------------------------------------------------- textos

// Posições dos CTAs de compra (usadas no evento checkout_click).
export const CTA_POSITIONS = ['hero', 'header', 'how_it_works', 'offer', 'mobile_sticky', 'final'];

export const CTA = {
  // texto-base comum a todos os botões de compra
  base: 'Garantir meu acesso',
  hero: 'Quero garantir meu acesso',
  header: 'Garantir meu acesso',
  headerCompact: 'Garantir acesso',
  howItWorks: 'Garantir meu acesso agora',
  offer: 'Garantir meu acesso',
  final: 'Quero entrar no grupo',
  sticky: 'Garantir acesso',
};

// Faixa superior: mensagens institucionais (sempre verdadeiras).
export const TICKER_MESSAGES = [
  'COMUNIDADE PRIVADA NO TELEGRAM',
  'ACESSO LIBERADO APÓS PAGAMENTO APROVADO',
  'PAGAMENTO PROCESSADO PELA CAKTO',
  'COMPRA ÚNICA • ACESSO VITALÍCIO',
  'CONTEÚDO EXCLUSIVO PARA MAIORES DE 18 ANOS',
];

export const NAV = [
  { href: '#grupo', label: 'O grupo' },
  { href: '#conteudo', label: 'O que você recebe' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#bruno', label: 'Sobre o Bruno' },
  { href: '#duvidas', label: 'Dúvidas' },
];

// Quebras de linha intencionais: "\n" vira <br> nos títulos.
export const COPY = {
  meta: {
    title: 'Bruno | Comunidade privada de CPA Chinês e Bets',
    description:
      'Acesso vitalício ao grupo privado do Bruno no Telegram, com conteúdos sobre CPA Chinês e Bets. Pagamento pela Cakto; entrada liberada após a aprovação. Para maiores de 18 anos.',
  },
  hero: {
    eyebrow: 'COMUNIDADE PRIVADA • ACESSO VITALÍCIO',
    title: 'Estratégia antes\ndo palpite.',
    lead: 'Entre no grupo privado do Bruno e acompanhe conteúdos sobre CPA Chinês e Bets com mais contexto, organização e direção.',
    secondary: 'Ver o que está incluído',
    micro: 'Pagamento processado pela Cakto. A entrada no grupo é liberada somente após a confirmação da compra.',
    photoAlt: 'Bruno, de camiseta branca, olhando o celular, em foto em preto e branco.',
  },
  tension: {
    title: 'Informação solta\nnão é direção.',
    text: 'Quando tudo chega sem contexto, você perde tempo tentando separar oportunidade de ruído. O grupo foi criado para reunir conteúdo, acompanhamento e uma linha de raciocínio mais clara em um único lugar.',
    highlight: ['Menos ruído.', 'Mais contexto.', 'Mais consistência.'],
  },
  content: {
    eyebrow: 'DENTRO DO GRUPO',
    title: 'O que você\nencontra dentro',
  },
  fit: {
    title: 'Este grupo faz\nsentido para você?',
    yesTitle: 'É para você que',
    noTitle: 'Não é para você que',
  },
  how: {
    eyebrow: 'COMO FUNCIONA',
    title: 'Da compra ao grupo,\nsem atalhos.',
    activation: 'Já comprou? Ative seu acesso',
  },
  about: {
    eyebrow: 'QUEM CONDUZ O GRUPO',
    title: 'Bruno',
    text: 'Bruno tem 19 anos e atua com conteúdos ligados ao CPA Chinês e ao mercado de Bets. O grupo reúne sua visão, seus conteúdos e suas atualizações em um ambiente privado, organizado e acessível somente aos membros.',
    photoAlt: 'Retrato de Bruno em preto e branco, de camiseta branca, com o celular nas mãos.',
  },
  preview: {
    eyebrow: 'O AMBIENTE',
    title: 'Uma prévia\nda experiência',
    caption: 'Representação visual do ambiente. O conteúdo exibido pode variar conforme as atualizações do grupo.',
  },
  testimonials: {
    eyebrow: 'QUEM JÁ ESTÁ DENTRO',
    title: 'Palavra de membro',
  },
  offer: {
    eyebrow: 'SEU ACESSO AO GRUPO',
    title: 'Entre para a comunidade\nprivada do Bruno.',
    micro: 'Compra processada pela Cakto. O acesso é pessoal e liberado após a aprovação do pagamento.',
    policy: 'Compra única • Acesso vitalício',
  },
  faq: {
    eyebrow: 'DÚVIDAS',
    title: 'Perguntas\nfrequentes',
  },
  final: {
    title: 'A próxima decisão\né sua.',
    text: 'Se você procura um ambiente privado para acompanhar CPA Chinês e Bets com mais organização e contexto, o grupo está aberto para novos membros.',
    micro: 'Acesso liberado somente após pagamento aprovado.',
  },
  sticky: { label: 'Acesso vitalício' },
  footer: {
    tagline: 'Comunidade privada de CPA Chinês e Bets',
    legal:
      'Conteúdo destinado a maiores de 18 anos. As informações disponibilizadas possuem caráter educacional e informativo. Não existe promessa ou garantia de ganhos. Resultados dependem de diversos fatores e decisões individuais.',
    adult: '18+',
  },
};

export const BENEFITS = [
  {
    index: '01',
    title: 'CPA Chinês com contexto',
    text: 'Conteúdos organizados para ajudar você a compreender a operação, os termos e a lógica por trás do CPA Chinês.',
  },
  {
    index: '02',
    title: 'Mercado de Bets',
    text: 'Leituras, atualizações e conteúdos ligados ao mercado de Bets, apresentados de forma direta e responsável.',
  },
  {
    index: '03',
    title: 'Acompanhamento contínuo',
    text: 'Um ambiente privado para acompanhar novas informações e atualizações sem depender de conteúdos espalhados.',
  },
  {
    index: '04',
    title: 'Comunidade privada',
    text: 'Acesso ao grupo reservado para compradores aprovados, com entrada individual e controlada pelo sistema.',
  },
  {
    index: '05',
    title: 'Acesso vitalício',
    text: 'Uma única compra libera o acesso conforme a política vitalícia definida para o produto.',
  },
];

export const FIT = {
  yes: [
    'tem 18 anos ou mais;',
    'deseja entender melhor CPA Chinês e Bets;',
    'valoriza informação organizada;',
    'busca uma comunidade privada;',
    'entende que conhecimento exige aplicação e responsabilidade.',
  ],
  no: [
    'procura dinheiro fácil;',
    'espera lucro garantido;',
    'quer fórmulas mágicas;',
    'pretende compartilhar o acesso;',
    'não aceita os riscos envolvidos nesse mercado.',
  ],
};

export const STEPS = [
  { title: 'Faça a compra', text: 'O botão direciona você ao checkout seguro da Cakto.' },
  { title: 'Aguarde a confirmação', text: 'O sistema recebe a confirmação do pagamento diretamente da Cakto.' },
  {
    title: 'Ative seu acesso',
    text: 'Após a validação, sua conta do Telegram é vinculada à compra e o acesso ao grupo é liberado.',
  },
];

export const OFFER_INCLUDES = [
  'grupo privado no Telegram;',
  'conteúdos sobre CPA Chinês;',
  'conteúdos sobre Bets;',
  'atualizações dentro da comunidade;',
  'ativação individual;',
  'acesso vitalício.',
];

export const FAQ = [
  {
    q: 'O que estou comprando?',
    a: 'Você está comprando acesso individual ao grupo privado do Bruno no Telegram e aos conteúdos disponibilizados dentro da comunidade.',
  },
  {
    q: 'O acesso é vitalício?',
    a: 'Sim. Esta oferta está configurada como acesso vitalício, sujeita aos termos de uso e às regras da comunidade.',
  },
  {
    q: 'Como recebo o acesso?',
    a: 'Depois que a Cakto confirmar o pagamento, você poderá iniciar a ativação e vincular sua conta do Telegram à compra.',
  },
  {
    q: 'O link do grupo aparece depois do pagamento?',
    a: 'O acesso é controlado pelo sistema e vinculado à conta validada. O convite privado não fica disponível publicamente no site.',
  },
  {
    q: 'Preciso ter Telegram?',
    a: 'Sim. O grupo funciona no Telegram e será necessário ter uma conta ativa para concluir a entrada.',
  },
  {
    q: 'Posso compartilhar meu acesso?',
    a: 'Não. O acesso é individual e vinculado ao comprador e à conta do Telegram utilizada na ativação.',
  },
  {
    q: 'Existe garantia de lucro?',
    a: 'Não. O conteúdo é educacional e informativo. Não existe promessa ou garantia de ganhos, e qualquer decisão deve ser tomada com responsabilidade.',
  },
  {
    q: 'O pagamento é feito no site?',
    a: 'O checkout e o processamento do pagamento são realizados pela Cakto.',
  },
];

// Depoimentos REAIS, com autorização do autor. A seção só aparece quando existir pelo menos um
// item com verified: true e authorized: true. Formato:
// { quote: '', name: '', context: '', verified: true, authorized: true }
export const TESTIMONIALS = [];

export const LEGAL_LINKS = [
  { href: '/termos/', label: 'Termos de uso' },
  { href: '/privacidade/', label: 'Política de privacidade' },
  { href: '/reembolso/', label: 'Política de reembolso' },
];
