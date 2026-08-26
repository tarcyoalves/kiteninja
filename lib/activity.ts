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
}

export function determinarAtividadeAtual(contexto: ContextoAtividade): EstadoAtividadeAtual {
  const { modoNavegacaoAtivo, downwindAtivo } = contexto;

  if (downwindAtivo && (downwindAtivo.status === 'aberto' || downwindAtivo.status === 'em_andamento')) {
    return {
      tipo: 'downwind',
      emAndamento: downwindAtivo.status === 'em_andamento',
      descricao: `Downwind ativo: ${downwindAtivo.nome}`,
      podeIniciarOutra: false,
      motivoBloqueio: `Você já está participando do downwind "${downwindAtivo.nome}". Encerre ou saia dele antes de iniciar outra atividade.`,
    };
  }

  if (modoNavegacaoAtivo) {
    return {
      tipo: 'velejo_solo',
      emAndamento: true,
      descricao: 'Velejo solo em andamento',
      podeIniciarOutra: false,
      motivoBloqueio: 'Você já está no Modo Navegação solo. Encerre o velejo atual antes de iniciar um downwind.',
    };
  }

  return {
    tipo: 'nenhuma',
    emAndamento: false,
    descricao: 'Nenhuma atividade em andamento',
    podeIniciarOutra: true,
  };
}

export function validarInicioAtividade(
  contexto: ContextoAtividade,
  alvo: 'velejo_solo' | 'downwind'
): { permitido: boolean; erro?: string } {
  const atual = determinarAtividadeAtual(contexto);
  if (!atual.podeIniciarOutra) {
    return {
      permitido: false,
      erro: atual.motivoBloqueio || 'Você já possui uma atividade em andamento.',
    };
  }
  return { permitido: true };
}