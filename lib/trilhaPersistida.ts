import {
  ESTADO_INICIAL_TRILHA,
  TETO_PONTOS_BRUTOS,
  type EstadoTrilha,
} from './trilhaSessao';
import type { PontoTrilha } from './trilhaDownwind';

/**
 * Sobrevivência da trilha do Modo Navegação a um fechamento do app.
 *
 * POR QUE ISTO EXISTE
 *
 * `useTrilhaSessao` guardava a trilha inteira em estado do React, e só ali.
 * Isso significa que **fechar o app apagava o velejo**: distância, velocidade
 * máxima e a trilha desenhada, tudo.
 *
 * E fechar o app não é acidente raro nesse cenário — é o cenário. Duas horas
 * de GPS ativo drenam bateria; navegador de celular descarta aba em segundo
 * plano de forma agressiva; o celular vive molhado dentro do bolso. O
 * velejador voltava da água e o registro simplesmente não existia.
 *
 * É o mesmo defeito do downwind abandonado (`lib/downwindAbandono.ts`), do
 * outro lado: lá a travessia em grupo ficava sem resumo, aqui o velejo solo
 * ficava sem nada.
 */

export const CHAVE_TRILHA_EM_ANDAMENTO = 'kiteninja:trilha-em-andamento';

/**
 * Depois de quanto tempo uma trilha salva deixa de valer.
 *
 * Doze horas: cobre com folga qualquer velejo mais uma noite de sono (quem
 * velejou ao entardecer e só abre o app na manhã seguinte ainda recupera),
 * e evita o pior caso, que é oferecer a alguém a trilha de uma semana atrás
 * como se fosse o velejo de agora — e essa pessoa salvar dado errado no
 * histórico dela.
 */
export const VALIDADE_TRILHA_SALVA_MS = 12 * 60 * 60 * 1000;

/** A forma JSON: `Date` não sobrevive a `JSON.stringify`/`parse`. */
interface TrilhaSerializada {
  versao: 1;
  salvoEmMs: number;
  distanciaKm: number;
  velocidadeMaxNos: number;
  ultimaPosicaoEmMs: number | null;
  pontos: PontoTrilha[];
}

/**
 * O que NÃO é salvo, de propósito:
 *
 *  - `velocidadeNos` (instantânea) e `indisponivel`: descrevem o estado do
 *    GPS *agora*. Restaurar "12 nós" de uma sessão que acabou seria mentira
 *    na tela.
 *  - `ultimaReferencia`: é o ponto de comparação para a PRÓXIMA amostra. Ao
 *    retomar, o intervalo até o primeiro ponto novo pode ser de horas, e usar
 *    a referência velha produziria uma distância ou uma velocidade absurdas.
 *    Começar sem referência custa um ponto de trilha e evita isso.
 */
export function serializarTrilha(estado: EstadoTrilha, agoraMs: number): string {
  const dados: TrilhaSerializada = {
    versao: 1,
    salvoEmMs: agoraMs,
    distanciaKm: estado.distanciaKm,
    velocidadeMaxNos: estado.velocidadeMaxNos,
    ultimaPosicaoEmMs: estado.ultimaPosicaoEm ? estado.ultimaPosicaoEm.getTime() : null,
    pontos: estado.pontos,
  };
  return JSON.stringify(dados);
}

function ehPontoValido(p: unknown): p is PontoTrilha {
  return (
    Array.isArray(p) &&
    p.length === 3 &&
    p.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    Math.abs(p[0] as number) <= 90 &&
    Math.abs(p[1] as number) <= 180
  );
}

/**
 * Devolve `null` — e não um estado pela metade — para qualquer entrada em que
 * não se possa confiar: JSON quebrado, versão desconhecida, trilha vencida,
 * números que não são números.
 *
 * `null` faz o Modo Navegação começar do zero, que é o comportamento de
 * antes. Restaurar um estado parcialmente lido seria pior que não restaurar:
 * o velejador salvaria no histórico uma distância que nunca percorreu.
 */
export function desserializarTrilha(bruto: string | null, agoraMs: number): EstadoTrilha | null {
  if (!bruto) return null;

  let dados: unknown;
  try {
    dados = JSON.parse(bruto);
  } catch {
    return null;
  }

  if (!dados || typeof dados !== 'object') return null;
  const d = dados as Partial<TrilhaSerializada>;

  if (d.versao !== 1) return null;
  if (typeof d.salvoEmMs !== 'number' || !Number.isFinite(d.salvoEmMs)) return null;

  // Vencida, ou salva "no futuro" (relógio do aparelho mexido): descarta.
  const idadeMs = agoraMs - d.salvoEmMs;
  if (idadeMs < 0 || idadeMs > VALIDADE_TRILHA_SALVA_MS) return null;

  if (typeof d.distanciaKm !== 'number' || !Number.isFinite(d.distanciaKm) || d.distanciaKm < 0) {
    return null;
  }
  if (
    typeof d.velocidadeMaxNos !== 'number' ||
    !Number.isFinite(d.velocidadeMaxNos) ||
    d.velocidadeMaxNos < 0
  ) {
    return null;
  }

  if (!Array.isArray(d.pontos) || !d.pontos.every(ehPontoValido)) return null;

  return {
    ...ESTADO_INICIAL_TRILHA,
    distanciaKm: d.distanciaKm,
    velocidadeMaxNos: d.velocidadeMaxNos,
    ultimaPosicaoEm:
      typeof d.ultimaPosicaoEmMs === 'number' ? new Date(d.ultimaPosicaoEmMs) : null,
    // Respeita o mesmo teto de memória da sessão viva: um arquivo adulterado
    // não pode fazer o app carregar 500 mil pontos.
    pontos: d.pontos.slice(-TETO_PONTOS_BRUTOS),
  };
}

/**
 * Vale a pena oferecer a recuperação?
 *
 * Só com trilha de verdade. Uma sessão de dois pontos e 30 metros não merece
 * um aviso na tela — recuperá-la ou não dá no mesmo, e o aviso seria ruído
 * logo na abertura do Modo Navegação.
 */
export function valePenaRecuperar(estado: EstadoTrilha | null): boolean {
  if (!estado) return false;
  return estado.pontos.length >= 2 && estado.distanciaKm > 0;
}
