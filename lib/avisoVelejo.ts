/**
 * Regras do aviso "alguém que você segue entrou na água".
 *
 * Só decisão pura aqui — nada de SQL nem push. É o mesmo padrão de
 * `lib/social.ts` e `deveReadquirir` em `lib/useWakeLock.ts`: o que pode
 * quebrar mora numa função testável sem banco, sem rede e sem mock.
 * `lib/notificacoes.ts` é a casca que consulta e dispara.
 */

export type TipoInicio = 'velejo_iniciado' | 'downwind_iniciado';

/**
 * Janela em que um MESMO velejador não gera um segundo aviso do MESMO tipo.
 *
 * Três horas cobre a duração típica de uma sessão. O caso que isto evita não é
 * hipotético: o botão "Iniciar" é o mais fácil de tocar duas vezes (voltou
 * para a praia, abriu o app de novo, tocou sem pensar), e cada toque acordaria
 * o celular de TODO mundo que segue essa pessoa. Um aviso repetido custa
 * pouco para quem manda e caro para dezenas de pessoas que recebem — a
 * assimetria é o motivo de o padrão ser "não repetir".
 */
export const JANELA_ANTI_REPETICAO_MS = 3 * 60 * 60 * 1000;

/**
 * Teto de destinatários por aviso.
 *
 * Não é medo de escala: é que o disparo acontece dentro do request de quem
 * tocou "Iniciar", e uma pessoa muito seguida faria esse request virar um laço
 * de centenas de envios de push. Passando disto, o aviso vira caso a tratar
 * com fila, não com um `for` mais longo.
 */
export const MAX_DESTINATARIOS = 500;

export function podeAvisarDeNovo(
  ultimoAvisoEm: Date | null,
  agora: Date = new Date()
): boolean {
  if (!ultimoAvisoEm) return true;
  return agora.getTime() - ultimoAvisoEm.getTime() >= JANELA_ANTI_REPETICAO_MS;
}

export interface TextoAviso {
  title: string;
  body: string;
}

/**
 * Monta título e corpo do push.
 *
 * O nome vai no TÍTULO, não no corpo: numa notificação empilhada o Android
 * corta o corpo antes do título, e "quem" é a única informação que decide se
 * a pessoa abre o app. O spot entra só quando existe — texto com "em
 * undefined" é pior que texto curto.
 */
export function montarAvisoInicio(
  nomeVelejador: string,
  tipo: TipoInicio,
  spotNome?: string | null
): TextoAviso {
  const nome = nomeVelejador.trim() || 'Um velejador';
  const onde = spotNome?.trim() ? ` em ${spotNome.trim()}` : '';

  if (tipo === 'downwind_iniciado') {
    return {
      title: `${nome} começou um downwind`,
      body: `A travessia${onde} começou agora. Acompanhe ao vivo no mapa.`,
    };
  }

  return {
    title: `${nome} entrou na água`,
    body: `Velejo começando${onde} agora.`,
  };
}
