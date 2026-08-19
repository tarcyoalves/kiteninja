'use client';

import { useEffect, useState } from 'react';

/**
 * Diagnóstico de tela — mede o que o iPhone realmente entrega.
 *
 * Existe porque a tarja escura no rodapé do app instalado já sobreviveu a sete
 * tentativas de correção às cegas: cada uma mexia numa unidade de altura
 * diferente (100vh, 100dvh, -webkit-fill-available) sem ninguém saber qual
 * número o aparelho estava usando de fato. Aqui os números aparecem na tela,
 * o dono do app manda um print e a causa deixa de ser palpite.
 *
 * Visível só para admin, dentro do menu do avatar. Se um dia a tarja for
 * história antiga, apague este arquivo sem dó.
 */
export const DiagTela: React.FC = () => {
  const [linhas, setLinhas] = useState<string[]>([]);

  useEffect(() => {
    // Uma div fantasma só para o browser resolver os env() da safe area: não
    // existe API para ler env() direto, então medimos o padding que ele aplica.
    const sonda = document.createElement('div');
    sonda.style.cssText =
      'position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(sonda);
    const s = getComputedStyle(sonda);
    const safe = `${s.paddingTop} / ${s.paddingRight} / ${s.paddingBottom} / ${s.paddingLeft}`;
    sonda.remove();

    const shell = document.querySelector('.app-shell');
    const shellRect = shell ? shell.getBoundingClientRect() : null;
    const meta = document.querySelector('meta[name="viewport"]');

    setLinhas([
      `screen: ${screen.width} x ${screen.height}`,
      `innerHeight: ${window.innerHeight}`,
      `clientHeight: ${document.documentElement.clientHeight}`,
      `visualViewport: ${window.visualViewport ? Math.round(window.visualViewport.height) : 'n/d'}`,
      `safe-area T/R/B/L: ${safe}`,
      `shell: ${shellRect ? `top ${Math.round(shellRect.top)} altura ${Math.round(shellRect.height)}` : 'não montado'}`,
      `standalone: ${window.matchMedia('(display-mode: standalone)').matches ? 'sim' : 'não'}`,
      `dpr: ${window.devicePixelRatio}`,
      `viewport-fit: ${meta?.getAttribute('content')?.includes('viewport-fit=cover') ? 'cover' : 'AUSENTE'}`,
    ]);
  }, []);

  return (
    <div className="mt-2 p-3 rounded-xl bg-[#0F172A] border border-slate-700 text-[11px] font-mono text-slate-300 leading-relaxed">
      <div className="text-slate-500 uppercase tracking-wider mb-1">Diagnóstico de tela</div>
      {linhas.map(l => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
};
