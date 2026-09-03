import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ATRASO_PARA_FECHAR_MS, ehCampoEditavel } from './tecladoVirtual';

describe('ehCampoEditavel', () => {
  it('reconhece os campos que abrem teclado', () => {
    expect(ehCampoEditavel({ tagName: 'INPUT' })).toBe(true);
    expect(ehCampoEditavel({ tagName: 'TEXTAREA' })).toBe(true);
    expect(ehCampoEditavel({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    // Caixa varia entre navegadores em alguns caminhos de evento.
    expect(ehCampoEditavel({ tagName: 'input' })).toBe(true);
  });

  it('não confunde botão com campo', () => {
    // É o caso que produziu o bug: o foco indo para o BOTÃO de enviar.
    expect(ehCampoEditavel({ tagName: 'BUTTON' })).toBe(false);
    expect(ehCampoEditavel({ tagName: 'DIV' })).toBe(false);
    expect(ehCampoEditavel({ tagName: 'DIV', isContentEditable: false })).toBe(false);
  });

  it('aguenta null, undefined e lixo sem estourar', () => {
    for (const ruim of [null, undefined, {}, { tagName: 3 }, { tagName: null }]) {
      expect(ehCampoEditavel(ruim as never)).toBe(false);
    }
  });
});

describe('ATRASO_PARA_FECHAR_MS', () => {
  it('é curto o bastante para não parecer travamento, longo o bastante para o clique', () => {
    // Abaixo de ~150ms o clique de um botão vizinho ainda não chegou (o
    // `click` só nasce quando o dedo levanta). Acima de ~400ms, tocar fora
    // para fechar o teclado parece que travou.
    expect(ATRASO_PARA_FECHAR_MS).toBeGreaterThanOrEqual(150);
    expect(ATRASO_PARA_FECHAR_MS).toBeLessThanOrEqual(400);
  });
});

/**
 * Guarda de código-fonte: os botões do compositor não podem roubar o foco.
 *
 * O atraso acima já conserta o clique perdido. Esta guarda protege a OUTRA
 * metade, que é de experiência: sem `preventDefault` no `onMouseDown`, tocar
 * em enviar fecha o teclado, e mandar três mensagens seguidas vira
 * toque-digita-toque-toque-digita. Nenhum teste de unidade enxerga isso.
 */
describe('os botões do compositor do chat mantêm o foco no campo', () => {
  it('cada botão dentro do compositor tem onMouseDown com preventDefault', () => {
    const src = readFileSync('views/ChatView.tsx', 'utf8');
    const marcador = 'INICIO-COMPOSITOR-CHAT';
    const fim = 'FIM-COMPOSITOR-CHAT';
    expect(src, `faltou o marcador ${marcador}`).toContain(marcador);
    const trecho = src.slice(src.indexOf(marcador), src.indexOf(fim));
    expect(trecho.length).toBeGreaterThan(100);

    const botoes = trecho.match(/<button[\s\S]*?>/g) ?? [];
    expect(botoes.length).toBeGreaterThan(0);
    for (const b of botoes) {
      expect(b, `botão sem onMouseDown no compositor: ${b.slice(0, 80)}`).toMatch(
        /onMouseDown=\{manterFocoNoCampo\}/
      );
    }
  });
});

/**
 * Guarda de código-fonte: botão invisível no celular.
 *
 * `opacity-0 group-hover:opacity-100` é um padrão de desktop. Num app que roda
 * no dedo NÃO EXISTE hover: o botão fica com opacidade zero para sempre —
 * invisível, e mesmo assim clicável. Era o caso dos botões de copiar e de
 * APAGAR mensagem no chat: alvos transparentes de 11px ao lado do horário.
 *
 * A forma correta, que este teste aceita, é esconder só a partir de `sm`
 * (`opacity-80 sm:opacity-0 group-hover:opacity-100`) — visível no toque,
 * discreto no ponteiro. É o que NotificationCenterModal já fazia.
 */
describe('nenhum botão fica invisível em tela de toque', () => {
  const ARQUIVOS = [
    'views/ChatView.tsx',
    'components/NotificationCenterModal.tsx',
    'components/VideoTrimmer.tsx',
  ];

  for (const arquivo of ARQUIVOS) {
    it(`${arquivo} não esconde afordância atrás de hover puro`, () => {
      const src = readFileSync(arquivo, 'utf8');
      for (const linha of src.split('\n')) {
        // Comentário explicando a regra não conta como violação.
        if (linha.trimStart().startsWith('*') || linha.includes('//')) continue;
        if (!linha.includes('group-hover:opacity-100')) continue;
        // `sm:opacity-0` é o jeito certo: escondido só onde há ponteiro fino.
        const escondeNoCelular = /(^|[\s"'`])opacity-0[\s"'`]/.test(linha);
        expect(
          escondeNoCelular,
          `opacity-0 sem prefixo de breakpoint em ${arquivo}: ${linha.trim().slice(0, 90)}`
        ).toBe(false);
      }
    });
  }
});
