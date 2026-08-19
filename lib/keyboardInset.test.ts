import { describe, it, expect } from 'vitest';
import { alturaDoTeclado, LIMIAR_TECLADO_PX } from './keyboardInset';

/** iPhone 14/15 em retrato. */
const TELA = 852;

describe('alturaDoTeclado', () => {
  it('teclado fechado não gera folga', () => {
    expect(
      alturaDoTeclado({ innerHeight: TELA, clientHeight: TELA, viewportHeight: TELA })
    ).toBe(0);
  });

  it('teclado aberto devolve a altura ocupada', () => {
    expect(
      alturaDoTeclado({ innerHeight: TELA, clientHeight: TELA, viewportHeight: TELA - 336 })
    ).toBe(336);
  });

  it('barra de endereço recolhendo não é confundida com teclado', () => {
    // O Safari esconde ~60px de chrome ao rolar. Se isso virasse folga, o campo
    // de texto pularia no meio da leitura da conversa.
    const kh = alturaDoTeclado({
      innerHeight: TELA,
      clientHeight: TELA,
      viewportHeight: TELA - 60,
    });
    expect(kh).toBe(0);
  });

  it('exatamente no limiar ainda conta como fechado', () => {
    expect(
      alturaDoTeclado({
        innerHeight: TELA,
        clientHeight: TELA,
        viewportHeight: TELA - LIMIAR_TECLADO_PX,
      })
    ).toBe(0);
  });

  it('um pixel acima do limiar já conta como aberto', () => {
    expect(
      alturaDoTeclado({
        innerHeight: TELA,
        clientHeight: TELA,
        viewportHeight: TELA - (LIMIAR_TECLADO_PX + 1),
      })
    ).toBe(LIMIAR_TECLADO_PX + 1);
  });

  it('iOS que encolhe innerHeight junto com o teclado ainda mede certo', () => {
    // Este é o caso que a conta antiga errava: tomando só innerHeight, a
    // diferença dava 0 e o app achava que o teclado estava fechado.
    const kh = alturaDoTeclado({
      innerHeight: TELA - 336,
      clientHeight: TELA,
      viewportHeight: TELA - 336,
    });
    expect(kh).toBe(336);
  });

  it('viewport ainda sem layout devolve fechado em vez de folga inventada', () => {
    // Aba em segundo plano ou antes do primeiro layout: tudo zero.
    expect(alturaDoTeclado({ innerHeight: 0, clientHeight: 0, viewportHeight: 0 })).toBe(0);
    expect(alturaDoTeclado({ innerHeight: 0, clientHeight: 0, viewportHeight: 500 })).toBe(0);
  });

  it('medida corrompida (viewport negativo ou NaN) não vira folga', () => {
    expect(alturaDoTeclado({ innerHeight: TELA, clientHeight: TELA, viewportHeight: -10 })).toBe(0);
    expect(alturaDoTeclado({ innerHeight: TELA, clientHeight: TELA, viewportHeight: NaN })).toBe(0);
    expect(alturaDoTeclado({ innerHeight: NaN, clientHeight: NaN, viewportHeight: TELA })).toBe(0);
  });

  it('diferença maior que a tela inteira é descartada', () => {
    // Não existe teclado mais alto que a tela; isso é leitura suja.
    expect(alturaDoTeclado({ innerHeight: 300, clientHeight: 300, viewportHeight: 1 })).toBe(0);
  });

  it('valor fracionário é arredondado (padding em px inteiro)', () => {
    const kh = alturaDoTeclado({
      innerHeight: TELA,
      clientHeight: TELA,
      viewportHeight: TELA - 336.4,
    });
    expect(kh).toBe(336);
    expect(Number.isInteger(kh)).toBe(true);
  });

  it('ciclo completo abrir → fechar volta a zero', () => {
    // O bug relatado: sobrava um vão depois de tocar em "OK" para recolher o
    // teclado. A medição precisa voltar exatamente ao estado inicial.
    const fechado = { innerHeight: TELA, clientHeight: TELA, viewportHeight: TELA };
    const aberto = { innerHeight: TELA, clientHeight: TELA, viewportHeight: TELA - 336 };
    // Quadro intermediário da animação de fechamento do iOS.
    const meio = { innerHeight: TELA, clientHeight: TELA, viewportHeight: TELA - 180 };

    expect(alturaDoTeclado(fechado)).toBe(0);
    expect(alturaDoTeclado(aberto)).toBe(336);
    expect(alturaDoTeclado(meio)).toBe(180);
    expect(alturaDoTeclado(fechado)).toBe(0);
  });
});
