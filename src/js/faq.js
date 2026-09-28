// Accordion do FAQ. Sem JS todas as respostas ficam abertas (HTML gerado com aria-expanded="true");
// aqui elas são recolhidas e passam a abrir por botão. Setas, Home e End movem entre perguntas.
import { track } from './checkout.js';

export function initFaq() {
  const root = document.querySelector('[data-faq]');
  if (!root) return;
  const triggers = [...root.querySelectorAll('[data-faq-trigger]')];

  const set = (btn, open) => {
    const panel = document.getElementById(btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', String(open));
    if (panel) panel.hidden = !open;
  };

  triggers.forEach((btn) => set(btn, false));
  root.classList.add('is-enhanced');

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-faq-trigger]');
    if (!btn) return;
    const open = btn.getAttribute('aria-expanded') !== 'true';
    set(btn, open);
    if (open) track('faq_open', { faq_question: btn.textContent.trim().slice(0, 100) });
  });

  root.addEventListener('keydown', (e) => {
    const i = triggers.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: triggers.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    triggers[(next + triggers.length) % triggers.length].focus();
  });
}
