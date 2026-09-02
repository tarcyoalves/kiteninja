import { describe, expect, it } from 'vitest';
import {
  desserializarTrilha,
  serializarTrilha,
  valePenaRecuperar,
  prefillDeTrilhaSalva,
  VALIDADE_TRILHA_SALVA_MS,
} from './trilhaPersistida';
import { ESTADO_INICIAL_TRILHA, TETO_PONTOS_BRUTOS, type EstadoTrilha } from './trilhaSessao';

const AGORA = 1_756_000_000_000;

const comTrilha = (over: Partial<EstadoTrilha> = {}): EstadoTrilha => ({
  ...ESTADO_INICIAL_TRILHA,
  distanciaKm: 12.5,
  velocidadeMaxNos: 24.3,
  ultimaPosicaoEm: new Date(AGORA - 60_000),
  pontos: [
    [-4.9, -37.0, AGORA - 120_000],
    [-4.91, -37.0, AGORA - 60_000],
  ],
  ...over,
});

describe('ida e volta', () => {
  /**
   * O caso que motiva o módulo: o velejador fica 2h na água, o celular
   * descarta a aba, ele reabre. Sem isto, distância, velocidade máxima e
   * trilha iam todas para o lixo.
   */
  it('preserva distância, velocidade máxima e a trilha', () => {
    const original = comTrilha();
    const voltou = desserializarTrilha(serializarTrilha(original, AGORA), AGORA + 1000);
    expect(voltou?.distanciaKm).toBe(12.5);
    expect(voltou?.velocidadeMaxNos).toBe(24.3);
    expect(voltou?.pontos).toEqual(original.pontos);
  });

  it('a data volta como Date, não como número', () => {
    const voltou = desserializarTrilha(serializarTrilha(comTrilha(), AGORA), AGORA);
    expect(voltou?.ultimaPosicaoEm).toBeInstanceOf(Date);
  });

  /**
   * `ultimaReferencia` é o ponto de comparação para a PRÓXIMA amostra. Ao
   * retomar, o intervalo até o primeiro ponto novo pode ser de horas — usar a
   * referência velha produziria uma distância ou uma velocidade absurdas.
   */
  it('NÃO restaura a referência da próxima amostra', () => {
    const original = comTrilha({
      ultimaReferencia: { pos: { lat: -4.91, lng: -37 }, timestampMs: AGORA },
    });
    const voltou = desserializarTrilha(serializarTrilha(original, AGORA), AGORA);
    expect(voltou?.ultimaReferencia).toBeNull();
  });

  /** Velocidade instantânea descreve o GPS agora; restaurá-la seria mentira. */
  it('NÃO restaura a velocidade instantânea nem o estado de GPS indisponível', () => {
    const original = comTrilha({ velocidadeNos: 18, indisponivel: true });
    const voltou = desserializarTrilha(serializarTrilha(original, AGORA), AGORA);
    expect(voltou?.velocidadeNos).toBeNull();
    expect(voltou?.indisponivel).toBe(false);
  });
});

describe('recusa o que não dá para confiar', () => {
  it('nada salvo', () => {
    expect(desserializarTrilha(null, AGORA)).toBeNull();
    expect(desserializarTrilha('', AGORA)).toBeNull();
  });

  it('JSON quebrado', () => {
    expect(desserializarTrilha('{quebrado', AGORA)).toBeNull();
    expect(desserializarTrilha('"texto"', AGORA)).toBeNull();
  });

  it('versão desconhecida', () => {
    expect(desserializarTrilha(JSON.stringify({ versao: 2, salvoEmMs: AGORA }), AGORA)).toBeNull();
  });

  /**
   * O pior caso que a validade evita: oferecer a trilha da semana passada
   * como se fosse o velejo de agora, e a pessoa salvar dado errado no
   * histórico dela.
   */
  it('trilha vencida não é oferecida', () => {
    const salvo = serializarTrilha(comTrilha(), AGORA);
    expect(desserializarTrilha(salvo, AGORA + VALIDADE_TRILHA_SALVA_MS - 1000)).not.toBeNull();
    expect(desserializarTrilha(salvo, AGORA + VALIDADE_TRILHA_SALVA_MS + 1000)).toBeNull();
  });

  it('trilha salva "no futuro" (relógio mexido) é descartada', () => {
    expect(desserializarTrilha(serializarTrilha(comTrilha(), AGORA), AGORA - 60_000)).toBeNull();
  });

  it('números que não são números', () => {
    const base = { versao: 1, salvoEmMs: AGORA, pontos: [], ultimaPosicaoEmMs: null };
    expect(
      desserializarTrilha(JSON.stringify({ ...base, distanciaKm: 'x', velocidadeMaxNos: 1 }), AGORA)
    ).toBeNull();
    expect(
      desserializarTrilha(JSON.stringify({ ...base, distanciaKm: -5, velocidadeMaxNos: 1 }), AGORA)
    ).toBeNull();
    expect(
      desserializarTrilha(
        JSON.stringify({ ...base, distanciaKm: 1, velocidadeMaxNos: Infinity }),
        AGORA
      )
    ).toBeNull();
  });

  it('ponto com coordenada impossível derruba a recuperação inteira', () => {
    const bruto = JSON.stringify({
      versao: 1,
      salvoEmMs: AGORA,
      distanciaKm: 1,
      velocidadeMaxNos: 1,
      ultimaPosicaoEmMs: null,
      pontos: [[999, -37, AGORA]],
    });
    expect(desserializarTrilha(bruto, AGORA)).toBeNull();
  });

  /** Arquivo adulterado não pode fazer o app carregar meio milhão de pontos. */
  it('respeita o teto de memória da sessão viva', () => {
    const muitos = Array.from({ length: TETO_PONTOS_BRUTOS + 500 }, (_, i) => [
      -4.9,
      -37.0,
      AGORA + i,
    ]);
    const bruto = JSON.stringify({
      versao: 1,
      salvoEmMs: AGORA,
      distanciaKm: 1,
      velocidadeMaxNos: 1,
      ultimaPosicaoEmMs: null,
      pontos: muitos,
    });
    expect(desserializarTrilha(bruto, AGORA)?.pontos.length).toBe(TETO_PONTOS_BRUTOS);
  });
});

describe('valePenaRecuperar', () => {
  it('trilha de verdade vale', () => {
    expect(valePenaRecuperar(comTrilha())).toBe(true);
  });

  /** Sessão de dois pontos parados não merece um aviso na abertura da tela. */
  it('sessão sem distância não vale o aviso', () => {
    expect(valePenaRecuperar(comTrilha({ distanciaKm: 0 }))).toBe(false);
    expect(valePenaRecuperar(comTrilha({ pontos: [[-4.9, -37, AGORA]] }))).toBe(false);
    expect(valePenaRecuperar(null)).toBe(false);
  });
});

describe('prefillDeTrilhaSalva', () => {
  const trilhaDeUmaHora: EstadoTrilha = {
    ...ESTADO_INICIAL_TRILHA,
    distanciaKm: 18.4,
    velocidadeMaxNos: 22,
    pontos: [
      [-4.9, -37.0, AGORA],
      [-4.95, -37.0, AGORA + 30 * 60_000],
      [-5.0, -37.0, AGORA + 60 * 60_000],
    ],
  };

  /**
   * A sutileza que motivou a função. O velejador pode reabrir o app no dia
   * seguinte; usar `Date.now()` como fim somaria todo o tempo de app fechado
   * à duração, e um velejo de 60 minutos viraria um de 14 horas no histórico.
   * Mesmo cuidado de `instanteDeEncerramento` em lib/downwindAbandono.ts.
   */
  it('a duração sai do último ponto, não do relógio de agora', () => {
    const prefill = prefillDeTrilhaSalva(trilhaDeUmaHora);
    expect(prefill?.durationMinutes).toBe(60);
  });

  it('leva distância, velocidade máxima e a trilha', () => {
    const prefill = prefillDeTrilhaSalva(trilhaDeUmaHora);
    expect(prefill?.distanceKm).toBeCloseTo(18.4, 1);
    expect(prefill?.trilhaReduzida?.length).toBeGreaterThan(0);
  });

  it('trilha curta demais não vira prefill', () => {
    expect(prefillDeTrilhaSalva({ ...ESTADO_INICIAL_TRILHA, pontos: [] })).toBeNull();
    expect(
      prefillDeTrilhaSalva({ ...ESTADO_INICIAL_TRILHA, pontos: [[-4.9, -37, AGORA]] })
    ).toBeNull();
  });

  /** Relógio do aparelho mexido no meio da sessão: sem duração confiável. */
  it('fim anterior ao início não vira prefill', () => {
    expect(
      prefillDeTrilhaSalva({
        ...ESTADO_INICIAL_TRILHA,
        distanciaKm: 5,
        pontos: [
          [-4.9, -37, AGORA],
          [-4.95, -37, AGORA - 60_000],
        ],
      })
    ).toBeNull();
  });
});
