/**
 * Testes do transporte da trilha do downwind.
 *
 * A regra que mais importa aqui é a do cursor: se ele avançar além do que foi
 * de fato recebido, abre um vão permanente no rastro, e o mapa desenha uma
 * reta atravessando a praia entre dois pontos que nunca foram vizinhos. Isso
 * não é bug visual — é a tela mentindo sobre por onde a pessoa passou.
 */
import { describe, expect, it } from 'vitest';
import {
  amostrarTrilha,
  dividirCauda,
  MAX_PONTOS_ACUMULADOS,
  mesclarTrilha,
  passoAmostragem,
  PontoTrilha,
  proximoCursor,
  ultimoTimestamp,
} from './trilhaDownwind';

/** Trilha sintética: `n` pontos, um por minuto, andando para o oeste. */
function trilha(n: number, tsInicial = 1_700_000_000_000): PontoTrilha[] {
  return Array.from({ length: n }, (_, i): PontoTrilha => [
    -4.95,
    -36.88 - i * 0.001,
    tsInicial + i * 60_000,
  ]);
}

describe('passoAmostragem', () => {
  it('nunca devolve 0 (dividir por zero quebraria a query e o cliente)', () => {
    expect(passoAmostragem(0, 120)).toBeGreaterThanOrEqual(1);
    expect(passoAmostragem(1, 120)).toBeGreaterThanOrEqual(1);
    expect(passoAmostragem(5, 0)).toBeGreaterThanOrEqual(1);
    expect(passoAmostragem(1000, 0)).toBeGreaterThanOrEqual(1);
  });

  it('trilha menor que o limite não é amostrada (passo 1)', () => {
    expect(passoAmostragem(50, 120)).toBe(1);
  });

  it('trilha grande é reduzida na proporção certa', () => {
    expect(passoAmostragem(480, 120)).toBe(4);
  });
});

describe('amostrarTrilha', () => {
  it('respeita o limite, com folga de no máximo um ponto (o último forçado)', () => {
    const saida = amostrarTrilha(trilha(500), 120);
    expect(saida.length).toBeLessThanOrEqual(121);
    expect(saida.length).toBeGreaterThan(100);
  });

  it('SEMPRE preserva o ponto mais recente — é o que encosta no marcador', () => {
    const entrada = trilha(499);
    const saida = amostrarTrilha(entrada, 120);
    expect(saida[saida.length - 1]).toEqual(entrada[entrada.length - 1]);
  });

  it('trilha curta passa intacta', () => {
    const entrada = trilha(10);
    expect(amostrarTrilha(entrada, 120)).toEqual(entrada);
  });

  it('mantém a ordem cronológica', () => {
    const saida = amostrarTrilha(trilha(300), 50);
    const ts = saida.map((p) => p[2]);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });
});

describe('mesclarTrilha', () => {
  it('acrescenta o delta ao que já estava na tela, em ordem', () => {
    const base = trilha(3);
    const novos = trilha(2, 1_700_000_180_000);
    const juntos = mesclarTrilha(base, novos);
    expect(juntos).toHaveLength(5);
    expect(juntos[4][2]).toBeGreaterThan(juntos[0][2]);
  });

  it('não duplica ponto de mesmo timestamp (o delta pode repetir o cursor)', () => {
    const base = trilha(5);
    const juntos = mesclarTrilha(base, base.slice(3));
    expect(juntos).toHaveLength(5);
  });

  it('delta vazio NÃO zera a trilha já acumulada', () => {
    const base = trilha(7);
    expect(mesclarTrilha(base, [])).toEqual(base);
  });

  it('ao estourar o teto, descarta os MAIS ANTIGOS e mantém os recentes', () => {
    const base = trilha(MAX_PONTOS_ACUMULADOS);
    const novos = trilha(10, 1_700_000_000_000 + MAX_PONTOS_ACUMULADOS * 60_000);
    const juntos = mesclarTrilha(base, novos);
    expect(juntos).toHaveLength(MAX_PONTOS_ACUMULADOS);
    expect(juntos[juntos.length - 1]).toEqual(novos[novos.length - 1]);
    expect(juntos[0][2]).toBeGreaterThan(base[0][2]);
  });

  it('ordena mesmo quando o delta chega fora de ordem', () => {
    const juntos = mesclarTrilha([], [...trilha(4)].reverse());
    const ts = juntos.map((p) => p[2]);
    expect([...ts].sort((a, b) => a - b)).toEqual(ts);
  });
});

describe('proximoCursor — a regra que evita buraco na trilha', () => {
  it('avança até o último ponto de fato recebido', () => {
    const pontos = trilha(3);
    const cursor = proximoCursor(null, ultimoTimestamp(pontos));
    expect(cursor).toBe(new Date(pontos[2][2]).toISOString());
  });

  it('lote vazio mantém o cursor anterior (nada novo, nada a avançar)', () => {
    const antes = new Date(1_700_000_000_000).toISOString();
    expect(proximoCursor(antes, ultimoTimestamp([]))).toBe(antes);
  });

  it('NUNCA retrocede: lote atrasado não faz repedir trilha que o cliente já tem', () => {
    const antes = new Date(1_700_000_600_000).toISOString();
    const atrasado = proximoCursor(antes, 1_700_000_060_000);
    expect(atrasado).toBe(antes);
  });

  it('resposta truncada não salta para "agora" — continua do último ponto recebido', () => {
    // Servidor bateu no teto de linhas: sobraram pontos entre o último
    // entregue e o instante atual. Saltar o cursor pularia esse intervalo e o
    // vão ficaria no rastro para sempre.
    const recebidos = trilha(60);
    const cursor = proximoCursor(null, ultimoTimestamp(recebidos));
    expect(cursor).toBe(new Date(recebidos[59][2]).toISOString());
    expect(new Date(cursor as string).getTime()).toBeLessThan(Date.now());
  });
});

describe('ultimoTimestamp', () => {
  it('lote vazio devolve null (e não 0, que viraria 1970 no cursor)', () => {
    expect(ultimoTimestamp([])).toBeNull();
  });

  it('acha o maior mesmo com o lote fora de ordem', () => {
    const pontos = [...trilha(5)].reverse();
    expect(ultimoTimestamp(pontos)).toBe(trilha(5)[4][2]);
  });
});

describe('dividirCauda — as duas camadas do desenho', () => {
  it('trilha curta vira só cauda viva (nada antigo para esmaecer)', () => {
    const pontos = trilha(5);
    const { corpo, cauda } = dividirCauda(pontos, 20);
    expect(corpo).toHaveLength(0);
    expect(cauda).toEqual(pontos);
  });

  it('corpo e cauda compartilham o ponto de junção (senão fica um vão na linha)', () => {
    const pontos = trilha(50);
    const { corpo, cauda } = dividirCauda(pontos, 20);
    expect(corpo[corpo.length - 1]).toEqual(cauda[0]);
  });

  it('a cauda tem o tamanho pedido mais o ponto de junção', () => {
    const { cauda } = dividirCauda(trilha(50), 20);
    expect(cauda).toHaveLength(21);
  });

  it('a cauda termina no ponto mais recente da trilha', () => {
    const pontos = trilha(50);
    const { cauda } = dividirCauda(pontos, 20);
    expect(cauda[cauda.length - 1]).toEqual(pontos[49]);
  });
});
