import { describe, expect, it } from 'vitest';
import {
  AmostraGps,
  ESTADO_INICIAL_TRILHA,
  EstadoTrilha,
  marcarIndisponivel,
  paraPrefillLogbook,
  processarAmostra,
  TETO_PONTOS_BRUTOS,
  valePenaRegistrarSessao,
  validarTrilhaReduzida,
} from './trilhaSessao';

/**
 * `processarAmostra` é o coração da trilha de sessão: aqui moram os filtros
 * que separam deslocamento real de ruído de GPS. Os casos abaixo cobrem cada
 * armadilha citada no briefing: aparelho parado que "anda" sozinho, leitura
 * de baixa qualidade, salto impossível de torre de celular, `speed` nulo ou
 * negativo, e a conversão m/s -> nós.
 */

const LAT_BASE = -4.9572;
const LNG_BASE = -36.8833;
const T0 = 1_700_000_000_000;

function amostra(overrides: Partial<AmostraGps>): AmostraGps {
  return {
    lat: LAT_BASE,
    lng: LNG_BASE,
    accuracy: 10,
    speedMps: null,
    timestampMs: T0,
    ...overrides,
  };
}

/** Desloca uma coordenada aproximadamente `metros` para leste, a partir da base. */
function deslocarLng(metros: number): number {
  // ~111_320m por grau de longitude nesta latitude (aproximação suficiente
  // para gerar amostras de teste; não é o código sob teste).
  const metrosPorGrauLng = 111_320 * Math.cos((LAT_BASE * Math.PI) / 180);
  return LNG_BASE + metros / metrosPorGrauLng;
}

describe('processarAmostra', () => {
  it('primeira amostra vira referência sem acumular distância', () => {
    const estado = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({}));
    expect(estado.distanciaKm).toBe(0);
    expect(estado.ultimaPosicaoEm).toEqual(new Date(T0));
    expect(estado.indisponivel).toBe(false);
  });

  it('aparelho parado oscilando dentro do ruído do GPS não acumula distância', () => {
    let estado: EstadoTrilha = ESTADO_INICIAL_TRILHA;
    // Sequência de leituras "paradas": oscilam poucos metros a cada leitura,
    // todas abaixo do limiar de deslocamento mínimo (15m).
    const oscilacoesM = [0, 6, -4, 8, -7, 5, 3, -6];
    let t = T0;
    for (const deslocamento of oscilacoesM) {
      estado = processarAmostra(
        estado,
        amostra({ lng: deslocarLng(deslocamento), timestampMs: t })
      );
      t += 2_000;
    }
    expect(estado.distanciaKm).toBe(0);
  });

  it('amostra com accuracy ruim (acima do teto) é descartada por completo', () => {
    const base = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({}));
    const comAcuraciaRuim = processarAmostra(
      base,
      amostra({ lng: deslocarLng(100), accuracy: 80, timestampMs: T0 + 2_000 })
    );
    // Estado inalterado: a amostra ruim não vira referência nem move nada.
    expect(comAcuraciaRuim).toEqual(base);
  });

  it('salto impossível é descartado e NÃO vira velocidade máxima', () => {
    const base = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({}));
    // 2000m em 1s implica ~3891 nós, muito acima do teto de 90 nós.
    const comSalto = processarAmostra(
      base,
      amostra({ lng: deslocarLng(2000), accuracy: 10, timestampMs: T0 + 1_000 })
    );
    expect(comSalto).toEqual(base);
    expect(comSalto.velocidadeMaxNos).toBe(0);
    expect(comSalto.distanciaKm).toBe(0);
  });

  it('speed nulo cai no cálculo derivado por distância/tempo', () => {
    const base = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({ speedMps: null }));
    // 20m em 10s = 2 m/s = ~3.8877 nós.
    const proxima = processarAmostra(
      base,
      amostra({ lng: deslocarLng(20), speedMps: null, timestampMs: T0 + 10_000 })
    );
    expect(proxima.velocidadeNos).not.toBeNull();
    expect(proxima.velocidadeNos!).toBeCloseTo(2 * 1.94384, 2);
  });

  it('speed negativo é tratado como desconhecido, cai no cálculo derivado', () => {
    const base = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({ speedMps: -1 }));
    const proxima = processarAmostra(
      base,
      amostra({ lng: deslocarLng(20), speedMps: -1, timestampMs: T0 + 10_000 })
    );
    expect(proxima.velocidadeNos!).toBeCloseTo(2 * 1.94384, 2);
  });

  it('conversão m/s -> nós é exata quando speed direto está disponível', () => {
    const estado = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({ speedMps: 10 }));
    expect(estado.velocidadeNos).toBeCloseTo(10 * 1.94384, 6);
    expect(estado.velocidadeMaxNos).toBeCloseTo(10 * 1.94384, 6);
  });

  it('speed direto tem prioridade sobre o derivado quando disponível e não-negativo', () => {
    const base = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({ speedMps: 5 }));
    // Desloca 20m em 10s (implicaria ~3.89 nós derivado), mas speed direto diz 8 m/s.
    const proxima = processarAmostra(
      base,
      amostra({ lng: deslocarLng(20), speedMps: 8, timestampMs: T0 + 10_000 })
    );
    expect(proxima.velocidadeNos).toBeCloseTo(8 * 1.94384, 6);
  });

  it('sequência realista de várias amostras acumula distância plausível', () => {
    let estado: EstadoTrilha = ESTADO_INICIAL_TRILHA;
    let t = T0;
    let distanciaEsperadaM = 0;
    // Velejador avançando ~50m a cada 5s (~10 m/s, ~19.4 nós, plausível).
    for (let i = 0; i < 10; i++) {
      const deslocamentoTotalM = i * 50;
      estado = processarAmostra(
        estado,
        amostra({ lng: deslocarLng(deslocamentoTotalM), timestampMs: t })
      );
      if (i > 0) distanciaEsperadaM += 50;
      t += 5_000;
    }
    const distanciaEsperadaKm = distanciaEsperadaM / 1000;
    expect(estado.distanciaKm).toBeCloseTo(distanciaEsperadaKm, 2);
    expect(estado.velocidadeMaxNos).toBeGreaterThan(0);
    expect(estado.velocidadeMaxNos).toBeLessThan(90);
  });

  /**
   * Regressão do bug relatado: com `watchPosition` a ~1Hz, cada amostra
   * individual desloca menos que `DESLOCAMENTO_MIN_M` (15m), mesmo com o
   * velejador em movimento real e contínuo. Se a referência avançasse a
   * cada amostra (implementação anterior), a distância nunca cruzaria o
   * limiar e ficaria perto de zero numa sessão inteira. A referência deve
   * ficar parada enquanto o deslocamento acumulado não cruza o limiar, e o
   * trecho pendente deve ser somado de uma vez quando cruzar.
   */
  it('movimento lento e contínuo (~5 nós, amostras de 1s) acumula distância real', () => {
    const NOS_5_EM_MPS = 5 / 1.94384;
    let estado: EstadoTrilha = ESTADO_INICIAL_TRILHA;
    let t = T0;
    let distanciaRealM = 0;
    const DURACAO_S = 180; // 3 minutos

    for (let i = 0; i <= DURACAO_S; i++) {
      estado = processarAmostra(
        estado,
        amostra({ lng: deslocarLng(distanciaRealM), timestampMs: t })
      );
      distanciaRealM += NOS_5_EM_MPS * 1; // avança 1s de deslocamento real
      t += 1_000;
    }

    const distanciaRealKm = (distanciaRealM - NOS_5_EM_MPS) / 1000; // última posição não é "vivida"
    // Tolerância pequena: perdas só nas bordas (deslocamento pendente no
    // fim da simulação que ainda não cruzou o limiar).
    expect(estado.distanciaKm).toBeGreaterThan(distanciaRealKm * 0.9);
    expect(estado.distanciaKm).toBeLessThanOrEqual(distanciaRealKm * 1.01);
  });

  it('movimento lento e contínuo (~20 nós, amostras de 1s) acumula distância real', () => {
    const NOS_20_EM_MPS = 20 / 1.94384;
    let estado: EstadoTrilha = ESTADO_INICIAL_TRILHA;
    let t = T0;
    let distanciaRealM = 0;
    const DURACAO_S = 120; // 2 minutos

    for (let i = 0; i <= DURACAO_S; i++) {
      estado = processarAmostra(
        estado,
        amostra({ lng: deslocarLng(distanciaRealM), timestampMs: t })
      );
      distanciaRealM += NOS_20_EM_MPS * 1;
      t += 1_000;
    }

    const distanciaRealKm = (distanciaRealM - NOS_20_EM_MPS) / 1000;
    expect(estado.distanciaKm).toBeGreaterThan(distanciaRealKm * 0.9);
    expect(estado.distanciaKm).toBeLessThanOrEqual(distanciaRealKm * 1.01);
  });

  it('aparelho parado com oscilação aleatória continua sem acumular distância significativa (regressão)', () => {
    let estado: EstadoTrilha = ESTADO_INICIAL_TRILHA;
    // Oscilação pseudo-aleatória em torno de um ponto fixo, sem tendência de
    // afastamento — o caso que a correção não pode reintroduzir como bug.
    const oscilacoesM = [0, 4, -3, 6, -5, 2, -4, 7, -6, 3, -2, 5, -7, 4, -3];
    let t = T0;
    for (const deslocamento of oscilacoesM) {
      estado = processarAmostra(
        estado,
        amostra({ lng: deslocarLng(deslocamento), timestampMs: t })
      );
      t += 2_000;
    }
    expect(estado.distanciaKm).toBe(0);
  });

  it('ultimaPosicaoEm avança a cada amostra aceita, mesmo com distância pendente', () => {
    // 5 nós ~= 2.57 m/s: cada amostra de 1s desloca bem menos que os 15m do
    // limiar, então a distância fica pendente por várias amostras seguidas
    // — mas o timestamp de "última posição" precisa avançar mesmo assim,
    // porque alimenta o indicador de sinal (estadoSinal em lib/downwind.ts),
    // que não tem relação com o limiar de deslocamento.
    const NOS_5_EM_MPS = 5 / 1.94384;
    let estado: EstadoTrilha = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({ timestampMs: T0 }));
    expect(estado.distanciaKm).toBe(0);

    for (let i = 1; i <= 5; i++) {
      const tAmostra = T0 + i * 1_000;
      estado = processarAmostra(
        estado,
        amostra({ lng: deslocarLng(NOS_5_EM_MPS * i), timestampMs: tAmostra })
      );
      // Ainda dentro do limiar de deslocamento (< 15m) nestas primeiras amostras.
      expect(estado.ultimaPosicaoEm).toEqual(new Date(tAmostra));
    }
  });

  it('amostra fora de ordem (timestamp igual ou anterior) é ignorada', () => {
    const base = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({}));
    const foraDeOrdem = processarAmostra(
      base,
      amostra({ lng: deslocarLng(100), timestampMs: T0 })
    );
    expect(foraDeOrdem).toEqual(base);
  });
});

/**
 * `pontos` é a geometria da trilha — o que faltava para o feed (Fase 3 do
 * plano de rede social) ter algo para desenhar. Os testes seguem o mesmo
 * critério de aceitação de `processarAmostra`: uma amostra só vira ponto
 * quando também é aceita para o resto do estado (acurácia ok, sem salto
 * impossível) — nunca um segundo filtro divergente.
 */
describe('pontos (geometria da trilha)', () => {
  it('amostra aceita entra em pontos', () => {
    const estado = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({}));
    expect(estado.pontos).toEqual([[LAT_BASE, LNG_BASE, T0]]);
  });

  it('amostra com acurácia ruim (acima do teto) NÃO entra em pontos', () => {
    const base = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({}));
    const comAcuraciaRuim = processarAmostra(
      base,
      amostra({ lng: deslocarLng(100), accuracy: 80, timestampMs: T0 + 2_000 })
    );
    expect(comAcuraciaRuim.pontos).toEqual(base.pontos);
    expect(comAcuraciaRuim.pontos).toHaveLength(1);
  });

  it('amostra com salto impossível NÃO entra em pontos', () => {
    const base = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({}));
    const comSalto = processarAmostra(
      base,
      amostra({ lng: deslocarLng(2000), timestampMs: T0 + 1_000 })
    );
    expect(comSalto.pontos).toEqual(base.pontos);
    expect(comSalto.pontos).toHaveLength(1);
  });

  it('amostra parada (abaixo do limiar de deslocamento) ainda assim entra em pontos', () => {
    // A geometria real de alguém parado é "estar parado" — só a distância
    // acumulada (odômetro) é que fica pendente abaixo do limiar, não a trilha.
    let estado: EstadoTrilha = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({}));
    estado = processarAmostra(estado, amostra({ lng: deslocarLng(3), timestampMs: T0 + 2_000 }));
    expect(estado.distanciaKm).toBe(0);
    expect(estado.pontos).toHaveLength(2);
  });

  it('amostra fora de ordem NÃO entra em pontos', () => {
    const base = processarAmostra(ESTADO_INICIAL_TRILHA, amostra({}));
    const foraDeOrdem = processarAmostra(
      base,
      amostra({ lng: deslocarLng(100), timestampMs: T0 })
    );
    expect(foraDeOrdem.pontos).toEqual(base.pontos);
  });

  it('cruzar TETO_PONTOS_BRUTOS reamostra pela metade em vez de crescer sem limite', () => {
    let estado: EstadoTrilha = ESTADO_INICIAL_TRILHA;
    let t = T0;
    // Uma amostra a mais que o teto — todas aceitas (paradas mesmo, o que não
    // importa aqui: só a contagem de pontos está sob teste).
    for (let i = 0; i <= TETO_PONTOS_BRUTOS; i++) {
      estado = processarAmostra(estado, amostra({ timestampMs: t }));
      t += 1_000;
    }
    // Nunca ultrapassa o teto — reamostrou em vez de crescer.
    expect(estado.pontos.length).toBeLessThanOrEqual(TETO_PONTOS_BRUTOS);
    // Preserva o ponto mais recente (o último timestamp gerado no laço).
    const ultimoTsGerado = t - 1_000;
    expect(estado.pontos[estado.pontos.length - 1][2]).toBe(ultimoTsGerado);
  });
});

describe('marcarIndisponivel', () => {
  it('marca indisponivel sem apagar distância já acumulada', () => {
    let estado: EstadoTrilha = ESTADO_INICIAL_TRILHA;
    estado = processarAmostra(estado, amostra({}));
    estado = processarAmostra(
      estado,
      amostra({ lng: deslocarLng(100), timestampMs: T0 + 5_000 })
    );
    expect(estado.distanciaKm).toBeGreaterThan(0);

    const indisponivel = marcarIndisponivel(estado);
    expect(indisponivel.indisponivel).toBe(true);
    expect(indisponivel.distanciaKm).toBe(estado.distanciaKm);
  });
});

describe('valePenaRegistrarSessao', () => {
  it('rejeita sessão sem distância nem velocidade (toque acidental no botão)', () => {
    expect(valePenaRegistrarSessao({ distanciaKm: 0, velocidadeMaxNos: 0 })).toBe(false);
  });

  it('rejeita distância e velocidade abaixo dos dois limiares', () => {
    expect(valePenaRegistrarSessao({ distanciaKm: 0.05, velocidadeMaxNos: 0.5 })).toBe(false);
  });

  it('aceita quando a distância cruza o limiar, mesmo com velocidade baixa', () => {
    expect(valePenaRegistrarSessao({ distanciaKm: 0.1, velocidadeMaxNos: 0 })).toBe(true);
    expect(valePenaRegistrarSessao({ distanciaKm: 5, velocidadeMaxNos: 0 })).toBe(true);
  });

  it('aceita quando a velocidade cruza o limiar, mesmo com distância baixa', () => {
    expect(valePenaRegistrarSessao({ distanciaKm: 0, velocidadeMaxNos: 1 })).toBe(true);
    expect(valePenaRegistrarSessao({ distanciaKm: 0, velocidadeMaxNos: 25 })).toBe(true);
  });
});

describe('paraPrefillLogbook', () => {
  it('converte distância e velocidade máxima com uma casa decimal', () => {
    const prefill = paraPrefillLogbook(
      {
        distanciaKm: 28.4444,
        velocidadeMaxNos: 26.789,
        iniciadoEm: new Date('2026-08-21T15:30:00'),
      },
      new Date('2026-08-21T17:00:00')
    );
    expect(prefill.distanceKm).toBe(28.4);
    expect(prefill.maxSpeedKnots).toBe(26.8);
  });

  it('calcula a duração em minutos a partir de início e agora', () => {
    const prefill = paraPrefillLogbook(
      {
        distanciaKm: 10,
        velocidadeMaxNos: 20,
        iniciadoEm: new Date('2026-08-21T15:30:00'),
      },
      new Date('2026-08-21T17:00:00')
    );
    expect(prefill.durationMinutes).toBe(90);
  });

  it('nunca devolve duração zero — mínimo de 1 minuto mesmo para sessão de segundos', () => {
    const inicio = new Date('2026-08-21T15:30:00');
    const prefill = paraPrefillLogbook(
      { distanciaKm: 0.1, velocidadeMaxNos: 1, iniciadoEm: inicio },
      new Date(inicio.getTime() + 3_000) // 3 segundos depois
    );
    expect(prefill.durationMinutes).toBe(1);
  });

  it('formata data (YYYY-MM-DD) e horário (HH:MM) a partir do início, com zero à esquerda', () => {
    const prefill = paraPrefillLogbook(
      {
        distanciaKm: 10,
        velocidadeMaxNos: 20,
        iniciadoEm: new Date('2026-01-05T08:05:00'),
      },
      new Date('2026-01-05T09:00:00')
    );
    expect(prefill.date).toBe('2026-01-05');
    expect(prefill.startTime).toBe('08:05');
  });

  it('sem trilha (chamador antigo, ou sessão sem nenhum ponto aceito) devolve trilhaReduzida vazia', () => {
    const prefill = paraPrefillLogbook(
      { distanciaKm: 10, velocidadeMaxNos: 20, iniciadoEm: new Date('2026-01-05T08:05:00') },
      new Date('2026-01-05T09:00:00')
    );
    expect(prefill.trilhaReduzida).toEqual([]);
  });

  it('reduz a trilha a no máximo 200 pontos, sempre preservando o mais recente', () => {
    const trilhaLonga: [number, number, number][] = Array.from({ length: 500 }, (_, i) => [
      LAT_BASE,
      deslocarLng(i * 20),
      T0 + i * 5_000,
    ]);
    const prefill = paraPrefillLogbook(
      {
        distanciaKm: 10,
        velocidadeMaxNos: 20,
        iniciadoEm: new Date('2026-01-05T08:05:00'),
        trilha: trilhaLonga,
      },
      new Date('2026-01-05T09:00:00')
    );
    expect(prefill.trilhaReduzida.length).toBeLessThanOrEqual(200);
    expect(prefill.trilhaReduzida[prefill.trilhaReduzida.length - 1]).toEqual(
      trilhaLonga[trilhaLonga.length - 1]
    );
  });
});

/**
 * Validação de servidor de POST /api/sessions — a trilha vem do cliente, e o
 * servidor não pode confiar que ela chegou no formato esperado (ver
 * comentário de `validarTrilhaReduzida`). Forma inválida vira `null`, nunca
 * lança: a rota grava `null` e segue gravando o resto da sessão.
 */
describe('validarTrilhaReduzida', () => {
  it('trilha válida passa e vem de volta reamostrada (idempotente quando já ≤ limite)', () => {
    const trilha: [number, number, number][] = [
      [-4.95, -36.88, T0],
      [-4.96, -36.89, T0 + 60_000],
    ];
    expect(validarTrilhaReduzida(trilha)).toEqual(trilha);
  });

  it('não é array -> null', () => {
    expect(validarTrilhaReduzida('não é array')).toBeNull();
    expect(validarTrilhaReduzida({ lat: 1, lng: 2 })).toBeNull();
    expect(validarTrilhaReduzida(null)).toBeNull();
    expect(validarTrilhaReduzida(undefined)).toBeNull();
  });

  it('array vazio -> null (nada para desenhar)', () => {
    expect(validarTrilhaReduzida([])).toBeNull();
  });

  it('item que não é array de 3 números -> trilha inteira null', () => {
    expect(validarTrilhaReduzida([[-4.95, -36.88, T0], [-4.96, -36.89]])).toBeNull();
    expect(validarTrilhaReduzida([[-4.95, -36.88, T0, 999]])).toBeNull();
    expect(validarTrilhaReduzida([['-4.95', -36.88, T0]])).toBeNull();
  });

  it('lat fora de [-90,90] -> trilha inteira null', () => {
    expect(validarTrilhaReduzida([[91, -36.88, T0]])).toBeNull();
    expect(validarTrilhaReduzida([[-91, -36.88, T0]])).toBeNull();
  });

  it('lng fora de [-180,180] -> trilha inteira null', () => {
    expect(validarTrilhaReduzida([[-4.95, 181, T0]])).toBeNull();
    expect(validarTrilhaReduzida([[-4.95, -181, T0]])).toBeNull();
  });

  it('timestamp não finito (NaN/Infinity) -> trilha inteira null', () => {
    expect(validarTrilhaReduzida([[-4.95, -36.88, NaN]])).toBeNull();
    expect(validarTrilhaReduzida([[-4.95, -36.88, Infinity]])).toBeNull();
  });

  it('trilha maior que o limite é reamostrada no servidor, nunca gravada inteira', () => {
    const trilha: [number, number, number][] = Array.from({ length: 500 }, (_, i) => [
      -4.95,
      -36.88 - i * 0.001,
      T0 + i * 60_000,
    ]);
    const validada = validarTrilhaReduzida(trilha);
    expect(validada).not.toBeNull();
    expect(validada!.length).toBeLessThanOrEqual(200);
    // Preserva o ponto mais recente, mesmo critério de amostrarTrilha.
    expect(validada![validada!.length - 1]).toEqual(trilha[trilha.length - 1]);
  });
});
