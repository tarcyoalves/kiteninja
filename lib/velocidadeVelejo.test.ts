import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  NOS_PARA_KMH,
  formatarVelocidadeVelejo,
  kmhParaNos,
  nosParaKmh,
} from './velocidadeVelejo';

describe('conversão', () => {
  it('usa a definição da milha náutica', () => {
    expect(NOS_PARA_KMH).toBe(1.852);
    expect(nosParaKmh(1)).toBeCloseTo(1.852, 6);
  });

  it('o caso do relato: 23,9 nós são os 44 km/h que o velejador viu', () => {
    // Este teste É o bug. O app mostrava "23.9nós" no feed depois de mostrar
    // 44 km/h na tela do Modo Navegação, e a leitura de quem usa foi "o app
    // errou a velocidade máxima". Estava certo; contava a mesma coisa em duas
    // unidades sem dizer.
    expect(formatarVelocidadeVelejo(23.9)).toBe('44.3 km/h');
  });

  it('ida e volta não perde a medida', () => {
    for (const nos of [0.5, 12.3, 23.9, 47.2]) {
      expect(kmhParaNos(nosParaKmh(nos))).toBeCloseTo(nos, 9);
    }
  });
});

describe('formatarVelocidadeVelejo', () => {
  it('sempre uma casa decimal, com a unidade junto', () => {
    expect(formatarVelocidadeVelejo(10)).toBe('18.5 km/h');
    expect(formatarVelocidadeVelejo(0)).toBe('0.0 km/h');
  });

  it('ausência de medida é travessão, não zero', () => {
    // Zero é uma medida: alguém que ficou parado n'água andou a zero. Quem
    // digitou o velejo à mão e não informou a velocidade não andou a zero —
    // não se sabe. As duas coisas não podem aparecer iguais.
    expect(formatarVelocidadeVelejo(undefined)).toBe('—');
    expect(formatarVelocidadeVelejo(null)).toBe('—');
    expect(formatarVelocidadeVelejo(Number.NaN)).toBe('—');
  });
});

/**
 * Guarda de código-fonte: nenhuma tela converte por conta própria.
 *
 * O defeito não foi uma conta errada — foi a MESMA conta escrita em dois
 * arquivos e faltando em outros dois. Tipo, lint e teste de unidade não veem
 * isso: `${x.toFixed(1)}nós` compila, passa no lint e está "correto" isolado.
 * Só olhando duas telas lado a lado é que aparece.
 *
 * Por isso a regra vira estrutura: quem MOSTRA velocidade de velejo importa de
 * lib/velocidadeVelejo.ts. Assim a próxima tela não tem como divergir sozinha.
 */
describe('toda tela que mostra velocidade de velejo usa a conversão única', () => {
  const IDENTIFICADORES = ['maxSpeedKnots', 'velocidadeMaxNos', 'speedKnots', 'velocidadeNos'];

  /** Comentários fora: um exemplo citado num comentário não é uma exibição. */
  const semComentarios = (texto: string) =>
    texto
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((linha) => linha.replace(/\/\/.*$/, ''))
      .join('\n');

  /** Recursão à mão: `globSync` existe no Node mas não nos tipos daqui. */
  const telasEm = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
      const caminho = `${dir}/${item.name}`;
      if (item.isDirectory()) return telasEm(caminho);
      return caminho.endsWith('.tsx') ? [caminho] : [];
    });

  const arquivos = [...telasEm('components'), ...telasEm('views')];

  it('encontra os arquivos de tela (o teste não pode passar por lista vazia)', () => {
    expect(arquivos.length).toBeGreaterThan(20);
  });

  for (const arquivo of arquivos) {
    const bruto = readFileSync(arquivo, 'utf8');
    const src = semComentarios(bruto);

    /*
     * Só interessa quem EXIBE: menciona uma velocidade e escreve a unidade
     * como PALAVRA.
     *
     * `\b` importa de verdade aqui: sem ele, "diag[nós]tico" casa, e a tela do
     * downwind ao vivo — que calcula velocidade mas não mostra nenhuma — era
     * cobrada de importar um formatador que não usa. Primeira versão deste
     * teste reprovou por isso.
     */
    const exibeVelocidade =
      IDENTIFICADORES.some((id) => src.includes(id)) &&
      (/\bnós\b/.test(src) || src.includes('km/h'));
    if (!exibeVelocidade) continue;

    it(`${arquivo} importa de lib/velocidadeVelejo`, () => {
      expect(src).toMatch(/from '(\.\.\/)+lib\/velocidadeVelejo'/);
    });

    it(`${arquivo} não converte nós para km/h na mão`, () => {
      /*
       * A MULTIPLICAÇÃO por 1,852 é a conversão de exibição, e é essa que não
       * pode estar espalhada — cada cópia é uma chance de alguém "corrigir" só
       * uma delas, que é exatamente como as telas passaram a discordar.
       *
       * A DIVISÃO fica de fora porque significa outra coisa: km para milha
       * náutica, ou km/h para nós num cálculo interno. Proibir as duas
       * reprovaria código correto — e um teste que reprova código correto é
       * apagado na primeira vez que incomoda.
       */
      expect(src).not.toMatch(/\*\s*1\.852/);
    });
  }
});
