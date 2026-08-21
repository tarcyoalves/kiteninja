/**
 * Regras puras do Downwind: navegação em grupo de um ponto A a um ponto B ao
 * longo da costa. Velejadores vão na água; apoio em terra acompanha de carro.
 *
 * Isto é infraestrutura de segurança, não só de produto: a razão de existir
 * desta feature é impedir que alguém fique para trás na água sem que ninguém
 * saiba. Por isso `podeEncerrarDownwind` é tratada como a regra mais
 * importante do arquivo — qualquer alteração nela precisa reprovar em teste
 * antes de reprovar na prática.
 *
 * Tudo aqui é função pura: sem banco, sem `server-only`, 100% testável.
 */

import { haversineKm, LatLng } from './geo';

export type DownwindStatus = 'aberto' | 'em_andamento' | 'encerrado' | 'cancelado';
/**
 * `papel` descreve só ONDE a pessoa está durante o downwind: na água ou em
 * terra. "Ser organizador" é uma dimensão ortogonal (função administrativa —
 * quem monta a rota, quem é o ponto de contato), representada pelo campo
 * `ehOrganizador` abaixo, não por um terceiro valor de `papel`.
 *
 * Isto substitui um modelo anterior em que 'organizador' era um valor de
 * `papel` concorrente com 'velejador': naquele modelo, um organizador que
 * também velejava tinha que escolher um papel só, e se cadastrado como
 * 'organizador' ficava invisível para `podeEncerrarDownwind` — o grupo podia
 * encerrar o downwind com o organizador ainda na água. Como o organizador é
 * justamente quem tem mais chance de estar na água (ele que puxa o grupo),
 * isso era uma falha grave, não um detalhe. Separar as duas dimensões
 * resolve isso na raiz: estar na água sempre conta, seja você organizador ou
 * não.
 */
export type ParticipantePapel = 'velejador' | 'apoio_terra';
export type ParticipanteEstado = 'confirmado' | 'navegando' | 'encerrado' | 'desistiu';

export interface DownwindParticipante {
  userId: string;
  /** Onde a pessoa está durante o downwind: na água ('velejador') ou em terra ('apoio_terra'). */
  papel: ParticipantePapel;
  /** Função administrativa, independente de `papel`. Não afeta o quórum de encerramento. */
  ehOrganizador: boolean;
  estado: ParticipanteEstado;
}

// ---------------------------------------------------------------------------
// 1. Regra central de segurança: quando o downwind pode encerrar.
// ---------------------------------------------------------------------------

/**
 * Estados de participante que NÃO bloqueiam o encerramento: a pessoa já saiu
 * da água de forma decidida, seja completando o percurso ou desistindo.
 * 'confirmado' bloqueia de propósito — confirmar presença não é o mesmo que
 * ter saído da água, e é justamente o velejador que nunca chegou a marcar
 * 'navegando' (esqueceu o app, sinal ruim ao entrar) que mais precisa ser
 * contabilizado: ele pode estar na água mesmo sem o status refletir isso.
 * Tratar 'confirmado' como "não conta" seria abrir uma brecha exatamente no
 * caso que a feature existe para cobrir.
 */
const ESTADOS_QUE_NAO_BLOQUEIAM: ReadonlySet<ParticipanteEstado> = new Set([
  'encerrado',
  'desistiu',
]);

/**
 * Só o papel 'velejador' entra no quórum de encerramento — apoio em terra
 * não está na água e não tem por que travar o fim do downwind.
 *
 * `ehOrganizador` NÃO entra nesse filtro de propósito: organizar é uma
 * função administrativa ortogonal a estar na água. Um organizador com
 * `papel: 'velejador'` conta no quórum como qualquer outro velejador — e é
 * exatamente isso que queremos, porque o organizador costuma ser quem mais
 * puxa o grupo na água. Ver comentário em `ParticipantePapel` para o
 * histórico dessa decisão.
 */
function velejadores(participantes: DownwindParticipante[]): DownwindParticipante[] {
  return participantes.filter((p) => p.papel === 'velejador');
}

/**
 * O downwind só pode encerrar quando TODOS os velejadores estiverem em
 * 'encerrado' ou 'desistiu'.
 *
 * ATENÇÃO — CONTRATO DE CHAMADA, NÃO SÓ DETALHE MATEMÁTICO: lista vazia de
 * velejadores faz `.every()` retornar `true`, ou seja, libera o
 * encerramento. Isso é INTENCIONAL para o caso legítimo de um downwind sem
 * ninguém com papel 'velejador' (ex.: passeio cadastrado só com apoio de
 * terra) — mas é FAIL-OPEN para o caso ilegítimo de a lista vir vazia por
 * ACIDENTE: uma query que falhou, um JOIN que não trouxe linhas, um bug na
 * rota que esqueceu de carregar os participantes antes de chamar esta
 * função. Nesses casos o downwind encerraria e o rastreamento morreria com
 * gente possivelmente ainda na água, sem esta função ter como distinguir
 * "de fato não há velejador" de "não consegui carregar os velejadores".
 *
 * Por isso: a camada de rota que chama `podeEncerrarDownwind` tem a
 * OBRIGAÇÃO de garantir que a lista de participantes foi de fato carregada
 * do banco (e não é um array vazio por falha silenciosa) antes de confiar no
 * `true` desta função. Esta função não pode fazer essa checagem sozinha —
 * ela não tem como saber se "vazio" é resultado real ou resultado de erro.
 */
export function podeEncerrarDownwind(participantes: DownwindParticipante[]): boolean {
  return velejadores(participantes).every((v) => ESTADOS_QUE_NAO_BLOQUEIAM.has(v.estado));
}

/**
 * Velejadores que ainda bloqueiam o encerramento — é o que a UI mostra
 * ("faltam 3 velejadores"). Deliberadamente implementada com o mesmo filtro
 * de `podeEncerrarDownwind` (mesma lista de "velejadores", mesmo critério de
 * "bloqueia"), para as duas nunca poderem divergir por acidente de
 * manutenção futura.
 */
export function velejadoresPendentes(
  participantes: DownwindParticipante[]
): DownwindParticipante[] {
  return velejadores(participantes).filter((v) => !ESTADOS_QUE_NAO_BLOQUEIAM.has(v.estado));
}

// ---------------------------------------------------------------------------
// 2. Indicador visual de perda de sinal.
// ---------------------------------------------------------------------------

export type EstadoSinal = 'ok' | 'atrasado' | 'sem_sinal';

/**
 * Limiares escolhidos a partir do intervalo de report de posição (30-60s,
 * ver `lib/usePositionBeacon.ts`):
 *
 * - 'ok' até 3 minutos sem reportar: cobre de 3 a 6 ciclos perdidos, o que é
 *   rotina na praia (4G ruim, celular no bolso, app em background um
 *   instante). Não vale a pena chamar atenção do organizador por isso.
 * - 'atrasado' de 3 a 8 minutos: ainda pode ser sinal ruim prolongado, mas já
 *   passou do que se explica por alguns ciclos perdidos — é o ponto de virar
 *   um amarelo na tela, sem soar alarme.
 * - 'sem_sinal' acima de 8 minutos: nesse ponto o mais provável é o app ter
 *   sido fechado, o celular ter desligado ou o velejador estar fora de área
 *   de cobertura por um tempo real. Fica vermelho.
 *
 * Estes números foram escolhidos com folga generosa de propósito: o custo de
 * um falso positivo (assustar o organizador à toa) é maior que o de alguns
 * minutos de atraso na percepção visual, porque isto NÃO dispara nada
 * sozinho — ver aviso abaixo.
 */
const SINAL_OK_LIMITE_MIN = 3;
const SINAL_ATRASADO_LIMITE_MIN = 8;

/**
 * IMPORTANTE — isto é SÓ VISUAL. É um indicador derivado na leitura (a cada
 * render/poll da tela), não um alerta: não dispara push, não cria job, não
 * escala para ninguém. Se um dia a feature precisar de um alerta de verdade
 * ("velejador sumiu, notifique o organizador"), isso é uma decisão de
 * produto nova, com sua própria lógica de disparo único e deduplicação —
 * NÃO deve nascer "de graça" a partir desta função. Ver `lib/sos.ts` /
 * `deveEscalar` para o padrão correto de um alerta que de fato escala.
 */
export function estadoSinal(
  ultimaPosicaoEm: Date | null,
  agora: Date
): { estado: EstadoSinal; minutosSemReportar: number | null } {
  if (ultimaPosicaoEm === null) {
    // Nunca reportou: não há como saber há quanto tempo, então tratamos o
    // estado como pior caso (sem sinal) sem fingir um número de minutos.
    //
    // `minutosSemReportar` é `null` aqui, e não `Infinity`, porque este valor
    // atravessa uma rota de API até a UI via JSON, e `JSON.stringify` reduz
    // `Infinity` para `null` silenciosamente de qualquer forma —
    // `JSON.stringify({ x: Infinity })` já vira `'{"x":null}'` no
    // `JSON.stringify` nativo. Usar `Infinity` aqui não mudaria o que a UI
    // recebe, só escondia essa conversão dentro do transporte em vez de
    // deixá-la explícita no tipo. Com `number | null` declarado, o
    // consumidor (TypeScript) é forçado a tratar o caso "nunca reportou"
    // como um `if (minutosSemReportar === null)`, em vez de fazer
    // aritmética/comparação silenciosa com um `null` inesperado.
    return { estado: 'sem_sinal', minutosSemReportar: null };
  }

  const diffMs = agora.getTime() - ultimaPosicaoEm.getTime();
  // Relógio adiantado no celular (mesmo padrão de lib/chat.ts): não produz
  // minutos negativos, satura em zero.
  const minutosSemReportar = Math.max(0, diffMs / 60_000);

  let estado: EstadoSinal;
  if (minutosSemReportar <= SINAL_OK_LIMITE_MIN) {
    estado = 'ok';
  } else if (minutosSemReportar <= SINAL_ATRASADO_LIMITE_MIN) {
    estado = 'atrasado';
  } else {
    estado = 'sem_sinal';
  }

  return { estado, minutosSemReportar };
}

// ---------------------------------------------------------------------------
// 3. Transições de estado válidas.
// ---------------------------------------------------------------------------

/**
 * Fluxo feliz: aberto -> em_andamento -> encerrado.
 * 'cancelado' só a partir de 'aberto' ou 'em_andamento' — cancelar um
 * downwind que já 'encerrado' não faz sentido (já acabou, não há o que
 * cancelar) e voltar de 'encerrado' para qualquer outro estado é proibido de
 * propósito: uma vez que `podeEncerrarDownwind` autorizou o encerramento
 * (todo mundo fora da água), reabrir o evento reintroduziria uma janela onde
 * alguém poderia ser mandado de volta à água sob um downwind "zumbi". Se
 * precisar de um novo passeio, cria-se outro downwind.
 * 'cancelado' também é terminal pelo mesmo motivo.
 */
const TRANSICOES_DOWNWIND: Record<DownwindStatus, ReadonlySet<DownwindStatus>> = {
  aberto: new Set(['em_andamento', 'cancelado']),
  em_andamento: new Set(['encerrado', 'cancelado']),
  encerrado: new Set([]),
  cancelado: new Set([]),
};

export function podeTransicionarDownwind(de: DownwindStatus, para: DownwindStatus): boolean {
  return TRANSICOES_DOWNWIND[de]?.has(para) ?? false;
}

/**
 * confirmado -> navegando -> encerrado é o fluxo feliz de um velejador.
 * confirmado -> desistiu e navegando -> desistiu cobrem quem sai antes ou
 * durante.
 *
 * 'desistiu' -> 'navegando' é PROIBIDA de propósito: se fosse permitida, um
 * velejador que já foi contado como "fora d'água" para efeito de encerramento
 * poderia reaparecer navegando sem que ninguém tivesse decidido isso de novo
 * — inclusive depois de um `podeEncerrarDownwind` já ter liberado o
 * encerramento com base no estado antigo. Para voltar à água, o caminho é
 * 'desistiu' -> 'confirmado': isso força uma nova confirmação explícita
 * (mesmo que automática) antes de a pessoa poder ir para 'navegando' de novo,
 * o que dá ao organizador/sistema um ponto de checagem no meio.
 *
 * 'encerrado' é terminal pelo mesmo motivo de segurança do downwind como um
 * todo: quem já terminou o percurso não "volta a navegar" dentro do mesmo
 * downwind.
 */
const TRANSICOES_PARTICIPANTE: Record<ParticipanteEstado, ReadonlySet<ParticipanteEstado>> = {
  confirmado: new Set(['navegando', 'desistiu']),
  navegando: new Set(['encerrado', 'desistiu']),
  encerrado: new Set([]),
  desistiu: new Set(['confirmado']),
};

export function podeTransicionarParticipante(
  de: ParticipanteEstado,
  para: ParticipanteEstado
): boolean {
  return TRANSICOES_PARTICIPANTE[de]?.has(para) ?? false;
}

/**
 * Estado-alvo correto para o botão de saída do participante ("Encerrar
 * velejo" na UI), a partir do estado atual.
 *
 * BUG QUE ISTO CORRIGE (achado em produção): a UI mandava sempre
 * `estado: 'encerrado'`, mas essa transição só é válida a partir de
 * 'navegando' (ver TRANSICOES_PARTICIPANTE acima). Quem ainda está
 * 'confirmado' — TODO `apoio_terra`, que nunca tem botão "Iniciar" e por
 * isso NUNCA chega a 'navegando', e também um `velejador` que entrou no
 * downwind mas ainda não tocou Iniciar — recebia 409 "transição inválida" e
 * ficava PRESO no takeover de tela cheia para sempre: a única outra saída
 * era o organizador cancelar o downwind INTEIRO, o que não é uma opção
 * pessoal de quem só queria sair.
 *
 * A resposta certa depende de ONDE a pessoa está: 'navegando' significa que
 * ela está de fato na água/na rota, então 'encerrado' ("terminei a
 * travessia") é a semântica certa; qualquer outro estado ('confirmado', ou
 * já um estado terminal) significa que ela nunca chegou a navegar, então
 * 'desistiu' ("não vou mais") é a única transição válida.
 *
 * 'encerrado' e 'desistiu' já são ambos terminais em TRANSICOES_PARTICIPANTE
 * (sem transição de saída), então chamar esta função de novo sobre o
 * resultado anterior é inofensivo — devolve 'desistiu', e a rota trata
 * `estadoAtual === novoEstado` como idempotente (ver
 * lib/downwindAcesso.ts, `podeMudarEstadoDeParticipante`).
 */
export function estadoDeSaidaVelejo(estadoAtual: ParticipanteEstado): 'encerrado' | 'desistiu' {
  return estadoAtual === 'navegando' ? 'encerrado' : 'desistiu';
}

// ---------------------------------------------------------------------------
// 4. Progresso do percurso.
// ---------------------------------------------------------------------------

export interface ProgressoDownwind {
  distanciaTotalKm: number;
  /** Distância em linha reta desde a saída até a posição atual. */
  distanciaPercorridaKm: number;
  /** Distância em linha reta da posição atual até a chegada. */
  distanciaRestanteKm: number;
  /** 0-100, sempre saturado neste intervalo. */
  percentual: number;
}

/**
 * Progresso ao longo do trecho saida -> chegada, usando Haversine
 * (reaproveitado de lib/geo.ts, mesma base do SOS) como aproximação em linha
 * reta — razoável para downwind, que é por definição um deslocamento
 * costeiro predominantemente numa direção, empurrado pelo vento.
 *
 * `distanciaPercorridaKm` e `distanciaRestanteKm` são calculadas
 * independentemente (saida->atual e atual->chegada), não uma como
 * "total menos a outra": se o velejador se afastar da linha reta, subtrair
 * daria números que não batem com a realidade em nenhuma das duas pontas.
 *
 * saida == chegada (distanciaTotalKm = 0): não dá para dividir por zero para
 * achar percentual. Decidimos que o percurso já está "completo" (100%) nesse
 * caso degenerado — não há distância a percorrer, então não há sentido em
 * dizer que faltam 0% ou travar em erro.
 *
 * Posição além da chegada (percentual > 100 pela distância percorrida):
 * saturamos em 100. A UI mostra uma barra de progresso; passar de 100% nela
 * é confuso e não comunica nada de útil (não significa "ultrapassou o
 * destino" de forma clara — pode só ser ruído de GPS perto da chegada).
 */
export function progressoDownwind(
  saida: LatLng,
  chegada: LatLng,
  atual: LatLng
): ProgressoDownwind {
  const distanciaTotalKm = haversineKm(saida, chegada);
  const distanciaPercorridaKm = haversineKm(saida, atual);
  const distanciaRestanteKm = haversineKm(atual, chegada);

  const percentual =
    distanciaTotalKm === 0
      ? 100
      : Math.min(100, (distanciaPercorridaKm / distanciaTotalKm) * 100);

  return { distanciaTotalKm, distanciaPercorridaKm, distanciaRestanteKm, percentual };
}

// ---------------------------------------------------------------------------
// 5. Split mapa/chat da tela do apoio em terra (motorista).
// ---------------------------------------------------------------------------

/**
 * Altura do mapa como % da área do split — o chat ocupa o restante. Percentual
 * contínuo (arrastável por uma alça entre os dois painéis), não mais três
 * estados fixos: a primeira versão (proximoSplitApoioTerra, três paradas) foi
 * substituída porque o pedido explícito passou a ser "puxar para aumentar ou
 * diminuir", que um enum de 3 valores não expressa.
 *
 * Os botões de atalho ("expandir mapa" / "expandir chat" / "equilibrar") na UI
 * continuam existindo — eles só chamam esta mesma função com um alvo fixo
 * (70/50/30), em vez de um enum próprio.
 */
export const SPLIT_APOIO_MAPA_MIN_PCT = 20;
export const SPLIT_APOIO_MAPA_MAX_PCT = 80;

/**
 * Limita o percentual de altura do mapa a uma faixa que nunca deixa nenhum
 * dos dois painéis desaparecer por completo — nem no fim de um arrasto solto
 * fora da tela, nem num clique de atalho mal calculado.
 */
export function clampAlturaMapaSplitApoio(percentDesejado: number): number {
  if (!Number.isFinite(percentDesejado)) return 50;
  return Math.min(SPLIT_APOIO_MAPA_MAX_PCT, Math.max(SPLIT_APOIO_MAPA_MIN_PCT, percentDesejado));
}
