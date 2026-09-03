import { describe, expect, it } from 'vitest';
import {
  MAX_FOTOS_POR_VELEJO,
  normalizarFotos,
  urlDeFotoValida,
} from './fotosDoVelejo';

const BLOB = 'https://abc.public.blob.vercel-storage.com/velejos/a.jpg';
const LEGADO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';

describe('urlDeFotoValida', () => {
  it('aceita Blob (novo) e data URL (legado)', () => {
    expect(urlDeFotoValida(BLOB)).toBe(true);
    expect(urlDeFotoValida(LEGADO)).toBe(true);
  });

  it('recusa qualquer outro esquema', () => {
    for (const ruim of [
      'javascript:alert(1)',
      'http://sem-tls.com/a.jpg',
      'file:///etc/passwd',
      'data:text/html,<script>',
      '',
      '   ',
      null,
      undefined,
      42,
      {},
    ]) {
      expect(urlDeFotoValida(ruim), String(ruim)).toBe(false);
    }
  });
});

describe('normalizarFotos', () => {
  it('preserva a ORDEM que o velejador montou', () => {
    // O ponto da função: várias fotos sobem em paralelo e resolvem fora de
    // sequência. Quem manda é a lista da tela, não quem chegou primeiro.
    const entrada = [`${BLOB}#3`, `${BLOB}#1`, `${BLOB}#2`];
    expect(normalizarFotos(entrada)).toEqual(entrada);
  });

  it('descarta inválida sem derrubar as boas', () => {
    expect(normalizarFotos([BLOB, 'javascript:x', LEGADO])).toEqual([BLOB, LEGADO]);
  });

  it('tira repetida', () => {
    expect(normalizarFotos([BLOB, BLOB, LEGADO])).toEqual([BLOB, LEGADO]);
  });

  it('corta no teto em vez de recusar tudo', () => {
    // Chegar acima do teto é cliente desatualizado, não erro do velejador.
    // Perder o velejo inteiro por causa da quinta foto seria a pior resposta.
    const muitas = Array.from({ length: 9 }, (_, i) => `${BLOB}#${i}`);
    const saida = normalizarFotos(muitas);
    expect(saida).toHaveLength(MAX_FOTOS_POR_VELEJO);
    expect(saida[0]).toBe(`${BLOB}#0`);
  });

  it('entrada que não é lista vira lista vazia', () => {
    for (const ruim of [null, undefined, 'x', 3, {}]) {
      expect(normalizarFotos(ruim)).toEqual([]);
    }
  });
});
