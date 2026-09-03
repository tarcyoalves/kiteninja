/**
 * Visibilidade do downwind: quem descobre a travessia, e quem é avisado dela.
 *
 * O BUG QUE ISTO CORRIGE
 *
 * Havia DOIS caminhos de criação com regras diferentes, e só um deles
 * perguntava a visibilidade:
 *
 *  - `POST /api/downwind` (modal do Mapa) tinha o seletor e respeitava a
 *    escolha;
 *  - `POST /api/events` com `type: 'Downwind'` (o botão "Criar Downwind" da
 *    aba Eventos, que é o caminho que as pessoas usam) inseria em `downwinds`
 *    SEM a coluna — caía no `DEFAULT 'privado'` do schema.
 *
 * Resultado relatado pelo dono: criou o downwind pela aba Eventos, e ele não
 * apareceu para mais ninguém. Não havia bug de listagem — o filtro de
 * `GET /api/events` estava certo. O downwind era mesmo privado, e não existia
 * jeito nenhum na interface de criar um que não fosse.
 *
 * A regra mora aqui, em função pura, porque foi exatamente a duplicação da
 * regra entre duas rotas que produziu o defeito. Uma rota só pode perguntar.
 *
 * SOBRE O PADRÃO SER 'privado'
 *
 * É deliberado e mantido mesmo tendo sido a causa do relato. Visibilidade
 * define quem vê onde um grupo está velejando: um valor ausente por bug de
 * cliente, requisição truncada ou campo novo esquecido numa migração futura
 * NÃO pode virar transmissão pública de localização. O conserto certo é a
 * interface sempre perguntar (agora pergunta) — não é afrouxar o padrão.
 */

export type DownwindVisibilidade = 'privado' | 'comunidade';

export const VISIBILIDADES: readonly DownwindVisibilidade[] = ['privado', 'comunidade'];

/** Ver o bloco "SOBRE O PADRÃO SER 'privado'" acima antes de mudar isto. */
export const VISIBILIDADE_PADRAO: DownwindVisibilidade = 'privado';

/**
 * Converte o que veio do cliente numa visibilidade válida.
 *
 * Devolve `null` para valor inválido — quem chama decide entre recusar com 400
 * (rotas, que preferem falhar alto) ou cair no padrão. Não silencia:
 * `'publico'`, `'aberto'` e `''` são todos `null`, nunca `'comunidade'` por
 * aproximação.
 */
export function normalizarVisibilidade(valor: unknown): DownwindVisibilidade | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim().toLowerCase();
  return (VISIBILIDADES as readonly string[]).includes(limpo)
    ? (limpo as DownwindVisibilidade)
    : null;
}

/**
 * O downwind entra na agenda que qualquer velejador enxerga?
 *
 * `privado` continua existindo na lista de quem criou e de quem participa
 * (ver `podeListarDownwind` em lib/downwindAcesso.ts) — "não aparece na
 * agenda" nunca quis dizer "some para o dono".
 */
export function apareceNaAgendaPublica(visibilidade: DownwindVisibilidade): boolean {
  return visibilidade === 'comunidade';
}

export interface VeredictoNotificacao {
  permitido: boolean;
  /** Vazio quando permitido. */
  motivo: string;
}

const LIBERADO: VeredictoNotificacao = { permitido: true, motivo: '' };

/**
 * Quem pode disparar o aviso de "downwind novo" para os seguidores.
 *
 * QUATRO CONDIÇÕES, cada uma respondendo a um dano concreto:
 *
 *  - **Só o organizador.** Push em nome de um downwind que não é seu é
 *    convite falso — a pessoa aparece na praia por causa de uma notificação
 *    que ninguém autorizou.
 *  - **Só `comunidade`.** Notificar sobre um downwind privado é justamente o
 *    vazamento que a opção "fechado" existe para impedir. Quem escolheu
 *    fechado convida um a um, pelo link.
 *  - **Só `aberto`.** Avisar sobre travessia já encerrada, cancelada ou em
 *    andamento chama gente para uma coisa em que ela não consegue mais entrar.
 *  - **Uma vez só.** `notificadoEm` preenchido bloqueia — sem isso, o botão
 *    vira um megafone que dispara a cada toque, e push repetido é o caminho
 *    mais rápido para o usuário desligar TODAS as notificações do app,
 *    inclusive as de SOS. É por isso que a trava é dura em vez de um
 *    intervalo: aqui o custo do excesso não é incômodo, é perder o canal de
 *    emergência.
 */
export function podeNotificarSeguidores(args: {
  visibilidade: DownwindVisibilidade;
  ehOrganizador: boolean;
  statusDownwind: string;
  /** ISO do disparo anterior, ou `null` se nunca notificou. */
  notificadoEm: string | null;
}): VeredictoNotificacao {
  const { visibilidade, ehOrganizador, statusDownwind, notificadoEm } = args;

  if (!ehOrganizador) {
    return { permitido: false, motivo: 'Só o organizador pode avisar a comunidade.' };
  }
  if (!apareceNaAgendaPublica(visibilidade)) {
    return {
      permitido: false,
      motivo: 'Downwind fechado não é anunciado — convide pelo link.',
    };
  }
  if (statusDownwind !== 'aberto') {
    return {
      permitido: false,
      motivo: 'Este downwind não está mais aberto para novos participantes.',
    };
  }
  if (notificadoEm !== null) {
    return { permitido: false, motivo: 'A comunidade já foi avisada deste downwind.' };
  }

  return LIBERADO;
}

/**
 * Texto do push. Fica aqui, e não na rota, porque é a única parte do aviso
 * que o usuário realmente lê — e um teste consegue reprovar um texto que
 * esqueceu o trajeto ou o horário, coisa que revisão de código não pega.
 */
export function textoDoAviso(args: {
  nomeDownwind: string;
  organizador: string;
  trajeto: string | null;
  quando: string | null;
}): { titulo: string; corpo: string } {
  const partes = [args.trajeto, args.quando].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );
  return {
    titulo: `Downwind novo: ${args.nomeDownwind}`,
    corpo: partes.length > 0
      ? `${args.organizador} • ${partes.join(' • ')}`
      : `Organizado por ${args.organizador}`,
  };
}

/**
 * Mensagem única para "evento não existe" e "existe, mas não é para você".
 *
 * Mesmo princípio de `MSG_DOWNWIND_NAO_ENCONTRADO` (lib/downwindAcesso.ts):
 * qualquer diferença entre as duas respostas confirmaria a existência de um
 * downwind fechado para quem não participa — e o nome de um downwind já diz
 * onde um grupo vai estar e quando.
 */
export const MSG_EVENTO_NAO_ENCONTRADO = 'Evento não encontrado.';

/**
 * Quem pode ver UM evento — e, por consequência, quem confirmou presença nele.
 *
 * POR QUE ISTO VIROU FUNÇÃO
 *
 * A regra existia apenas como `WHERE` inline em `GET /api/events`. Enquanto só
 * a listagem precisava dela, tudo bem. Ao surgir uma segunda rota que recebe um
 * id de evento arbitrário (a lista de participantes), a regra passou a existir
 * em dois lugares — e regra de privacidade duplicada é regra que diverge.
 *
 * A rota de listagem continua com o `WHERE` (filtrar no banco é o certo lá), e
 * a rota de item pergunta a esta função. As duas têm que dizer o mesmo, e o
 * teste em scripts/verify-sql.ts confere isso contra o Postgres de verdade.
 *
 * REGRA: evento sem downwind é da agenda comum, todo mundo vê. Com downwind,
 * vale a visibilidade dele — `comunidade` é público; `privado` fica com quem
 * criou e com quem participa.
 */
export function podeVerEvento(args: {
  /** `null` quando o evento não tem downwind vinculado (evento comum). */
  visibilidadeDoDownwind: DownwindVisibilidade | null;
  souCriadorDoDownwind: boolean;
  souParticipanteDoDownwind: boolean;
}): boolean {
  const { visibilidadeDoDownwind, souCriadorDoDownwind, souParticipanteDoDownwind } = args;
  if (visibilidadeDoDownwind === null) return true;
  if (visibilidadeDoDownwind === 'comunidade') return true;
  return souCriadorDoDownwind || souParticipanteDoDownwind;
}
