/**
 * Máquina de estado e regras de concorrência de atividades no KiteNinja.
 *
 * Invariante do produto: um velejador NUNCA pode ter duas atividades
 * de navegação simultâneas (ex.: velejo solo e downwind em grupo ao mesmo tempo).
 */

export type TipoAtividade = 'nenhuma' | 'velejo_solo' | 'downwind';

export interface ContextoAtividade {
  modoNavegacaoAtivo: boolean;
  downwindAtivo: {
    id: string;
    nome: string;
    status: 'aberto' | 'em_andamento' | 'encerrado' | 'cancelado';
  } | null;
}

export interface EstadoAtividadeAtual {
  tipo: TipoAtividade;
  emAndamento: boolean;
  descricao: string;
  podeIniciarOutra: boolean;
  motivoBloqueio?: string;
  /**
   * Downwind marcado para depois, que NÃO bloqueia nada.
   *
   * Existe para a tela poder oferecer um atalho ("abrir o downwind de sexta")
   * sem tratá-lo como atividade em curso — que é exatamente a confusão que
   * este arquivo passou a evitar.
   */
  downwindAgendado: { id: string; nome: string } | null;
}

/**
 * `aberto` é AGENDADO, não "acontecendo agora".
 *
 * O BUG QUE ISTO CORRIGE: o dono criou um downwind marcado para 5 de setembro
 * e, no mesmo instante, a aba Mapa parou de mostrar o mapa — virou o mapa ao
 * vivo da travessia, com o ponto A desenhado como se fosse hora de começar. E
 * o Velejo Solo ficou desabilitado, com "encerre ou saia dele antes de iniciar
 * outra atividade", por causa de um compromisso de dali a três dias.
 *
 * A causa era esta função tratar `aberto` e `em_andamento` como a mesma coisa.
 * Não são: `aberto` quer dizer "marcado, aceitando gente"; quem está na água é
 * `em_andamento`, e só isso é uma atividade em curso.
 *
 * A regra do produto continua valendo — ninguém navega em duas atividades ao
 * mesmo tempo. Ela só nunca quis dizer "quem tem downwind marcado para sexta
 * não pode velejar na quarta".
 *
 * Iniciar a travessia é decisão de dentro do downwind (`podeIniciarDownwind`
 * em lib/downwindAcesso.ts), não do mapa principal.
 */
export function travessiaEmAndamento(
  downwind: { status: string } | null | undefined
): boolean {
  return downwind?.status === 'em_andamento';
}

/**
 * A aba Mapa deve mostrar a tela do downwind em vez do mapa normal?
 *
 * DUAS PORTAS, e a diferença entre elas é o bug inteiro:
 *
 *  - **Travessia em andamento**: entra sozinha. Tem gente na água, e o mapa
 *    ao vivo é a tela certa sem ninguém precisar pedir.
 *  - **Downwind agendado**: SÓ quando a pessoa pediu. Foi tomar essa tela sem
 *    pedir que produziu o relato — criar um downwind para daqui a três dias e
 *    perder a aba Mapa na mesma hora, com o ponto A desenhado como se fosse
 *    para começar.
 *
 * Encerrado e cancelado não entram por porta nenhuma: o histórico tem tela
 * própria (o resumo), e o mapa principal não é lugar de travessia que acabou.
 */
export function mapaMostraDownwind(args: {
  downwind: { status: string } | null | undefined;
  /** A pessoa tocou em "Abrir downwind" / "Entrar no Downwind". */
  abertoDeliberadamente: boolean;
}): boolean {
  const { downwind, abertoDeliberadamente } = args;
  if (!downwind) return false;
  if (travessiaEmAndamento(downwind)) return true;
  return abertoDeliberadamente && downwind.status === 'aberto';
}

export function determinarAtividadeAtual(contexto: ContextoAtividade): EstadoAtividadeAtual {
  const { modoNavegacaoAtivo, downwindAtivo } = contexto;

  const agendado =
    downwindAtivo && downwindAtivo.status === 'aberto'
      ? { id: downwindAtivo.id, nome: downwindAtivo.nome }
      : null;

  if (travessiaEmAndamento(downwindAtivo)) {
    return {
      tipo: 'downwind',
      emAndamento: true,
      descricao: `Downwind em andamento: ${downwindAtivo!.nome}`,
      podeIniciarOutra: false,
      motivoBloqueio: `Você está na água no downwind "${downwindAtivo!.nome}". Encerre a sua participação antes de iniciar outra atividade.`,
      downwindAgendado: null,
    };
  }

  if (modoNavegacaoAtivo) {
    return {
      tipo: 'velejo_solo',
      emAndamento: true,
      descricao: 'Velejo solo em andamento',
      podeIniciarOutra: false,
      motivoBloqueio: 'Você já está no Modo Navegação solo. Encerre o velejo atual antes de iniciar um downwind.',
      downwindAgendado: agendado,
    };
  }

  return {
    tipo: 'nenhuma',
    emAndamento: false,
    descricao: 'Nenhuma atividade em andamento',
    podeIniciarOutra: true,
    downwindAgendado: agendado,
  };
}

/**
 * `alvo` entra na MENSAGEM, não na decisão.
 *
 * A decisão é simétrica de propósito: qualquer navegação em curso impede
 * qualquer outra, porque o aparelho tem um GPS só e duas trilhas ao mesmo
 * tempo produzem dois registros pela metade. Mas dizer QUAL atividade foi
 * recusada é o que transforma um aviso genérico em instrução.
 *
 * (O parâmetro existia e era ignorado — o lint apontava `alvo` sem uso. Ficou
 * assim desde que a função nasceu.)
 */
export function validarInicioAtividade(
  contexto: ContextoAtividade,
  alvo: 'velejo_solo' | 'downwind'
): { permitido: boolean; erro?: string } {
  const atual = determinarAtividadeAtual(contexto);
  if (!atual.podeIniciarOutra) {
    const nomeDoAlvo = alvo === 'velejo_solo' ? 'um velejo solo' : 'um downwind';
    return {
      permitido: false,
      erro: atual.motivoBloqueio
        ? `${atual.motivoBloqueio} (tentativa de iniciar ${nomeDoAlvo})`
        : `Você já possui uma atividade em andamento e não pode iniciar ${nomeDoAlvo}.`,
    };
  }
  return { permitido: true };
}