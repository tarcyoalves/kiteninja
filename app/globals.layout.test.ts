/**
 * Trava de regressão da "tarja escura no rodapé".
 *
 * O bug voltou várias vezes, e nunca porque um valor estava errado: voltava
 * porque cada regra que reservava espaço para o menu inferior tinha a SUA
 * fórmula. Corrigir uma deixava as outras divergindo, e a próxima edição no
 * layout reintroduzia a faixa vazia.
 *
 * Os dois erros concretos que existiam e que estes testes proíbem:
 *
 *  1. `calc(var(--nav-h) + env(safe-area-inset-bottom))` — --nav-h JÁ contém a
 *     safe-area, então isso conta o inset duas vezes (+34px de faixa morta no
 *     iPhone). Estava em .publish-fab-bottom e .feed-pad-bottom.
 *  2. Folga escrita como número solto (`calc(5.5rem + env(...))`) — não
 *     acompanha a altura real da pílula, então qualquer mudança no BottomNav
 *     faz o número mentir. Estava em .app-scroll e .map-card-bottom.
 *
 * Por que testar o CSS como texto: o bug é geométrico e só aparece num iPhone
 * real instalado na tela de início — não há como reproduzi-lo em jsdom, que não
 * implementa env(safe-area-inset-*) nem resolve calc() aninhado em layout. O que
 * dá para garantir de forma barata e determinística é a INVARIANTE de origem:
 * existe uma única fonte da verdade e todos derivam dela. É isso que falhava.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(import.meta.dirname, 'globals.css'), 'utf8');

/** Remove comentários /* … *\/ para não acusar prosa explicativa como código. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Corpo de uma regra pelo seletor, já sem comentários. */
function corpoDaRegra(seletor: string): string {
  const alvo = semComentarios(css);
  const i = alvo.indexOf(seletor);
  if (i === -1) throw new Error(`Regra "${seletor}" não existe mais em globals.css`);
  const abre = alvo.indexOf('{', i);
  const fecha = alvo.indexOf('}', abre);
  return alvo.slice(abre + 1, fecha).trim();
}

/**
 * Toda regra que reserva espaço para o menu inferior. Se você criar outra,
 * adicione aqui — é de propósito que a lista seja explícita: assim uma folga
 * nova de rodapé não passa sem entrar na trava.
 */
const CONSUMIDORES_DO_RODAPE = [
  '.pb-above-nav',
  '.app-scroll',
  '.map-card-bottom',
  '.bottom-nav-gap',
  '.publish-fab-bottom',
  '.feed-pad-bottom',
];

describe('globals.css — geometria do rodapé', () => {
  it('--nav-h soma a safe-area exatamente uma vez', () => {
    const raiz = semComentarios(css);
    const decl = /--nav-h:\s*([^;]+);/.exec(raiz);
    expect(decl, '--nav-h precisa continuar existindo').not.toBeNull();

    const valor = decl![1];
    // Via --safe-b, que é onde env() é lido. Uma ocorrência, nunca duas.
    expect(valor).toContain('var(--safe-b)');
    expect(valor.match(/var\(--safe-b\)/g)).toHaveLength(1);
    expect(valor).not.toContain('env(');
  });

  it('--safe-b é o único lugar que lê a safe-area inferior', () => {
    const raiz = semComentarios(css);
    const leituras = raiz.match(/env\(\s*safe-area-inset-bottom/g) ?? [];
    // Só a declaração de --safe-b. Qualquer outra é uma segunda fonte da
    // verdade nascendo, que é exatamente como o bug voltava.
    expect(
      leituras,
      'env(safe-area-inset-bottom) deve aparecer só em --safe-b; use var(--nav-h) ou var(--safe-b)',
    ).toHaveLength(1);
    expect(/--safe-b:\s*max\(\s*env\(\s*safe-area-inset-bottom/.test(raiz)).toBe(true);
  });

  it('nenhuma folga de rodapé soma env() junto de var(--nav-h) (inset em dobro)', () => {
    for (const seletor of CONSUMIDORES_DO_RODAPE) {
      const corpo = corpoDaRegra(seletor);
      if (!corpo.includes('var(--nav-h)')) continue;
      expect(
        corpo.includes('env('),
        `${seletor} soma env() junto de var(--nav-h) — --nav-h já inclui a safe-area, ` +
          `isso conta o inset duas vezes e é a origem da tarja no rodapé`,
      ).toBe(false);
    }
  });

  it('toda folga de rodapé deriva de --nav-h', () => {
    // Uma folga aditiva por cima do menu (`calc(var(--nav-h) + 4rem)` para
    // livrar o FAB do feed) é legítima. Não se tenta distinguir "número solto
    // que é a altura do menu" de "número solto que é folga" pela magnitude:
    // isso dá falso positivo no 4rem do feed, e é redundante — a forma antiga
    // `calc(5.5rem + env(...))` já falha nesta asserção e na do env() duplo.
    for (const seletor of CONSUMIDORES_DO_RODAPE) {
      const corpo = corpoDaRegra(seletor);
      expect(
        corpo.includes('var(--nav-h)'),
        `${seletor} precisa derivar de var(--nav-h) em vez de repetir a medida do menu`,
      ).toBe(true);
    }
  });

  it('a altura da pílula vem dos tokens do BottomNav', () => {
    const raiz = semComentarios(css);
    // --nav-h deriva dos tokens geométricos; trocar a pílula é editar um token.
    expect(raiz).toMatch(/--nav-pill-h:\s*58px/);
    expect(raiz).toMatch(/--nav-pill-gap:\s*6px/);
    const decl = /--nav-h:\s*([^;]+);/.exec(raiz)![1];
    expect(decl).toContain('var(--nav-pill-h)');
    expect(decl).toContain('var(--nav-pill-gap)');
  });

  it('o shell não declara altura — só top/bottom (senão sobra faixa morta)', () => {
    const corpo = corpoDaRegra('.app-shell');
    expect(corpo).toMatch(/position:\s*fixed/);
    expect(corpo).toMatch(/top:\s*0/);
    expect(corpo).toMatch(/bottom:\s*0/);
    // 100vh/-webkit-fill-available discordam do par top/bottom no iOS
    // instalado: fill-available exclui a barra de gestos e sobra tarja.
    expect(corpo).not.toMatch(/(^|[^-])height:/);
    expect(corpo).not.toContain('fill-available');
    expect(corpo).not.toContain('100vh');
    expect(corpo).not.toContain('100dvh');
  });
});

describe('BottomNav — sem medição de DOM', () => {
  it('não volta a publicar --nav-h em runtime', () => {
    const tsx = readFileSync(
      join(import.meta.dirname, '..', 'components', 'BottomNav.tsx'),
      'utf8',
    );
    const codigo = tsx.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    // A versão em JS ficava velha a cada evento de viewport não coberto (o
    // próprio componente desmonta quando o teclado abre, levando o observer).
    expect(codigo).not.toContain('setProperty');
    expect(codigo).not.toContain('ResizeObserver');
    expect(codigo).not.toContain('getBoundingClientRect');
  });

  it('os tokens do CSS continuam refletindo o JSX da pílula', () => {
    const tsx = readFileSync(
      join(import.meta.dirname, '..', 'components', 'BottomNav.tsx'),
      'utf8',
    );
    // Se a pílula mudar de altura ou de distância do fundo, este teste falha e
    // aponta para --nav-pill-h / --nav-pill-gap em globals.css.
    expect(tsx, 'altura da pílula mudou: atualize --nav-pill-h').toContain('h-[58px]');
    expect(tsx, 'distância do fundo mudou: atualize --nav-pill-gap').toContain('bottom-1.5');
  });
});

/*
 * Segunda causa da tarja, independente da geometria acima: COR.
 *
 * O `body` é o canvas que o iOS mostra em qualquer sobra fora do shell `fixed`.
 * Enquanto o shell pintava #0F172A (utility do Tailwind no JSX, que vence a
 * regra do .app-shell por não estar em @layer) e o `body` pintava #0B1220, a
 * diferença de tom aparecia como faixa — e nenhum ajuste de padding a removia,
 * só mudava a altura dela. Agora existe um token único, --app-bg.
 */
describe('globals.css — cor de fundo em fonte única', () => {
  const pageTsx = readFileSync(join(import.meta.dirname, 'page.tsx'), 'utf8');
  const layoutTsx = readFileSync(join(import.meta.dirname, 'layout.tsx'), 'utf8');

  /** Valor de --app-bg declarado no :root. */
  function corDoToken(): string {
    const m = semComentarios(css).match(/--app-bg:\s*(#[0-9A-Fa-f]{3,8})/);
    if (!m) throw new Error('--app-bg não existe mais em globals.css');
    return m[1].toUpperCase();
  }

  it('body e .app-shell usam o mesmo token, não hex solto', () => {
    for (const seletor of ['body {', '.app-shell {']) {
      const corpo = corpoDaRegra(seletor);
      const bg = corpo.match(/background-color:\s*([^;]+);/);
      expect(bg, `${seletor} perdeu o background-color`).not.toBeNull();
      expect(
        bg![1].trim(),
        `${seletor} voltou a fixar a cor em hex — body e shell divergem e vira tarja`,
      ).toBe('var(--app-bg)');
    }
  });

  it('o shell não declara cor de fundo no JSX (utility vence o CSS)', () => {
    const jsx = pageTsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const shell = jsx.match(/className=\{`app-shell[^`]*`\}/);
    expect(shell, 'o className do app-shell mudou de forma; revise este teste').not.toBeNull();
    expect(
      shell![0],
      'bg-* no shell sobrepõe --app-bg e deixa o body num tom diferente',
    ).not.toMatch(/\bbg-\[/);
  });

  /*
   * Este caso existe porque a versão anterior desta suíte PASSOU com o bug
   * presente: ela checava só o shell em page.tsx e ignorava o <body> do
   * layout.tsx, que tinha `bg-[#0B1220]` fixo. A utility do Tailwind vencia o
   * `background-color: var(--app-bg)` do CSS, então o token era inócuo no body e
   * a tarja continuou depois de um commit que dizia tê-la corrigido.
   *
   * Cobrir os DOIS elementos raiz é o ponto: basta um deles fixar cor para as
   * duas camadas divergirem de novo.
   */
  it('o <html> e o <body> não fixam cor de fundo no JSX', () => {
    const jsx = layoutTsx.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    for (const tag of ['html', 'body']) {
      const el = jsx.match(new RegExp(`<${tag}\\s[^>]*>`));
      expect(el, `<${tag}> não encontrado em layout.tsx; revise este teste`).not.toBeNull();
      expect(
        el![0],
        `<${tag}> fixa bg-* e sobrepõe --app-bg: body e shell voltam a divergir`,
      ).not.toMatch(/\bbg-(\[|slate|gray|zinc|neutral|stone|black|white)/);
    }
  });

  it('o theme-color do iOS acompanha --app-bg', () => {
    // Instalado na tela de início, o iOS pinta chrome com esta cor. Se ela
    // discordar do fundo real, a divergência reaparece como faixa.
    const cores = [...layoutTsx.matchAll(/color:\s*"(#[0-9A-Fa-f]{3,8})"/g)].map((m) =>
      m[1].toUpperCase(),
    );
    expect(cores.length, 'themeColor sumiu do layout.tsx').toBeGreaterThan(0);
    for (const cor of cores) {
      expect(cor, `themeColor ${cor} != --app-bg ${corDoToken()}`).toBe(corDoToken());
    }
  });

  /*
   * Telas que ocupam a tela inteira (placeholder de carregamento, LoginGate,
   * SplashIntro) pintavam #0B1220 fixo — o tom ANTIGO. São justamente os
   * primeiros pixels do app instalado, então apareciam como faixa/piscada de
   * cor errada mesmo com o shell já correto. Devem herdar --app-bg.
   *
   * `min-h-screen` também é proibido aqui: é 100vh, a mesma conta que a seção
   * "ALTURA DO APP" do globals.css rejeita por sobrar faixa morta no iOS
   * instalado. O body já é flex-col de altura cheia; use flex-1 / min-h-full.
   */
  it('telas de altura cheia herdam --app-bg e não usam 100vh', () => {
    const arquivos = [
      ['app/page.tsx', pageTsx],
      ['components/LoginGate.tsx', ''],
      ['components/SplashIntro.tsx', ''],
    ] as const;

    for (const [caminho, jaLido] of arquivos) {
      const fonte =
        jaLido || readFileSync(join(import.meta.dirname, '..', caminho), 'utf8');
      const codigo = fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

      expect(
        codigo,
        `${caminho} usa min-h-screen (100vh): sobra faixa morta no iOS instalado`,
      ).not.toMatch(/\bmin-h-screen\b/);

      /*
       * Só os TONS DE FUNDO DO APP são proibidos — não qualquer hex. Cards e
       * botões usam #1E293B e afins legitimamente, e uma primeira versão desta
       * asserção reprovava esses casos. O que não pode é uma tela pintar o
       * fundo do app à mão: quando o token muda (modo praia, ajuste de tema),
       * essa tela fica no tom antigo e a divergência volta.
       */
      const tonsDeFundo = /\bbg-\[#(0B1220|0F172A|020617|0A0F1D|0B132B)\]/gi;
      const fundosLiterais = [...codigo.matchAll(tonsDeFundo)].map((m) => m[0]);
      expect(
        fundosLiterais,
        `${caminho} pinta o fundo do app com hex literal em vez de bg-[var(--app-bg)]`,
      ).toEqual([]);
    }
  });

  it('o modo praia troca o token no <html>, não só no shell', () => {
    expect(
      semComentarios(css),
      'sem a regra em html[data-modo=praia] o body fica no tom claro e sobra tarja',
    ).toMatch(/html\[data-modo=['"]praia['"]\]/);

    const ctx = readFileSync(
      join(import.meta.dirname, '..', 'context', 'KiteDataContext.tsx'),
      'utf8',
    );
    expect(ctx, 'ninguém escreve data-modo no <html>: a regra do CSS nunca ativa').toContain(
      "setAttribute('data-modo'",
    );
  });
});
