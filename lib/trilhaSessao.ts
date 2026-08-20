/**
 * Trilha de sessão do Modo Navegação: distância percorrida, velocidade atual
 * e velocidade máxima, calculadas a partir do `watchPosition` do navegador.
 *
 * Tensão de projeto com `lib/usePositionBeacon.ts`: aquele hook usa
 * `enableHighAccuracy: false` de propósito, porque só precisa saber o bairro
 * para o SOS e roda o tempo todo, em qualquer tela, então poupar bateria é a
 * prioridade. Aqui é o oposto: velocidade e distância exigem precisão, e o
 * hook (`useTrilhaSessao`) só liga o GPS de alta precisão enquanto o Modo
 * Navegação está aberto — que é exatamente quando a tela já está ligada
 * (Wake Lock) e o velejador pediu para ver esses números. Não há orçamento
 * de bateria extra sendo gasto "de graça": o consumo de `enableHighAccuracy`
 * já está pago pela tela acesa da própria feature.
 *
 * Tudo aqui é função pura sobre tipos simples — sem `navigator`, sem DOM —
 * para ser testável em ambiente Node puro (ver README dos testes de
 * `usePositionBeacon` e `useWakeLock`, mesmo padrão). `useTrilhaSessao.ts` é
 * só a casca fina que liga `watchPosition` a `processarAmostra`.
 */

import { haversineKm, LatLng } from './geo';

const NOS_POR_MPS = 1.94384;

// ---------------------------------------------------------------------------
// Limiares dos filtros. Cada um existe para descartar uma categoria
// específica de amostra ruim de GPS antes que ela contamine a distância
// acumulada ou a velocidade máxima.
// ---------------------------------------------------------------------------

/**
 * Acurácia máxima aceita, em metros, para uma amostra entrar em qualquer
 * cálculo (distância ou velocidade derivada).
 *
 * `enableHighAccuracy: true` em mar aberto tipicamente entrega 5-20m de
 * acurácia (fix por satélite, sem prédios/paredes por perto). 50m já indica
 * um fix degradado (poucos satélites, fix assistido por rede) que ainda pode
 * ser útil para "onde no mapa", mas não para medir deslocamento de poucos
 * metros entre leituras. Acima disso o erro do próprio GPS é da mesma ordem
 * de grandeza (ou maior) que o deslocamento real de um velejador entre
 * leituras de poucos segundos — usar essas amostras adicionaria mais ruído
 * do que sinal.
 */
const ACURACIA_MAX_M = 50;

/**
 * Deslocamento mínimo, em metros, para ser somado à distância acumulada.
 * Abaixo disso, o "movimento" é tratado como ruído do próprio GPS.
 *
 * Com o teto de acurácia de 50m acima, duas leituras consecutivas de um
 * aparelho PARADO podem oscilar por várias dezenas de metros só por erro de
 * medição (o círculo de incerteza de cada leitura pode não se sobrepor
 * exatamente ao da anterior). 15m é maior que a oscilação típica observada
 * com boa acurácia (tipicamente <10m em mar aberto, sem obstrução), mas bem
 * menor que qualquer deslocamento real relevante de alguém navegando de
 * kite (que se move rápido quando se move). O efeito prático: um aparelho
 * parado na praia ou boiando parado não acumula distância; um velejador em
 * movimento real, sim.
 */
const DESLOCAMENTO_MIN_M = 15;

/**
 * Velocidade máxima fisicamente plausível para uma sessão de kitesurf, em
 * nós. Usada para descartar tanto leituras de `speed` quanto velocidades
 * derivadas de duas posições (o caso clássico de "salto de torre de
 * celular": um fix urbano impreciso seguido de outro a centenas de metros de
 * distância, um segundo depois, implicando centenas de nós).
 *
 * O recorde mundial de velocidade em kitesurf (vela de speed, condições
 * ideais) é de ~65 nós (categoria "Speed" do GKA/WSSRC). 90 nós dá quase 40%
 * de folga sobre o recorde mundial absoluto — generoso o bastante para nunca
 * descartar uma leitura real de um velejador rápido, mas ainda muito abaixo
 * do que um salto de GPS produz (esses tipicamente implicam centenas a
 * milhares de nós, porque o deslocamento espúrio é de centenas de metros em
 * 1-2s).
 */
const VELOCIDADE_MAX_NOS = 90;

/**
 * Uma leitura de posição do GPS, já reduzida aos campos que importam para o
 * cálculo (evita acoplar as funções puras ao tipo `GeolocationPosition` do
 * DOM, que não existe no ambiente de teste Node).
 */
export interface AmostraGps {
  lat: number;
  lng: number;
  /** Acurácia horizontal em metros, conforme `position.coords.accuracy`. */
  accuracy: number;
  /**
   * Velocidade em m/s conforme `position.coords.speed`. `null` quando o
   * aparelho não preenche o campo; negativo (ex.: -1) em alguns aparelhos
   * quando "desconhecido" — ambos os casos são tratados como "sem leitura
   * direta de velocidade", caindo no cálculo derivado por distância/tempo.
   */
  speedMps: number | null;
  /** Instante da leitura, em epoch ms (`Date.now()` ou `position.timestamp`). */
  timestampMs: number;
}

export interface EstadoTrilha {
  distanciaKm: number;
  velocidadeNos: number | null;
  velocidadeMaxNos: number;
  ultimaPosicaoEm: Date | null;
  indisponivel: boolean;
  /**
   * Última posição ACEITA (passou nos filtros de acurácia), usada como
   * referência para o próximo cálculo de distância/velocidade derivada.
   * Guardada à parte de `ultimaPosicaoEm`/`velocidadeNos` porque uma amostra
   * pode ser rejeitada (ex.: salto impossível) sem que a posição de
   * referência para a PRÓXIMA amostra deva avançar — ver comentário em
   * `processarAmostra`.
   */
  ultimaReferencia: { pos: LatLng; timestampMs: number } | null;
}

export const ESTADO_INICIAL_TRILHA: EstadoTrilha = {
  distanciaKm: 0,
  velocidadeNos: null,
  velocidadeMaxNos: 0,
  ultimaPosicaoEm: null,
  indisponivel: false,
  ultimaReferencia: null,
};

function mpsParaNos(mps: number): number {
  return mps * NOS_POR_MPS;
}

/**
 * Velocidade "direta" do aparelho, em nós, ou `null` se o campo não é
 * confiável (ausente ou negativo). Alguns aparelhos usam -1 (ou qualquer
 * negativo) para "desconhecido" em vez de `null` — fisicamente uma
 * velocidade não pode ser negativa, então qualquer valor negativo é tratado
 * como ausência de leitura, não como dado.
 */
function velocidadeDireta(speedMps: number | null): number | null {
  if (speedMps === null || speedMps < 0) return null;
  return mpsParaNos(speedMps);
}

/**
 * Processa uma nova amostra de GPS contra o estado anterior da trilha,
 * aplicando todos os filtros de qualidade antes de aceitar distância ou
 * velocidade. É a função central e testável de todo o módulo — o hook
 * (`useTrilhaSessao`) não toma nenhuma decisão, só chama esta função a cada
 * evento de `watchPosition`.
 *
 * Ordem de decisão, e por quê:
 * 1. Acurácia ruim -> rejeita a amostra inteira. Sem uma posição confiável,
 *    nem distância nem velocidade derivada fazem sentido.
 * 2. Sem referência anterior (primeira amostra aceita da sessão) -> aceita
 *    a posição como ponto de partida, mas não há como calcular distância
 *    percorrida nem velocidade derivada ainda (não existe "anterior").
 *    Usa `speed` direto se disponível.
 * 3. Com referência anterior -> calcula distância e tempo decorrido,
 *    deriva a velocidade implícita e testa contra o teto de plausibilidade
 *    física. Se implausível, é tratada como salto de GPS: a amostra é
 *    descartada por completo (não vira nova referência, não altera
 *    distância nem velocidade) — é assim que evitamos tanto uma distância
 *    inflada quanto uma velocidade máxima fantasia por um único salto.
 * 4. Se plausível mas abaixo do limiar de deslocamento mínimo -> não soma
 *    à distância (é ruído de GPS parado), mas ainda assim vira a nova
 *    referência e pode atualizar velocidade (tipicamente perto de zero,
 *    o que é o valor correto para "parado").
 * 5. Se plausível e acima do limiar -> soma à distância, atualiza
 *    velocidade e velocidade máxima.
 */
export function processarAmostra(estado: EstadoTrilha, amostra: AmostraGps): EstadoTrilha {
  if (amostra.accuracy > ACURACIA_MAX_M) {
    // Amostra ruim demais: não mexe em nada, mantém o último estado válido.
    return estado;
  }

  const posAtual: LatLng = { lat: amostra.lat, lng: amostra.lng };
  const dataAmostra = new Date(amostra.timestampMs);

  if (estado.ultimaReferencia === null) {
    // Primeira posição confiável da sessão: vira a referência, mas ainda não
    // há "anterior" para medir distância ou derivar velocidade.
    const velocidade = velocidadeDireta(amostra.speedMps);
    return {
      ...estado,
      velocidadeNos: velocidade,
      velocidadeMaxNos:
        velocidade !== null && velocidade <= VELOCIDADE_MAX_NOS
          ? Math.max(estado.velocidadeMaxNos, velocidade)
          : estado.velocidadeMaxNos,
      ultimaPosicaoEm: dataAmostra,
      indisponivel: false,
      ultimaReferencia: { pos: posAtual, timestampMs: amostra.timestampMs },
    };
  }

  const deltaTMs = amostra.timestampMs - estado.ultimaReferencia.timestampMs;
  if (deltaTMs <= 0) {
    // Amostra fora de ordem ou duplicada (mesmo timestamp): não há como
    // derivar velocidade (divisão por zero/negativo) nem faz sentido
    // avançar a trilha para "trás" no tempo. Ignora.
    return estado;
  }

  const distanciaM = haversineKm(estado.ultimaReferencia.pos, posAtual) * 1000;
  const velocidadeImplicitaNos = mpsParaNos(distanciaM / (deltaTMs / 1000));

  if (velocidadeImplicitaNos > VELOCIDADE_MAX_NOS) {
    // Salto impossível (ex.: torre de celular): descarta a amostra por
    // completo. Não vira referência nova nem contribui para distância ou
    // velocidade máxima — se virasse referência, o PRÓXIMO cálculo de
    // distância partiria de um ponto espúrio e propagaria o erro adiante.
    return estado;
  }

  // Velocidade preferida é a direta do aparelho; só deriva de posição quando
  // o aparelho não fornece `speed` (ou fornece valor negativo/desconhecido).
  const velocidade = velocidadeDireta(amostra.speedMps) ?? velocidadeImplicitaNos;

  const distanciaAceita = distanciaM >= DESLOCAMENTO_MIN_M;

  // CUIDADO — isto é o ponto onde uma versão anterior deste arquivo tinha um
  // bug grave: quando o deslocamento fica abaixo do limiar, a referência
  // NÃO pode avançar para a posição atual. Se avançasse, cada amostra
  // reiniciaria a medição do zero e um deslocamento real, porém pequeno
  // amostra-a-amostra (ex.: 5 nós com `watchPosition` disparando a ~1Hz dá
  // só ~2,6m por amostra, sempre abaixo dos 15m), NUNCA se acumularia — a
  // distância de uma sessão inteira ficaria perto de zero, o oposto do que
  // a feature existe para medir.
  //
  // Mantendo a referência antiga, o deslocamento pendente se acumula
  // naturalmente nas próximas amostras (a distância Haversine é medida
  // sempre a partir do mesmo ponto de partida) e é somado de uma vez quando
  // finalmente cruza o limiar. Nada se perde. A proteção contra deriva de
  // aparelho parado continua válida, porque oscilação de GPS parado é ruído
  // aleatório em torno de um ponto fixo — não se afasta de forma sustentada
  // o suficiente para cruzar o limiar por acúmulo, ao contrário de um
  // deslocamento real.
  //
  // Efeito colateral (desejado) sobre a velocidade DERIVADA: com a
  // referência mais antiga, tanto a distância quanto o `deltaT` usados em
  // `velocidadeImplicitaNos` crescem juntos a cada amostra pendente, então a
  // velocidade derivada continua correta — e fica até mais estável, por
  // virar a média de uma janela maior em vez de uma medida entre dois
  // pontos quase colados no tempo/espaço.
  //
  // `ultimaPosicaoEm`, em contraste, avança em TODA amostra aceita pelos
  // filtros de acurácia/plausibilidade, mesmo com distância pendente: ela
  // alimenta o indicador de sinal (ver `estadoSinal` em lib/downwind.ts) e
  // não tem relação nenhuma com o limiar de deslocamento — se ela parasse
  // de avançar aqui, o Modo Navegação mostraria "sem sinal" com o GPS
  // funcionando perfeitamente.
  return {
    distanciaKm: estado.distanciaKm + (distanciaAceita ? distanciaM / 1000 : 0),
    velocidadeNos: velocidade,
    velocidadeMaxNos: Math.max(estado.velocidadeMaxNos, velocidade),
    ultimaPosicaoEm: dataAmostra,
    indisponivel: false,
    ultimaReferencia: distanciaAceita
      ? { pos: posAtual, timestampMs: amostra.timestampMs }
      : estado.ultimaReferencia,
  };
}

/**
 * Marca a trilha como indisponível (GPS sem suporte, permissão negada, ou
 * erro persistente do `watchPosition`). Não zera o que já foi acumulado —
 * se o sinal cair no meio da sessão e voltar depois, a distância percorrida
 * até ali continua válida; só os números "ao vivo" (velocidade atual) devem
 * refletir a perda de sinal, e isso é responsabilidade da UI ao ler
 * `indisponivel`, não desta função apagar dado histórico.
 */
export function marcarIndisponivel(estado: EstadoTrilha): EstadoTrilha {
  return { ...estado, indisponivel: true };
}
