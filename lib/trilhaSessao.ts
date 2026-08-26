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
import { amostrarTrilha, PontoTrilha } from './trilhaDownwind';

const NOS_POR_MPS = 1.94384;

/**
 * Teto de pontos brutos acumulados na trilha da sessão, antes de reamostrar.
 *
 * Sem teto, uma travessia de 3h com `watchPosition` a ~1Hz chegaria a ~11 mil
 * pontos na memória de um celular — e isso é só a trilha bruta desta sessão,
 * competindo por RAM com o resto do app (mapa, animação de vento, chat) na
 * mesma aba. Ao cruzar o teto, `processarAmostra` reamostra a trilha pela
 * metade (mantém 1 a cada 2 pontos) em vez de continuar crescendo — mesmo
 * princípio de `passoAmostragem`/`amostrarTrilha` em `lib/trilhaDownwind.ts`,
 * só que aplicado incrementalmente aqui, porque esta trilha não tem um
 * tamanho final conhecido de antemão (a sessão pode durar minutos ou horas).
 */
export const TETO_PONTOS_BRUTOS = 5000;

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
  /**
   * Geometria da trilha: todo ponto ACEITO (mesmo critério de
   * `ultimaReferencia` — passou acurácia e não foi salto impossível), na
   * ordem em que chegou. É o que falta hoje para o feed (Fase 3 do plano de
   * rede social) ter uma trilha para desenhar: sem isto, cada amostra era
   * consumida por `processarAmostra` e descartada, e só a distância/
   * velocidade agregadas sobreviviam. Reutiliza `PontoTrilha` de
   * `lib/trilhaDownwind.ts` (tupla `[lat, lng, tsMs]`) de propósito — o
   * downwind em grupo já resolveu "como representar e reduzir uma trilha", e
   * duplicar esse tipo aqui só criaria duas fontes de verdade para geometria
   * de mapa que precisam alimentar exatamente o mesmo componente de desenho
   * mais adiante. Sujeito ao teto de `TETO_PONTOS_BRUTOS` — ver lá.
   */
  pontos: PontoTrilha[];
}

export const ESTADO_INICIAL_TRILHA: EstadoTrilha = {
  distanciaKm: 0,
  velocidadeNos: null,
  velocidadeMaxNos: 0,
  ultimaPosicaoEm: null,
  indisponivel: false,
  ultimaReferencia: null,
  pontos: [],
};

/**
 * Acrescenta um ponto aceito à trilha, aplicando o teto de memória.
 *
 * Ao cruzar `TETO_PONTOS_BRUTOS`, reamostra pela metade (mantém 1 a cada 2)
 * em vez de deixar o array crescer sem fim — ver o porquê no comentário de
 * `TETO_PONTOS_BRUTOS`. Sempre preserva o ponto mais recente (o que acabou de
 * ser adicionado): descartá-lo faria a trilha "parar" um pouco antes da
 * posição atual do velejador, mesmo com o GPS reportando normalmente — mesma
 * preocupação (e mesma solução) de `amostrarTrilha` em `lib/trilhaDownwind.ts`.
 */
function adicionarPonto(pontos: PontoTrilha[], novo: PontoTrilha): PontoTrilha[] {
  const comNovo = [...pontos, novo];
  if (comNovo.length <= TETO_PONTOS_BRUTOS) return comNovo;

  const reamostrado = comNovo.filter((_, i) => i % 2 === 0);
  const ultimo = comNovo[comNovo.length - 1];
  if (reamostrado[reamostrado.length - 1]?.[2] !== ultimo[2]) {
    reamostrado.push(ultimo);
  }
  return reamostrado;
}

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
    // há "anterior" para medir distância ou derivar velocidade. Já entra na
    // trilha (passou no único filtro que existe para ela nesta altura: a
    // acurácia) — ver `pontos` em EstadoTrilha.
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
      pontos: adicionarPonto(estado.pontos, [amostra.lat, amostra.lng, amostra.timestampMs]),
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
  //
  // `pontos`, igual a `ultimaPosicaoEm`, também não tem relação com o limiar
  // de deslocamento: a trilha registra a posição real do velejador amostra a
  // amostra (inclusive as que ficam paradas por baixo do limiar, que É a
  // geometria real de alguém parado n'água) — só distância acumulada e
  // referência de cálculo é que ficam pendentes. Reduzir a resolução da
  // trilha por causa do limiar de distância seria confundir "não vale a pena
  // somar ao odômetro" com "não aconteceu".
  return {
    distanciaKm: estado.distanciaKm + (distanciaAceita ? distanciaM / 1000 : 0),
    velocidadeNos: velocidade,
    velocidadeMaxNos: Math.max(estado.velocidadeMaxNos, velocidade),
    ultimaPosicaoEm: dataAmostra,
    indisponivel: false,
    ultimaReferencia: distanciaAceita
      ? { pos: posAtual, timestampMs: amostra.timestampMs }
      : estado.ultimaReferencia,
    pontos: adicionarPonto(estado.pontos, [amostra.lat, amostra.lng, amostra.timestampMs]),
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

// ---------------------------------------------------------------------------
// Registro pessoal: converter uma sessão do Modo Navegação (mapa normal, fora
// de um downwind em grupo) num rascunho do logbook (SessionLoggerModal).
// ---------------------------------------------------------------------------

/** Abaixo disso, `Iniciar` foi provavelmente um toque acidental (ex.: o
 * velejador testou o botão parado na praia) — não vale interromper a saída
 * com um formulário de registro. */
export const DISTANCIA_MINIMA_PARA_REGISTRO_KM = 0.1;

/** Mesma ideia acima, mas pelo ângulo da velocidade: cobre o caso raro de
 * velocidade máxima ter subido (leitura direta do aparelho) sem que a
 * distância acumulada tenha cruzado o limiar de deslocamento mínimo. */
const VELOCIDADE_MINIMA_PARA_REGISTRO_NOS = 1;

/**
 * Decide se uma sessão do Modo Navegação rendeu dado real o bastante para
 * valer a pena oferecer o registro no logbook ao sair. Só olha para os
 * números que o GPS mediu de fato — nunca duração sozinha, porque o app pode
 * ter ficado minutos aberto sem o velejador ter se movido nada.
 */
export function valePenaRegistrarSessao(resumo: {
  distanciaKm: number;
  velocidadeMaxNos: number;
}): boolean {
  return (
    resumo.distanciaKm >= DISTANCIA_MINIMA_PARA_REGISTRO_KM ||
    resumo.velocidadeMaxNos >= VELOCIDADE_MINIMA_PARA_REGISTRO_NOS
  );
}

/**
 * Rascunho do logbook (`components/SessionLoggerModal.tsx`) preenchido só
 * com o que o GPS de fato mediu. Vento, maré, prancha, tamanho da pipa e nota
 * da sessão NUNCA entram aqui — o GPS não tem como saber essas coisas, e
 * forjar um valor plausível seria pior que deixar em branco para o velejador
 * preencher (mesmo princípio de honestidade dos avisos em
 * components/ModoNavegacao.tsx: nunca fingir saber o que não se sabe).
 */
export interface PrefillLogbook {
  distanceKm: number;
  maxSpeedKnots: number;
  durationMinutes: number;
  /** formato YYYY-MM-DD, mesmo formato do `<input type="date">` do logger. */
  date: string;
  /** formato HH:MM, mesmo formato do `<input type="time">` do logger. */
  startTime: string;
  /**
   * Trilha já reduzida a no máximo 200 pontos (`amostrarTrilha`, mesma função
   * do downwind em grupo — não reimplementamos redução aqui). Não é campo
   * editável no formulário: é dado medido pelo GPS, não digitado pelo
   * velejador, então `SessionLoggerModal` só precisa guardar e reenviar, nunca
   * expor um input para isto — ver comentário lá.
   */
  trilhaReduzida: PontoTrilha[];
  spotId?: string;
  spotName?: string;
  customSpotName?: string;
  notes?: string;
}

/**
 * Converte o resumo bruto de uma sessão do Modo Navegação (distância,
 * velocidade máxima, instante de início, trilha) num `PrefillLogbook`.
 *
 * `agora` é recebido por parâmetro (em vez de `new Date()` direto) para a
 * função continuar pura e testável sem mockar relógio — mesmo padrão do
 * resto deste arquivo, que nunca toca `navigator`/`Date.now()` internamente.
 *
 * `trilha` é opcional (default `[]`) só para não quebrar quem já chamava esta
 * função antes da trilha existir — todo chamador real (`views/MapView.tsx`)
 * sempre tem uma `ResumoNavegacao.trilha` para passar.
 */
export function paraPrefillLogbook(
  resumo: {
    distanciaKm: number;
    velocidadeMaxNos: number;
    iniciadoEm: Date;
    trilha?: PontoTrilha[];
  },
  agora: Date
): PrefillLogbook {
  // Mínimo de 1 min: uma sessão de poucos segundos ainda é uma sessão real
  // (o velejador saiu e voltou rápido), e "0 min" tropeçaria na validação do
  // formulário (min="10", mas sem isso o campo nasceria com um valor inválido
  // em vez de só baixo).
  const duracaoMs = agora.getTime() - resumo.iniciadoEm.getTime();
  const durationMinutes = Math.max(1, Math.round(duracaoMs / 60_000));

  const pad2 = (n: number) => String(n).padStart(2, '0');
  const date = [
    resumo.iniciadoEm.getFullYear(),
    pad2(resumo.iniciadoEm.getMonth() + 1),
    pad2(resumo.iniciadoEm.getDate()),
  ].join('-');
  const startTime = `${pad2(resumo.iniciadoEm.getHours())}:${pad2(resumo.iniciadoEm.getMinutes())}`;

  return {
    // Uma casa decimal: é a precisão que o próprio formulário já usa nos
    // campos equivalentes (step="0.1"), então arredondar aqui evita mostrar
    // "28.4000000001" vindo direto do acúmulo de ponto flutuante da trilha.
    distanceKm: Math.round(resumo.distanciaKm * 10) / 10,
    maxSpeedKnots: Math.round(resumo.velocidadeMaxNos * 10) / 10,
    durationMinutes,
    date,
    startTime,
    trilhaReduzida: amostrarTrilha(resumo.trilha ?? [], 200),
  };
}

// ---------------------------------------------------------------------------
// Validação de servidor: o cliente já reduz a trilha antes de enviar (ver
// `paraPrefillLogbook` acima), mas `POST /api/sessions` não pode confiar
// nisso — nunca validar de novo no servidor é como um cliente adulterado (ou
// um bug futuro no app) conseguiria inflar o JSONB gravado ou gravar lixo.
// ---------------------------------------------------------------------------

/**
 * Teto de itens do array BRUTO aceito por `validarTrilhaReduzida`, antes de
 * qualquer validação ponto a ponto — um corte barato para nunca iterar um
 * array absurdamente grande vindo de um corpo de requisição adulterado. É
 * bem mais generoso que `limite` (a trilha reduzida de fato, 200 pontos):
 * existe só para rejeitar rápido um payload de má-fé, não para validar o
 * caso normal.
 */
const TETO_ITENS_TRILHA_BRUTA = 20_000;

/**
 * Valida a forma de `trilhaReduzida` recebida em `POST /api/sessions` antes
 * de gravar: precisa ser array de arrays de exatamente 3 números finitos,
 * com lat em [-90,90] e lng em [-180,180]. Qualquer item fora da forma
 * invalida a trilha INTEIRA (retorna `null`) em vez de filtrar item a item —
 * dado geométrico malformado é sinal de bug ou payload adulterado, não algo
 * para tentar aproveitar parcialmente.
 *
 * Nunca lança: quem chama decide o que fazer com `null` (a rota grava `null`
 * na coluna e segue — perder a linha no mapa é aceitável, perder o registro
 * do velejo por causa da trilha não é).
 *
 * Reamostra para `limite` pontos com `amostrarTrilha` quando vier maior — o
 * cliente já reduz para ~200 antes de enviar, mas o servidor reduz de novo
 * porque, como dito acima, não há como confiar que o cliente de fato o fez.
 */
export function validarTrilhaReduzida(raw: unknown, limite = 200): PontoTrilha[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > TETO_ITENS_TRILHA_BRUTA) return null;

  const pontos: PontoTrilha[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 3) return null;
    const [lat, lng, tsMs] = item;
    const latValida = typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90;
    const lngValida = typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180;
    const tsValido = typeof tsMs === 'number' && Number.isFinite(tsMs);
    if (!latValida || !lngValida || !tsValido) return null;
    pontos.push([lat, lng, tsMs]);
  }

  return amostrarTrilha(pontos, limite);
}
