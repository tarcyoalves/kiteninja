import { describe, it, expect } from 'vitest';
import { determinarAtividadeAtual, validarInicioAtividade } from './activity';

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

  it('bloqueia novas atividades quando há downwind ativo aberto ou em andamento', () => {
    const estadoAberto = determinarAtividadeAtual({
      modoNavegacaoAtivo: false,
      downwindAtivo: { id: 'dw-123', nome: 'Downwind Cumbuco', status: 'aberto' },
    });
    expect(estadoAberto.tipo).toBe('downwind');
    expect(estadoAberto.podeIniciarOutra).toBe(false);
    expect(estadoAberto.motivoBloqueio).toContain('Downwind Cumbuco');

    const estadoAndamento = determinarAtividadeAtual({
      modoNavegacaoAtivo: false,
      downwindAtivo: { id: 'dw-123', nome: 'Downwind Cumbuco', status: 'em_andamento' },
    });
    expect(estadoAndamento.tipo).toBe('downwind');
    expect(estadoAndamento.emAndamento).toBe(true);
    expect(estadoAndamento.podeIniciarOutra).toBe(false);
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