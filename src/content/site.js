// Configuração central do site.
// Tudo o que é conteúdo comercial fica aqui; o HTML é gerado a partir destes dados no build.

// Endereço real do Telegram (HTTPS, ex.: 'https://t.me/usuario').
// Enquanto estiver vazio, os botões de contato aparecem sem link e o build avisa que o site
// NÃO está pronto para publicação.
export const TELEGRAM_URL = 'https://t.me/+wrx7kr7Moa00YTYx';

// Domínio definitivo (ex.: 'https://www.exemplo.com.br'). Quando informado, gera o canonical
// e URLs absolutas de Open Graph.
export const SITE_URL = '';

export const OFFERS = [
  {
    id: 'cpa-chines',
    index: '01',
    name: 'CPA Chinês',
    text: 'Conheça o curso de CPA Chinês. Fale comigo pelo Telegram para consultar o conteúdo e as condições de acesso.',
    cta: 'Saber mais sobre CPA Chinês',
    // Se houver um link de Telegram específico para esta oferta, informe aqui.
    telegramUrl: '',
    image: { base: 'detail', alt: 'Detalhe do monograma B: aresta chanfrada em metal preto e contraforma em esmalte vermelho.' },
  },
  {
    id: 'bets',
    index: '02',
    name: 'Bets',
    text: 'Conheça o curso de Bets. Fale comigo pelo Telegram para consultar o conteúdo e as condições de acesso.',
    cta: 'Saber mais sobre Bets',
    telegramUrl: '',
    image: { base: 'chips', alt: 'Três fichas personalizadas em preto, vinho e vermelho, gravadas com o monograma B.' },
  },
];
