import { describe, it, expect } from 'vitest';
import {
  determinarAtividadeAtual,
  mapaMostraDownwind,
  travessiaEmAndamento,
  validarInicioAtividade,
} from './activity';

describe('Máquina de Atividades (lib/activity.ts)', () => {
  it('identifica estado livre quando nenhuma atividade está ativa', () => {
    const estado = determinarAtividadeAtual({
      modoNavegacaoAtivo: false,
      downwindAtivo: null,
    });

    expect(estado.tipo).toBe('nenhuma');
    expect(estado.emAndamento).toBe(false);
    expect(estado.podeIniciarOutra).toBe(true);

    const validacao = validarInicioAtividade(
      { modoNavegacaoAtivo: false, downwindAtivo: null },
      'velejo_solo'
    );
    expect(validacao.permitido).toBe(true);
  });

  it('bloqueia novas atividades quando o Modo Navegação solo está ativo', () => {
    const estado = determinarAtividadeAtual({
      modoNavegacaoAtivo: true,
      downwindAtivo: null,
    });

    expect(estado.tipo).toBe('velejo_solo');
    expect(estado.emAndamento).toBe(true);
    expect(estado.podeIniciarOutra).toBe(false);
    expect(estado.motivoBloqueio).toContain('Modo Navegação solo');

    const validacao = validarInicioAtividade(
      { modoNavegacaoAtivo: true, downwindAtivo: null },
      'downwind'
    );
    expect(validacao.permitido).toBe(false);
    expect(validacao.erro).toContain('Modo Navegação solo');
  });

  /*
   * ESTE TESTE AFIRMAVA O BUG.
   *
   * A versão anterior exigia que um downwind `aberto` bloqueasse tudo, e por
   * isso passava verde enquanto o dono criava um downwind para 5 de setembro e
   * perdia, na hora, a aba Mapa e o botão de Velejo Solo. Um teste pode
   * proteger um defeito quando descreve a implementação em vez do que o
   * usuário precisa.
   */
  it('downwind AGENDADO não bloqueia nada — é compromisso, não travessia', () => {
    const estado = determinarAtividadeAtual({
      modoNavegacaoAtivo: false,
      downwindAtivo: { id: 'dw-123', nome: 'Downwind Cumbuco', status: 'aberto' },
    });
    expect(estado.tipo).toBe('nenhuma');
    expect(estado.emAndamento).toBe(false);
    expect(estado.podeIniciarOutra).toBe(true);
    expect(estado.motivoBloqueio).toBeUndefined();
    // Mas não some: a tela precisa poder oferecer o atalho para abri-lo.
    expect(estado.downwindAgendado).toEqual({ id: 'dw-123', nome: 'Downwind Cumbuco' });
  });

  it('downwind EM ANDAMENTO bloqueia — aí sim há gente na água', () => {
    const estado = determinarAtividadeAtual({
      modoNavegacaoAtivo: false,
      downwindAtivo: { id: 'dw-123', nome: 'Downwind Cumbuco', status: 'em_andamento' },
    });
    expect(estado.tipo).toBe('downwind');
    expect(estado.emAndamento).toBe(true);
    expect(estado.podeIniciarOutra).toBe(false);
    expect(estado.motivoBloqueio).toContain('Downwind Cumbuco');
    // Em andamento não é "agendado": os dois campos não podem valer juntos.
    expect(estado.downwindAgendado).toBeNull();
  });

  it('travessiaEmAndamento separa agendado de acontecendo', () => {
    // É esta função que decide se a aba Mapa vira mapa ao vivo (app/page.tsx).
    expect(travessiaEmAndamento({ status: 'em_andamento' })).toBe(true);
    expect(travessiaEmAndamento({ status: 'aberto' })).toBe(false);
    expect(travessiaEmAndamento({ status: 'encerrado' })).toBe(false);
    expect(travessiaEmAndamento({ status: 'cancelado' })).toBe(false);
    expect(travessiaEmAndamento(null)).toBe(false);
    expect(travessiaEmAndamento(undefined)).toBe(false);
  });

  it('com downwind agendado o velejo solo continua liberado', () => {
    // O caso concreto do relato: compromisso marcado para dali a três dias
    // não pode impedir alguém de velejar hoje.
    const v = validarInicioAtividade(
      {
        modoNavegacaoAtivo: false,
        downwindAtivo: { id: 'dw-123', nome: 'Downwind Cumbuco', status: 'aberto' },
      },
      'velejo_solo'
    );
    expect(v.permitido).toBe(true);
    expect(v.erro).toBeUndefined();
  });

  it('a recusa diz qual atividade foi recusada', () => {
    const v = validarInicioAtividade(
      {
        modoNavegacaoAtivo: false,
        downwindAtivo: { id: 'dw-1', nome: 'DW', status: 'em_andamento' },
      },
      'velejo_solo'
    );
    expect(v.permitido).toBe(false);
    expect(v.erro).toContain('velejo solo');
  });

  it('libera novas atividades se o downwind anterior já foi encerrado ou cancelado', () => {
    const estadoEncerrado = determinarAtividadeAtual({
      modoNavegacaoAtivo: false,
      downwindAtivo: { id: 'dw-123', nome: 'Downwind Cumbuco', status: 'encerrado' },
    });
    expect(estadoEncerrado.tipo).toBe('nenhuma');
    expect(estadoEncerrado.podeIniciarOutra).toBe(true);

    const estadoCancelado = determinarAtividadeAtual({
      modoNavegacaoAtivo: false,
      downwindAtivo: { id: 'dw-123', nome: 'Downwind Cumbuco', status: 'cancelado' },
    });
    expect(estadoCancelado.tipo).toBe('nenhuma');
    expect(estadoCancelado.podeIniciarOutra).toBe(true);
  });
});
describe('mapaMostraDownwind', () => {
  it('travessia em andamento entra sozinha', () => {
    expect(
      mapaMostraDownwind({ downwind: { status: 'em_andamento' }, abertoDeliberadamente: false })
    ).toBe(true);
  });

  it('agendado NÃO entra sozinho — este era o bug', () => {
    expect(
      mapaMostraDownwind({ downwind: { status: 'aberto' }, abertoDeliberadamente: false })
    ).toBe(false);
  });

  it('agendado entra quando a pessoa pede', () => {
    // O caminho que o dono descreveu como correto: entrar no downwind e
    // iniciar por lá.
    expect(
      mapaMostraDownwind({ downwind: { status: 'aberto' }, abertoDeliberadamente: true })
    ).toBe(true);
  });

  it('encerrado e cancelado não entram nem a pedido', () => {
    // Travessia que acabou tem tela própria (o resumo). Deixar entrar aqui
    // prenderia a pessoa numa tela ao vivo sem nada ao vivo.
    for (const status of ['encerrado', 'cancelado']) {
      expect(
        mapaMostraDownwind({ downwind: { status }, abertoDeliberadamente: true }),
        status
      ).toBe(false);
    }
  });

  it('sem downwind, nunca', () => {
    expect(mapaMostraDownwind({ downwind: null, abertoDeliberadamente: true })).toBe(false);
    expect(mapaMostraDownwind({ downwind: undefined, abertoDeliberadamente: true })).toBe(false);
  });
});
