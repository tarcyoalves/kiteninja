import { describe, expect, it } from 'vitest';
import {
  DURACAO_TWEEN_MS,
  interpolar,
  rumoDoMovimento,
  suavizar,
  vaisAnimar,
} from './animacaoMarcador';

const A = { lat: -5.0, lng: -36.5 };

describe('suavizar', () => {
  it('vai de 0 a 1 e desacelera no fim', () => {
    expect(suavizar(0)).toBe(0);
    expect(suavizar(1)).toBe(1);
    // Ease-out: na metade do tempo já andou mais da metade do caminho.
    expect(suavizar(0.5)).toBeGreaterThan(0.5);
  });

  it('não estoura fora do intervalo', () => {
    // Um quadro atrasado pode entregar fração > 1; o marcador não pode passar
    // do destino e voltar.
    expect(suavizar(1.7)).toBe(1);
    expect(suavizar(-0.3)).toBe(0);
  });
});

describe('interpolar', () => {
  const B = { lat: -5.01, lng: -36.51 };

  it('começa na origem e termina no destino', () => {
    expect(interpolar(A, B, 0)).toEqual(A);
    expect(interpolar(A, B, 1)).toEqual(B);
  });

  it('no meio do caminho está entre os dois', () => {
    const m = interpolar(A, B, 0.5);
    expect(m.lat).toBeLessThan(A.lat);
    expect(m.lat).toBeGreaterThan(B.lat);
  });

  it('nunca passa do destino, mesmo com fração acima de 1', () => {
    expect(interpolar(A, B, 2)).toEqual(B);
  });
});

describe('vaisAnimar', () => {
  it('anima o deslocamento de um velejo normal', () => {
    // ~1,1 km em 30s a 40 km/h: é o salto típico entre dois polls.
    expect(vaisAnimar(A, { lat: -5.01, lng: -36.5 })).toBe(true);
  });

  it('NÃO anima salto grande — vai direto para a posição certa', () => {
    /*
     * Acontece quando o app volta do segundo plano com dez minutos de trilha
     * acumulada. Deslizar isso viraria um objeto cruzando a tela; mostrar a
     * posição certa importa mais do que a transição ser bonita.
     */
    expect(vaisAnimar(A, { lat: -4.0, lng: -36.5 })).toBe(false);
  });
});

describe('rumoDoMovimento', () => {
  it('aponta para onde a pessoa está indo', () => {
    // Para o norte: latitude aumenta.
    expect(rumoDoMovimento(A, { lat: -4.99, lng: -36.5 })).toBeCloseTo(0, 1);
    // Para o leste: longitude aumenta.
    expect(rumoDoMovimento(A, { lat: -5.0, lng: -36.49 })).toBeCloseTo(90, 1);
  });

  it('sem movimento não inventa rumo', () => {
    /*
     * Dois pontos idênticos dariam um rumo qualquer, e a seta giraria sozinha
     * com o velejador parado na praia. "Sem seta" é a informação correta.
     */
    expect(rumoDoMovimento(A, A)).toBeNull();
    expect(rumoDoMovimento(A, { lat: -5.0000001, lng: -36.5000001 })).toBeNull();
  });
});

describe('duração do deslize', () => {
  it('é curta — o marcador tem que mostrar a posição mais recente', () => {
    // O que importa quando alguém precisa de socorro é ONDE a pessoa está
    // agora, não uma animação bonita rodando meio minuto atrás da realidade.
    expect(DURACAO_TWEEN_MS).toBeLessThanOrEqual(2_000);
  });
});
