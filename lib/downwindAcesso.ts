/**
 * Autorização do mapa ao vivo do downwind.
 *
 * ISTO É RASTREAMENTO DE PESSOAS EM TEMPO REAL. Não pode vazar para o app
 * inteiro, não aparece no mapa geral, e não é consultável por quem não está na
 * travessia. Por isso toda decisão de acesso mora aqui, em funções puras, e as
 * rotas só carregam dados do banco e perguntam — o Vitest deste projeto roda
 * em `environment: 'node'`, sem banco e sem servidor HTTP, então regra que
 * mora dentro da rota é regra que ninguém testa.
 *
 * Mesmo padrão já usado por lib/authz.ts, lib/sos.ts e lib/downwind.ts.
 */

import { canModerate, type Role } from './authz';
import {
  podeEncerrarDownwind,
  podeTransicionarDownwind,
  podeTransicionarParticipante,
  velejadoresPendentes,
  type DownwindParticipante,
  type DownwindStatus,
  type ParticipanteEstado,
  type ParticipantePapel,
} from './downwind';

/**
 * Mensagem ÚNICA para "não existe" e para "existe, mas não é seu".
 *
 * As duas respostas têm que ser indistinguíveis: qualquer diferença — status,
 * texto, tempo de resposta — confirmaria a existência daquele downwind para
 * quem não participa, e isso já é informação sobre onde um grupo está
 * navegando agora.
 */
export const MSG_DOWNWIND_NAO_ENCONTRADO = 'Downwind não encontrado.';

export interface MinhaParticipacao {
  papel: ParticipantePapel;
  estado: ParticipanteEstado;
  ehOrganizador: boolean;
  apoioUserId: string | null;
}

export interface Veredito {
  permitido: boolean;
  /** Status HTTP que a rota deve devolver quando `permitido` for false. */
  status: 400 | 403 | 404 | 409;
  mensagem: string;
}

const OK: Veredito = { permitido: true, status: 400, mensagem: '' };

function negar(status: Veredito['status'], mensagem: string): Veredito {
  return { permitido: false, status, mensagem };
}

// ---------------------------------------------------------------------------
// 1. Quem enxerga o mapa.
// ---------------------------------------------------------------------------

export interface AcessoAoMapa extends Veredito {
  /**
   * Downwind existe e o solicitante participa, mas o downwind já acabou (ou
   * ainda não saiu do papel): a rota responde 200 com o cabeçalho e listas
   * VAZIAS, para o cliente saber que terminou e desmontar a tela — não é erro,
   * é o caminho normal de "o organizador encerrou enquanto eu estava no mapa".
   */
  servePosicoes: boolean;
}

/**
 * Decide se o solicitante pode ver as posições de um downwind.
 *
 * REGRA CENTRAL: quem não participa recebe **404, nunca 403** (ver
 * `MSG_DOWNWIND_NAO_ENCONTRADO`).
 *
 * MODERAÇÃO NÃO ENTRA AQUI, de propósito. `canModerate` autoriza encerrar um
 * downwind travado (que não expõe coordenada de ninguém), mas não autoriza ver
 * onde o grupo está. O SOS tem exceção de moderação porque é socorro; um
 * downwind em andamento não é emergência, e se virar, o caminho é o SOS, que
 * tem as próprias regras. Há teste negativo explícito disso — se alguém um dia
 * "consertar" isto achando que é esquecimento, o teste reprova.
 */
export function podeVerPosicoes(args: {
  statusDownwind: DownwindStatus | null;
  participacao: MinhaParticipacao | null;
}): AcessoAoMapa {
  const { statusDownwind, participacao } = args;
  const negado: AcessoAoMapa = {
    ...negar(404, MSG_DOWNWIND_NAO_ENCONTRADO),
    servePosicoes: false,
  };

  // Downwind inexistente e downwind de terceiro colapsam na mesma resposta.
  if (statusDownwind === null) return negado;
  if (participacao === null) return negado;

  // Quem desistiu perde o mapa junto com a participação: saiu da água, não
  // acompanha mais a travessia de dentro.
  if (participacao.estado === 'desistiu') return negado;

  return {
    permitido: true,
    status: 400,
    mensagem: '',
    servePosicoes: statusDownwind === 'aberto' || statusDownwind === 'em_andamento',
  };
}

/**
 * A posição DESTE participante pode ser mostrada aos outros?
 *
 * Quem está 'encerrado' ou 'desistiu' já saiu da água — continuar
 * transmitindo a posição dele seria vigiar a pessoa no caminho de casa. Ele
 * continua aparecendo na LISTA (o grupo precisa saber que ele chegou), só sem
 * coordenada.
 */
export function posicaoVisivel(estado: ParticipanteEstado): boolean {
  return estado !== 'encerrado' && estado !== 'desistiu';
}

// ---------------------------------------------------------------------------
// 2. Reportar posição.
// ---------------------------------------------------------------------------

/**
 * Só grava posição quem está numa travessia realmente em andamento. Sem esta
 * guarda, `downwind_posicoes` — a tabela que mais cresce do sistema — encheria
 * de linhas que nenhuma tela pode mostrar.
 */
export function podeReportarPosicao(args: {
  statusDownwind: DownwindStatus | null;
  participacao: MinhaParticipacao | null;
}): Veredito {
  const { statusDownwind, participacao } = args;
  if (statusDownwind === null || participacao === null) {
    return negar(404, MSG_DOWNWIND_NAO_ENCONTRADO);
  }
  if (!posicaoVisivel(participacao.estado)) {
    return negar(409, 'Sua participação neste downwind já foi encerrada.');
  }
  if (statusDownwind !== 'em_andamento') {
    return negar(409, 'O downwind não está em andamento.');
  }
  return OK;
}

// ---------------------------------------------------------------------------
// 3. Iniciar a travessia.
// ---------------------------------------------------------------------------

export interface VereditoInicio extends Veredito {
  /**
   * O downwind já estava em andamento: a rota responde 200 sem tocar em nada.
   * Idempotência importa aqui porque QUALQUER velejador dispara o início ao
   * tocar Iniciar, e vinte pessoas entrando na água ao mesmo tempo é o caso
   * normal, não a exceção.
   */
  noOp: boolean;
}

/**
 * Qualquer participante com papel 'velejador' pode começar o downwind — não é
 * privilégio do organizador.
 *
 * Justificativa: começar o rastreamento cedo demais custa algumas centenas de
 * linhas numa tabela; começar tarde demais custa não saber onde alguém está. A
 * assimetria decide sozinha para que lado o desenho deve errar.
 *
 * 'apoio_terra' não inicia: o motorista não está na água, e deixar o carro
 * disparar a travessia abriria a porta para o downwind "começar" no
 * estacionamento, com todo mundo ainda montando equipamento.
 */
export function podeIniciarDownwind(args: {
  statusDownwind: DownwindStatus | null;
  participacao: MinhaParticipacao | null;
}): VereditoInicio {
  const { statusDownwind, participacao } = args;
  if (statusDownwind === null || participacao === null) {
    return { ...negar(404, MSG_DOWNWIND_NAO_ENCONTRADO), noOp: false };
  }
  if (participacao.papel !== 'velejador') {
    return {
      ...negar(403, 'Só quem vai velejar pode iniciar a travessia.'),
      noOp: false,
    };
  }
  if (statusDownwind === 'em_andamento') {
    return { ...OK, permitido: true, noOp: true };
  }
  if (!podeTransicionarDownwind(statusDownwind, 'em_andamento')) {
    return {
      ...negar(409, 'Este downwind não pode mais ser iniciado.'),
      noOp: false,
    };
  }
  return { ...OK, permitido: true, noOp: false };
}

// ---------------------------------------------------------------------------
// 4. Encerrar o downwind inteiro.
// ---------------------------------------------------------------------------

/**
 * Encerrar o downwind do grupo: só o organizador, ou moderação.
 *
 * GUARDA CONTRA O FAIL-OPEN DE `podeEncerrarDownwind` — esta é a regra mais
 * importante do arquivo. Aquela função devolve `true` para lista vazia, de
 * propósito, e o próprio lib/downwind.ts transfere para quem chama a obrigação
 * de garantir que a lista foi de fato carregada. Um downwind SEMPRE tem pelo
 * menos o organizador (app/api/events/route.ts o insere na criação), então
 * lista vazia aqui só pode ser falha de query — nunca "de fato não há
 * ninguém". Recusar é a única resposta segura: liberar encerraria o
 * rastreamento com gente possivelmente ainda na água.
 */
export function podeEncerrarDownwindComoUsuario(args: {
  solicitante: { role: Role };
  participacao: MinhaParticipacao | null;
  participantes: DownwindParticipante[];
  statusDownwind: DownwindStatus | null;
}): Veredito {
  const { solicitante, participacao, participantes, statusDownwind } = args;

  if (statusDownwind === null) return negar(404, MSG_DOWNWIND_NAO_ENCONTRADO);

  const ehOrganizador = participacao?.ehOrganizador === true;
  if (!ehOrganizador && !canModerate(solicitante.role)) {
    // Moderação não vê posição (ver `podeVerPosicoes`), mas encerra downwind
    // travado — é dívida operacional, e encerrar não expõe coordenada.
    if (participacao === null) return negar(404, MSG_DOWNWIND_NAO_ENCONTRADO);
    return negar(403, 'Só o organizador pode encerrar o downwind.');
  }

  if (!podeTransicionarDownwind(statusDownwind, 'encerrado')) {
    return negar(409, 'Este downwind já foi encerrado ou cancelado.');
  }

  if (participantes.length === 0) {
    return negar(
      409,
      'Não foi possível confirmar quem ainda está na água. Tente de novo.'
    );
  }

  if (!podeEncerrarDownwind(participantes)) {
    const pendentes = velejadoresPendentes(participantes);
    return negar(
      409,
      `Ainda há ${pendentes.length} velejador(es) na água. O downwind só encerra quando todos saírem.`
    );
  }

  return OK;
}

/**
 * Cancelar não exige quórum: é justamente a válvula para "o grupo desistiu
 * antes de sair da praia", em que exigir que todos marquem estado seria pedir
 * cerimônia para um evento que nunca aconteceu.
 */
export function podeCancelarDownwind(args: {
  solicitante: { role: Role };
  participacao: MinhaParticipacao | null;
  statusDownwind: DownwindStatus | null;
}): Veredito {
  const { solicitante, participacao, statusDownwind } = args;
  if (statusDownwind === null) return negar(404, MSG_DOWNWIND_NAO_ENCONTRADO);

  const ehOrganizador = participacao?.ehOrganizador === true;
  if (!ehOrganizador && !canModerate(solicitante.role)) {
    if (participacao === null) return negar(404, MSG_DOWNWIND_NAO_ENCONTRADO);
    return negar(403, 'Só o organizador pode cancelar o downwind.');
  }
  if (!podeTransicionarDownwind(statusDownwind, 'cancelado')) {
    return negar(409, 'Este downwind já foi encerrado ou cancelado.');
  }
  return OK;
}

/**
 * Quem pode ver o RESUMO (histórico: distância, velocidade máxima, trilha
 * reduzida) de um downwind — diferente de `podeVerPosicoes`, que é sobre
 * posição AO VIVO.
 *
 * Deliberadamente mais permissivo que o mapa ao vivo: um resumo já
 * encerrado não é rastreamento em tempo real, é histórico do grupo — e
 * qualquer participante, mesmo quem 'desistiu' antes de ir (que perde o
 * mapa ao vivo, ver `podeVerPosicoes`), pode querer ver como o downwind
 * correu para o resto do grupo. Moderação também vê, sem precisar
 * participar — é dado agregado do evento, não posição individual ao vivo.
 *
 * Mesma regra de privacidade no "não confirma existência": não-participante
 * recebe 404, nunca 403.
 */
export function podeVerResumoDownwind(args: {
  solicitante: { role: Role };
  statusDownwind: DownwindStatus | null;
  participacao: MinhaParticipacao | null;
}): Veredito {
  const { solicitante, statusDownwind, participacao } = args;
  if (statusDownwind === null) return negar(404, MSG_DOWNWIND_NAO_ENCONTRADO);
  if (canModerate(solicitante.role)) return OK;
  if (participacao === null) return negar(404, MSG_DOWNWIND_NAO_ENCONTRADO);
  return OK;
}

// ---------------------------------------------------------------------------
// 5. Estado de um participante.
// ---------------------------------------------------------------------------

/**
 * Quem pode mudar o estado de quem.
 *
 * O próprio participante manda no próprio estado, sempre. O organizador só
 * pode marcar um TERCEIRO como 'encerrado' — o caso real é "fulano chegou na
 * praia e foi embora sem mexer no celular", e sem isso o downwind fica
 * eternamente travado esperando alguém que já está em casa. Ele não pode
 * marcar terceiro como 'navegando' (colocaria alguém na água por decreto) nem
 * como 'desistiu' (é uma declaração da pessoa, não um despacho).
 */
export function podeMudarEstadoDeParticipante(args: {
  solicitanteId: string;
  solicitanteEhOrganizador: boolean;
  alvoUserId: string;
  estadoAtual: ParticipanteEstado;
  novoEstado: ParticipanteEstado;
}): Veredito {
  const {
    solicitanteId,
    solicitanteEhOrganizador,
    alvoUserId,
    estadoAtual,
    novoEstado,
  } = args;

  const souEu = solicitanteId === alvoUserId;

  if (!souEu) {
    if (!solicitanteEhOrganizador) {
      return negar(403, 'Você só pode mudar a sua própria participação.');
    }
    if (novoEstado !== 'encerrado') {
      return negar(
        403,
        'O organizador só pode marcar outro participante como encerrado.'
      );
    }
  }

  if (estadoAtual === novoEstado) {
    // Idempotente: reenviar o mesmo estado (rede instável, toque duplo) não é
    // erro nem transição.
    return OK;
  }

  if (!podeTransicionarParticipante(estadoAtual, novoEstado)) {
    return negar(
      409,
      `Transição inválida: de '${estadoAtual}' não é possível ir para '${novoEstado}'.`
    );
  }

  return OK;
}

// ---------------------------------------------------------------------------
// 6. Vínculo do carro de apoio.
// ---------------------------------------------------------------------------

/**
 * Valida o invariante que a FK de `apoio_user_id` NÃO garante (ver o
 * comentário em lib/schema.sql): a FK só prova que o usuário existe em algum
 * lugar do sistema, não que ele é participante DESTE downwind, nem que é
 * motorista.
 *
 * Apontar para alguém de outro downwind seria vazamento de identidade entre
 * grupos; apontar para outro velejador prometeria um carro que não existe; e
 * apontar para si mesmo é bug de cliente que a UI não deveria conseguir
 * produzir — mas o servidor não confia na UI.
 */
export function apoioValido(args: {
  alvoUserId: string;
  alvoPapel: ParticipantePapel;
  apoioUserId: string | null;
  participantes: Array<{ userId: string; papel: ParticipantePapel }>;
}): Veredito {
  const { alvoUserId, alvoPapel, apoioUserId, participantes } = args;

  // Desvincular é sempre válido — inclusive para quem nunca teve apoio.
  if (apoioUserId === null) return OK;

  if (alvoPapel === 'apoio_terra') {
    return negar(400, 'Quem está no apoio em terra não tem carro de apoio.');
  }
  if (apoioUserId === alvoUserId) {
    return negar(400, 'Ninguém pode ser o próprio apoio.');
  }

  const apoio = participantes.find((p) => p.userId === apoioUserId);
  if (!apoio) {
    return negar(400, 'O apoio escolhido não participa deste downwind.');
  }
  if (apoio.papel !== 'apoio_terra') {
    return negar(400, 'Só quem está no apoio em terra pode ser carro de apoio.');
  }

  return OK;
}

/**
 * Quem pode definir o apoio de quem: o próprio velejador escolhe o seu, e o
 * organizador designa por todos (é ele que combina a logística dos carros).
 */
export function podeDefinirApoio(args: {
  solicitanteId: string;
  solicitanteEhOrganizador: boolean;
  alvoUserId: string;
}): Veredito {
  if (args.solicitanteId === args.alvoUserId) return OK;
  if (args.solicitanteEhOrganizador) return OK;
  return negar(403, 'Só você ou o organizador podem definir o seu apoio.');
}

export type DownwindVisibilidade = 'privado' | 'comunidade';

/**
 * Quem pode abrir o mapa ao vivo / replay de um downwind
 * (`GET /api/downwind/[id]/live`, tela `app/dw-live/[id]`).
 *
 * BUG QUE ISTO CORRIGE: a rota era pública sem NENHUMA checagem — lia
 * `d.visibilidade`, devolvia o valor no payload e nunca o verificava.
 * Resultado: qualquer pessoa com o UUID via nome, avatar e a TRILHA GPS
 * COMPLETA (posição, hora, velocidade, direção, bateria) de todos os
 * participantes, inclusive de downwinds marcados como `privado` — que é o
 * padrão da coluna e a opção pré-selecionada no modal de criação.
 *
 * O app já tinha o controle de privacidade: o seletor existe em
 * `components/activity/CriarDownwindModal.tsx` e `GET /api/events` respeita a
 * escolha. Só esta rota ignorava. Ou seja, o organizador escolhia "privado" e
 * não ganhava privacidade nenhuma — o pior tipo de falha, porque a interface
 * promete uma proteção que não existe.
 *
 * UUID não é adivinhável por força bruta, mas também não é segredo: aparece em
 * link compartilhado, histórico do navegador, print de tela e cabeçalho
 * Referer. Tratar "só quem tem o id" como autorização é confundir
 * identificador com credencial.
 *
 * REGRA: `comunidade` é espectador aberto de propósito (é para isso que a
 * opção existe — deixar a comunidade acompanhar a travessia). `privado` fica
 * restrito a quem participa e à moderação.
 */
export function podeVerReplayAoVivo(args: {
  visibilidade: DownwindVisibilidade;
  /** `null` = visitante sem sessão. */
  participacao: MinhaParticipacao | null;
  ehModerador: boolean;
}): boolean {
  if (args.visibilidade === 'comunidade') return true;
  if (args.ehModerador) return true;
  return args.participacao !== null;
}
