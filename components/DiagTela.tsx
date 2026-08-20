'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Diagnóstico de tela — mede o que o iPhone realmente entrega.
 *
 * Existe porque a tarja escura no rodapé do app instalado já sobreviveu a
 * VÁRIAS tentativas de correção às cegas (ver docs/DEBUG-TARJA-RODAPE.md para o
 * histórico completo): cada uma mexia numa unidade de altura, numa cor ou numa
 * meta tag diferente sem ninguém saber o que o aparelho estava fazendo de fato.
 * Aqui os números aparecem na tela, o dono manda o texto e a causa deixa de ser
 * palpite.
 *
 * As duas linhas que mais importam:
 *
 * - `iOS standalone` usa `navigator.standalone`, a API PRÓPRIA do iOS, que é a
 *   única resposta confiável para "o app abriu em tela cheia ou como aba do
 *   Safari?". `display-mode: standalone` (a media query padrão) pode divergir
 *   dela no iOS, então mostramos as duas: se `navigator.standalone` for `não`,
 *   a faixa escura é a barra do próprio Safari e NENHUMA mudança de CSS do app
 *   pode afetá-la — o caminho é a meta tag `apple-mobile-web-app-capable`.
 *
 * - `VARREDURA` sobe pixel a pixel a partir da base da tela perguntando ao
 *   navegador qual elemento pinta ali e de que cor. Se existe uma faixa de tom
 *   diferente, ela aparece aqui como uma troca de cor numa altura específica —
 *   e o elemento culpado vem junto, com nome e classe. É a diferença entre
 *   "acho que é o body" e saber.
 *
 * Visível só para admin, dentro do menu do avatar. Se um dia a tarja for
 * história antiga, apague este arquivo sem dó.
 */

/** Sobe da base da tela procurando onde a cor de fundo muda. */
function varrerRodape(): string[] {
  const achados: string[] = [];
  const x = Math.round(window.innerWidth / 2);
  let ultimaCor: string | null = null;

  // 0, 1, 2, 4, 8... até 160px acima da base: denso onde a faixa costuma estar.
  const alturas = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 34, 44, 56, 70, 90, 110, 140, 160];

  for (const acima of alturas) {
    const y = window.innerHeight - 1 - acima;
    if (y < 0) break;
    const el = document.elementFromPoint(x, y);
    if (!el) {
      if (ultimaCor !== 'SEM ELEMENTO') {
        achados.push(`  ${acima}px: SEM ELEMENTO (canvas puro)`);
        ultimaCor = 'SEM ELEMENTO';
      }
      continue;
    }
    // Sobe na árvore até achar quem realmente pinta um fundo opaco.
    let pintor: Element | null = el;
    let cor = 'transparent';
    while (pintor) {
      const bg = getComputedStyle(pintor).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        cor = bg;
        break;
      }
      pintor = pintor.parentElement;
    }
    if (cor !== ultimaCor) {
      const nome = pintor
        ? `${pintor.tagName.toLowerCase()}${
            (pintor as HTMLElement).className
              ? '.' + (pintor as HTMLElement).className.toString().trim().split(/\s+/).slice(0, 2).join('.')
              : ''
          }`
        : '(canvas)';
      achados.push(`  ${acima}px: ${cor}  <- ${nome.slice(0, 46)}`);
      ultimaCor = cor;
    }
  }
  return achados;
}

export const DiagTela: React.FC = () => {
  const [linhas, setLinhas] = useState<string[]>([]);
  const [copiado, setCopiado] = useState(false);

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
    const raiz = getComputedStyle(document.documentElement);

    // `navigator.standalone` é iOS-only e não existe na tipagem padrão.
    const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;

    // A folga entre o fim do shell e a base da tela: se for > 0, existe área
    // que o shell NÃO cobre, e é exatamente aí que uma faixa apareceria.
    const folgaAbaixoDoShell = shellRect
      ? Math.round(window.innerHeight - shellRect.bottom)
      : null;

    setLinhas([
      `— MODO DE EXIBIÇÃO —`,
      `iOS standalone (navigator): ${
        iosStandalone === undefined ? 'API ausente (não é iOS)' : iosStandalone ? 'sim' : 'NÃO ⚠️'
      }`,
      `display-mode standalone: ${
        window.matchMedia('(display-mode: standalone)').matches ? 'sim' : 'não'
      }`,
      `viewport-fit: ${
        meta?.getAttribute('content')?.includes('viewport-fit=cover') ? 'cover' : 'AUSENTE ⚠️'
      }`,
      `apple-mobile-web-app-capable: ${
        document.querySelector('meta[name="apple-mobile-web-app-capable"]') ? 'presente' : 'AUSENTE ⚠️'
      }`,
      ``,
      `— GEOMETRIA —`,
      `screen: ${screen.width} x ${screen.height}`,
      `innerHeight: ${window.innerHeight}`,
      `clientHeight: ${document.documentElement.clientHeight}`,
      `visualViewport: ${
        window.visualViewport ? Math.round(window.visualViewport.height) : 'n/d'
      }`,
      `safe-area T/R/B/L: ${safe}`,
      `shell: ${
        shellRect
          ? `top ${Math.round(shellRect.top)} altura ${Math.round(shellRect.height)}`
          : 'não montado'
      }`,
      `folga abaixo do shell: ${
        folgaAbaixoDoShell === null ? 'n/d' : folgaAbaixoDoShell + 'px' + (folgaAbaixoDoShell > 0 ? ' ⚠️' : '')
      }`,
      `dpr: ${window.devicePixelRatio}`,
      ``,
      `— CORES —`,
      `--app-bg: ${raiz.getPropertyValue('--app-bg').trim() || '(vazio)'}`,
      `--nav-h: ${raiz.getPropertyValue('--nav-h').trim() || '(vazio)'}`,
      `--safe-b: ${raiz.getPropertyValue('--safe-b').trim() || '(vazio)'}`,
      `html bg: ${getComputedStyle(document.documentElement).backgroundColor}`,
      `body bg: ${getComputedStyle(document.body).backgroundColor}`,
      `shell bg: ${shell ? getComputedStyle(shell).backgroundColor : 'n/d'}`,
      ``,
      `— VARREDURA DO RODAPÉ (de baixo p/ cima) —`,
      ...varrerRodape(),
    ]);
  }, []);

  const copiar = useCallback(() => {
    const texto = linhas.join('\n');
    navigator.clipboard
      ?.writeText(texto)
      .then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      })
      .catch(() => {
        // Sem permissão de clipboard: o texto continua visível na tela para
        // print. Falhar aqui não pode quebrar o diagnóstico.
      });
  }, [linhas]);

  return (
    <div className="mt-2 p-3 rounded-xl bg-[#0F172A] border border-slate-700 text-[11px] font-mono text-slate-300 leading-relaxed">
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-slate-500 uppercase tracking-wider">Diagnóstico de tela</span>
        <button
          type="button"
          onClick={copiar}
          className="px-2 py-1 rounded-md bg-slate-700/60 hover:bg-slate-600 text-slate-200 text-[10px] font-bold tracking-wide transition-colors"
        >
          {copiado ? 'copiado!' : 'copiar'}
        </button>
      </div>
      {linhas.map((l, i) => (
        <div key={`${i}-${l}`} className={l.startsWith('—') ? 'text-slate-500 mt-1' : undefined}>
          {l || ' '}
        </div>
      ))}
    </div>
  );
};
