/**
 * Testes da autorização do mapa ao vivo do downwind.
 *
 * Este arquivo existe para travar decisões de PRIVACIDADE, não só de código.
 * O mapa mostra onde pessoas estão neste instante; as regras que decidem quem
 * vê isso não podem ser afrouxadas por acidente numa refatoração futura. Por
 * isso os casos NEGATIVOS aqui são tão explícitos quanto os positivos — em
 * especial "moderação não vê posição", que parece esquecimento e é decisão.
 */
import { describe, expect, it } from 'vitest';
import {
  apoioValido,
  MSG_DOWNWIND_NAO_ENCONTRADO,
  podeCancelarDownwind,
  podeDefinirApoio,
  podeEncerrarDownwindComoUsuario,
  podeIniciarDownwind,
  podeMudarEstadoDeParticipante,
  podeReportarPosicao,
  podeVerPosicoes,
  podeVerResumoDownwind,
  posicaoVisivel,
  type MinhaParticipacao,
  podeListarDownwind,
} from './downwindAcesso';
import type { DownwindParticipante } from './downwind';

const participacao = (over: Partial<MinhaParticipacao> = {}): MinhaParticipacao => ({
  papel: 'velejador',
  estado: 'navegando',
  ehOrganizador: false,
  apoioUserId: null,
  ...over,
});

const velejador = (
  userId: string,
  estado: DownwindParticipante['estado']
): DownwindParticipante => ({ userId, papel: 'velejador', ehOrganizador: false, estado });

const apoioTerra = (
  userId: string,
  estado: DownwindParticipante['estado']
): DownwindParticipante => ({ userId, papel: 'apoio_terra', ehOrganizador: false, estado });

describe('podeVerPosicoes — quem enxerga o mapa', () => {
  it('participante de um downwind em andamento vê as posições', () => {
    const v = podeVerPosicoes({ statusDownwind: 'em_andamento', participacao: participacao() });
    expect(v.permitido).toBe(true);
    expect(v.servePosicoes).toBe(true);
  });

  it('OBRIGATÓRIO: não-participante recebe 404, nunca 403', () => {
    const v = podeVerPosicoes({ statusDownwind: 'em_andamento', participacao: null });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(404);
    expect(v.status).not.toBe(403);
  });

  it('downwind inexistente e downwind de terceiro dão a MESMA resposta (não confirma existência)', () => {
    const inexistente = podeVerPosicoes({ statusDownwind: null, participacao: null });
    const deTerceiro = podeVerPosicoes({ statusDownwind: 'em_andamento', participacao: null });
    expect(inexistente.status).toBe(deTerceiro.status);
    expect(inexistente.mensagem).toBe(deTerceiro.mensagem);
    expect(inexistente.mensagem).toBe(MSG_DOWNWIND_NAO_ENCONTRADO);
  });

  it('quem desistiu perde o mapa junto com a participação (404)', () => {
    const v = podeVerPosicoes({
      statusDownwind: 'em_andamento',
      participacao: participacao({ estado: 'desistiu' }),
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(404);
  });

  it('quem encerrou a própria travessia ainda acompanha o resto do grupo', () => {
    // Ele saiu da água, mas o downwind é dele também — e é justamente quem
    // chegou primeiro que costuma ficar de olho em quem ainda não chegou.
    const v = podeVerPosicoes({
      statusDownwind: 'em_andamento',
      participacao: participacao({ estado: 'encerrado' }),
    });
    expect(v.permitido).toBe(true);
  });

  it.each(['encerrado', 'cancelado'] as const)(
    'downwind %s: acesso permitido, mas sem servir posição de ninguém',
    (status) => {
      const v = podeVerPosicoes({ statusDownwind: status, participacao: participacao() });
      expect(v.permitido).toBe(true);
      expect(v.servePosicoes).toBe(false);
    }
  );

  it('DECISÃO DE PRODUTO, não esquecimento: moderação NÃO ganha acesso ao mapa', () => {
    // Um admin que não participa da travessia é tratado como qualquer
    // estranho. Só o SOS tem exceção de moderação, porque é socorro. Se este
    // teste começar a falhar porque alguém "consertou" a função passando o
    // role, é a regra que está sendo quebrada, não o teste.
    const v = podeVerPosicoes({ statusDownwind: 'em_andamento', participacao: null });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(404);
  });
});

describe('posicaoVisivel — de quem a coordenada é servida', () => {
  it.each(['confirmado', 'navegando'] as const)('%s tem a posição compartilhada', (estado) => {
    expect(posicaoVisivel(estado)).toBe(true);
  });

  it.each(['encerrado', 'desistiu'] as const)(
    'OBRIGATÓRIO: %s para de ter a posição compartilhada (já saiu da água)',
    (estado) => {
      expect(posicaoVisivel(estado)).toBe(false);
    }
  );
});

describe('podeVerResumoDownwind — mais permissivo que o mapa ao vivo, de propósito', () => {
  it('participante comum vê o resumo de um downwind encerrado', () => {
    const v = podeVerResumoDownwind({
      solicitante: { role: 'rider' },
      statusDownwind: 'encerrado',
      participacao: participacao({ estado: 'encerrado' }),
    });
    expect(v.permitido).toBe(true);
  });

  it("DIFERENÇA-CHAVE com podeVerPosicoes: quem 'desistiu' AINDA vê o resumo", () => {
    // No mapa ao vivo, 'desistiu' perde o acesso junto com a participação
    // (ver podeVerPosicoes). No resumo não: é histórico do grupo, não
    // rastreamento em tempo real, e quem desistiu pode querer ver como foi.
    const v = podeVerResumoDownwind({
      solicitante: { role: 'rider' },
      statusDownwind: 'encerrado',
      participacao: participacao({ estado: 'desistiu' }),
    });
    expect(v.permitido).toBe(true);
  });

  it('moderação vê sem participar — é dado agregado, não posição individual ao vivo', () => {
    const v = podeVerResumoDownwind({
      solicitante: { role: 'admin' },
      statusDownwind: 'encerrado',
      participacao: null,
    });
    expect(v.permitido).toBe(true);
  });

  it('não-participante recebe 404, nunca 403', () => {
    const v = podeVerResumoDownwind({
      solicitante: { role: 'rider' },
      statusDownwind: 'encerrado',
      participacao: null,
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(404);
  });

  it('downwind inexistente e downwind de terceiro dão a mesma resposta', () => {
    const inexistente = podeVerResumoDownwind({
      solicitante: { role: 'rider' },
      statusDownwind: null,
      participacao: null,
    });
    expect(inexistente.mensagem).toBe(MSG_DOWNWIND_NAO_ENCONTRADO);
  });

  it('funciona também para downwind em_andamento (resumo parcial de quem já encerrou a própria parte)', () => {
    const v = podeVerResumoDownwind({
      solicitante: { role: 'rider' },
      statusDownwind: 'em_andamento',
      participacao: participacao(),
    });
    expect(v.permitido).toBe(true);
  });
});

describe('podeReportarPosicao', () => {
  it('velejador navegando num downwind em andamento reporta', () => {
    expect(
      podeReportarPosicao({ statusDownwind: 'em_andamento', participacao: participacao() })
        .permitido
    ).toBe(true);
  });

  it('não-participante recebe 404, igual ao GET', () => {
    const v = podeReportarPosicao({ statusDownwind: 'em_andamento', participacao: null });
    expect(v.status).toBe(404);
  });

  it('downwind ainda aberto não aceita posição (a tabela não pode crescer à toa)', () => {
    const v = podeReportarPosicao({ statusDownwind: 'aberto', participacao: participacao() });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(409);
  });

  it('quem já encerrou a travessia não grava mais posição', () => {
    const v = podeReportarPosicao({
      statusDownwind: 'em_andamento',
      participacao: participacao({ estado: 'encerrado' }),
    });
    expect(v.permitido).toBe(false);
  });
});

describe('podeIniciarDownwind', () => {
  it('QUALQUER velejador inicia — não é privilégio do organizador', () => {
    const v = podeIniciarDownwind({
      statusDownwind: 'aberto',
      participacao: participacao({ estado: 'confirmado', ehOrganizador: false }),
    });
    expect(v.permitido).toBe(true);
    expect(v.noOp).toBe(false);
  });

  it('apoio em terra não inicia a travessia (o carro não entra na água)', () => {
    const v = podeIniciarDownwind({
      statusDownwind: 'aberto',
      participacao: participacao({ papel: 'apoio_terra' }),
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(403);
  });

  it('vinte pessoas tocando Iniciar juntas: já em andamento vira no-op, não erro', () => {
    const v = podeIniciarDownwind({
      statusDownwind: 'em_andamento',
      participacao: participacao(),
    });
    expect(v.permitido).toBe(true);
    expect(v.noOp).toBe(true);
  });

  it.each(['encerrado', 'cancelado'] as const)('não reabre downwind %s', (status) => {
    const v = podeIniciarDownwind({ statusDownwind: status, participacao: participacao() });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(409);
  });

  it('não-participante recebe 404', () => {
    expect(
      podeIniciarDownwind({ statusDownwind: 'aberto', participacao: null }).status
    ).toBe(404);
  });
});

describe('podeEncerrarDownwindComoUsuario — a guarda anti-fail-open', () => {
  const organizador = participacao({ ehOrganizador: true });

  it('O TESTE MAIS IMPORTANTE: lista de participantes vazia RECUSA o encerramento', () => {
    // podeEncerrarDownwind([]) devolve true de propósito (.every de vazio), e
    // lib/downwind.ts transfere a esta camada a obrigação de garantir que a
    // lista foi realmente carregada. Um downwind sempre tem ao menos o
    // organizador, então vazio aqui só pode ser falha de query — e liberar
    // encerraria o rastreamento com gente possivelmente na água.
    const v = podeEncerrarDownwindComoUsuario({
      solicitante: { role: 'rider' },
      participacao: organizador,
      participantes: [],
      statusDownwind: 'em_andamento',
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(409);
  });

  it('organizador encerra quando todos os velejadores saíram da água', () => {
    const v = podeEncerrarDownwindComoUsuario({
      solicitante: { role: 'rider' },
      participacao: organizador,
      participantes: [velejador('a', 'encerrado'), velejador('b', 'desistiu')],
      statusDownwind: 'em_andamento',
    });
    expect(v.permitido).toBe(true);
  });

  it('organizador NÃO encerra com velejador ainda navegando', () => {
    const v = podeEncerrarDownwindComoUsuario({
      solicitante: { role: 'rider' },
      participacao: organizador,
      participantes: [velejador('a', 'encerrado'), velejador('b', 'navegando')],
      statusDownwind: 'em_andamento',
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(409);
    expect(v.mensagem).toContain('1 velejador');
  });

  it("velejador só 'confirmado' também bloqueia — confirmar não é ter saído da água", () => {
    const v = podeEncerrarDownwindComoUsuario({
      solicitante: { role: 'rider' },
      participacao: organizador,
      participantes: [velejador('a', 'confirmado')],
      statusDownwind: 'em_andamento',
    });
    expect(v.permitido).toBe(false);
  });

  it('apoio em terra não bloqueia o encerramento (nunca esteve na água)', () => {
    const v = podeEncerrarDownwindComoUsuario({
      solicitante: { role: 'rider' },
      participacao: organizador,
      participantes: [velejador('a', 'encerrado'), apoioTerra('b', 'confirmado')],
      statusDownwind: 'em_andamento',
    });
    expect(v.permitido).toBe(true);
  });

  it('participante comum não encerra o downwind do grupo', () => {
    const v = podeEncerrarDownwindComoUsuario({
      solicitante: { role: 'rider' },
      participacao: participacao({ ehOrganizador: false }),
      participantes: [velejador('a', 'encerrado')],
      statusDownwind: 'em_andamento',
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(403);
  });

  it('moderação encerra downwind travado, mesmo sem participar (não expõe coordenada)', () => {
    const v = podeEncerrarDownwindComoUsuario({
      solicitante: { role: 'admin' },
      participacao: null,
      participantes: [velejador('a', 'encerrado')],
      statusDownwind: 'em_andamento',
    });
    expect(v.permitido).toBe(true);
  });

  it('estranho sem participação recebe 404, não 403 (não confirma que existe)', () => {
    const v = podeEncerrarDownwindComoUsuario({
      solicitante: { role: 'rider' },
      participacao: null,
      participantes: [velejador('a', 'encerrado')],
      statusDownwind: 'em_andamento',
    });
    expect(v.status).toBe(404);
  });

  it('downwind já encerrado não encerra de novo', () => {
    const v = podeEncerrarDownwindComoUsuario({
      solicitante: { role: 'admin' },
      participacao: organizador,
      participantes: [velejador('a', 'encerrado')],
      statusDownwind: 'encerrado',
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(409);
  });
});

describe('podeCancelarDownwind', () => {
  it('cancela sem exigir quórum — é a válvula do "o grupo desistiu antes de sair"', () => {
    const v = podeCancelarDownwind({
      solicitante: { role: 'rider' },
      participacao: participacao({ ehOrganizador: true }),
      statusDownwind: 'em_andamento',
    });
    expect(v.permitido).toBe(true);
  });

  it('participante comum não cancela', () => {
    const v = podeCancelarDownwind({
      solicitante: { role: 'rider' },
      participacao: participacao(),
      statusDownwind: 'aberto',
    });
    expect(v.status).toBe(403);
  });

  it('downwind encerrado não é cancelável (já acabou, não há o que cancelar)', () => {
    const v = podeCancelarDownwind({
      solicitante: { role: 'admin' },
      participacao: participacao({ ehOrganizador: true }),
      statusDownwind: 'encerrado',
    });
    expect(v.permitido).toBe(false);
  });
});

describe('podeMudarEstadoDeParticipante', () => {
  const base = {
    solicitanteId: 'eu',
    solicitanteEhOrganizador: false,
    alvoUserId: 'eu',
    estadoAtual: 'navegando' as const,
  };

  it('encerro a minha própria travessia', () => {
    expect(
      podeMudarEstadoDeParticipante({ ...base, novoEstado: 'encerrado' }).permitido
    ).toBe(true);
  });

  it('reenviar o mesmo estado é idempotente, não erro (toque duplo, rede instável)', () => {
    expect(
      podeMudarEstadoDeParticipante({ ...base, novoEstado: 'navegando' }).permitido
    ).toBe(true);
  });

  it("respeita a transição proibida 'desistiu' -> 'navegando' de lib/downwind.ts", () => {
    const v = podeMudarEstadoDeParticipante({
      ...base,
      estadoAtual: 'desistiu',
      novoEstado: 'navegando',
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(409);
  });

  it("permite a volta legítima 'desistiu' -> 'confirmado'", () => {
    expect(
      podeMudarEstadoDeParticipante({
        ...base,
        estadoAtual: 'desistiu',
        novoEstado: 'confirmado',
      }).permitido
    ).toBe(true);
  });

  it('participante comum não mexe no estado de terceiro', () => {
    const v = podeMudarEstadoDeParticipante({
      ...base,
      alvoUserId: 'outro',
      novoEstado: 'encerrado',
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(403);
  });

  it('organizador marca terceiro como encerrado (o que foi embora sem mexer no celular)', () => {
    const v = podeMudarEstadoDeParticipante({
      ...base,
      solicitanteEhOrganizador: true,
      alvoUserId: 'outro',
      novoEstado: 'encerrado',
    });
    expect(v.permitido).toBe(true);
  });

  it('organizador NÃO coloca terceiro na água por decreto', () => {
    const v = podeMudarEstadoDeParticipante({
      ...base,
      solicitanteEhOrganizador: true,
      alvoUserId: 'outro',
      estadoAtual: 'confirmado',
      novoEstado: 'navegando',
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(403);
  });

  it("organizador NÃO declara desistência de terceiro (é declaração da pessoa)", () => {
    const v = podeMudarEstadoDeParticipante({
      ...base,
      solicitanteEhOrganizador: true,
      alvoUserId: 'outro',
      novoEstado: 'desistiu',
    });
    expect(v.permitido).toBe(false);
  });
});

describe('apoioValido — o invariante que a FK não garante', () => {
  const participantes = [
    { userId: 'velejador-1', papel: 'velejador' as const },
    { userId: 'velejador-2', papel: 'velejador' as const },
    { userId: 'motorista', papel: 'apoio_terra' as const },
  ];

  it('caminho feliz: velejador aponta para um apoio_terra do mesmo downwind', () => {
    const v = apoioValido({
      alvoUserId: 'velejador-1',
      alvoPapel: 'velejador',
      apoioUserId: 'motorista',
      participantes,
    });
    expect(v.permitido).toBe(true);
  });

  it('desvincular (null) é sempre válido', () => {
    const v = apoioValido({
      alvoUserId: 'velejador-1',
      alvoPapel: 'velejador',
      apoioUserId: null,
      participantes,
    });
    expect(v.permitido).toBe(true);
  });

  it('OBRIGATÓRIO: apoio de OUTRO downwind é rejeitado (a FK não pega isso)', () => {
    const v = apoioValido({
      alvoUserId: 'velejador-1',
      alvoPapel: 'velejador',
      apoioUserId: 'motorista-de-outra-travessia',
      participantes,
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(400);
  });

  it('OBRIGATÓRIO: outro velejador não pode ser carro de apoio', () => {
    const v = apoioValido({
      alvoUserId: 'velejador-1',
      alvoPapel: 'velejador',
      apoioUserId: 'velejador-2',
      participantes,
    });
    expect(v.permitido).toBe(false);
  });

  it('OBRIGATÓRIO: ninguém é o próprio apoio', () => {
    const v = apoioValido({
      alvoUserId: 'motorista',
      alvoPapel: 'velejador',
      apoioUserId: 'motorista',
      participantes,
    });
    expect(v.permitido).toBe(false);
  });

  it('quem está no apoio em terra não tem carro de apoio', () => {
    const v = apoioValido({
      alvoUserId: 'motorista',
      alvoPapel: 'apoio_terra',
      apoioUserId: 'outro-motorista',
      participantes,
    });
    expect(v.permitido).toBe(false);
  });
});

describe('podeDefinirApoio', () => {
  it('escolho o meu próprio apoio', () => {
    expect(
      podeDefinirApoio({
        solicitanteId: 'eu',
        solicitanteEhOrganizador: false,
        alvoUserId: 'eu',
      }).permitido
    ).toBe(true);
  });

  it('organizador designa o apoio dos outros (é ele que combina os carros)', () => {
    expect(
      podeDefinirApoio({
        solicitanteId: 'org',
        solicitanteEhOrganizador: true,
        alvoUserId: 'outro',
      }).permitido
    ).toBe(true);
  });

  it('participante comum não escolhe o apoio alheio', () => {
    const v = podeDefinirApoio({
      solicitanteId: 'eu',
      solicitanteEhOrganizador: false,
      alvoUserId: 'outro',
    });
    expect(v.permitido).toBe(false);
    expect(v.status).toBe(403);
  });
});

describe('podeListarDownwind', () => {
  const base = { visibilidade: 'privado' as const, ehCriador: false, ehParticipante: false };

  /**
   * O caso que motivou a função, relatado por um velejador de verdade: ele
   * criou o downwind, compartilhou o link, e nem ele mesmo via o que tinha
   * criado — não havia lista nenhuma, e downwind privado não gera evento.
   */
  it('quem criou SEMPRE vê o que criou, mesmo privado', () => {
    expect(podeListarDownwind({ ...base, ehCriador: true })).toBe(true);
  });

  it('quem participa vê, mesmo sem ter criado', () => {
    expect(podeListarDownwind({ ...base, ehParticipante: true })).toBe(true);
  });

  it('downwind da comunidade aparece para qualquer um', () => {
    expect(podeListarDownwind({ ...base, visibilidade: 'comunidade' })).toBe(true);
  });

  /**
   * A trava. Um downwind privado de terceiros não pode vazar numa lista —
   * o nome dele já diz onde e quando um grupo vai entrar na água.
   */
  it('downwind privado de terceiros NÃO aparece', () => {
    expect(podeListarDownwind(base)).toBe(false);
  });
});
