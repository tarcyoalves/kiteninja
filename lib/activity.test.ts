import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  aindaEstouNaTravessia,
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

/**
 * Guarda de código-fonte: os DOIS botões "Velejo Solo" ligam o Modo Navegação?
 *
 * O relato foi "cliquei em play, iniciar velejo solo, e voltou para o mapa
 * normal sem gravar". A causa: `modoNavegacaoAtivo` era estado LOCAL de
 * views/MapView.tsx, e a folha global (a do botão PLAY do menu inferior,
 * montada em app/page.tsx) não tinha como alcançá-lo. Ela avisava os
 * seguidores, fechava e ia para a aba Mapa — e parava aí.
 *
 * Nada disso era visível para tipo, lint, teste de unidade ou build: os dois
 * caminhos compilavam, e um deles funcionava. Só o caminho MENOS usado por
 * quem escreve o código (o do mapa) é que funcionava.
 *
 * Por isso o teste lê o arquivo. É feio de propósito: o custo de voltar a
 * errar aqui é o velejador achar que está sendo gravado e não estar — e os
 * seguidores recebendo "entrei na água" enquanto nada acontece.
 */
describe('os dois caminhos de "Velejo Solo" ligam o Modo Navegação', () => {
  /*
   * Os COMENTÁRIOS saem antes da conferência.
   *
   * Sem isso a guarda é falsa: comentar a chamada (`// setModoNavegacaoSolo(true)`)
   * deixa o texto no arquivo e o teste passa verde com o bug de volta. Foi o
   * que a contraprova mostrou na primeira versão deste teste.
   */
  const semComentarios = (texto: string) =>
    texto
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n')
      .map((linha) => linha.replace(/\/\/.*$/, ''))
      .join('\n');

  const trechoDoHandler = (arquivo: string, prop: string) => {
    const src = semComentarios(readFileSync(arquivo, 'utf8'));
    const i = src.indexOf(prop);
    expect(i, `${prop} não existe em ${arquivo}`).toBeGreaterThan(-1);
    // Do início da prop até o fim do handler — folgado de propósito.
    return src.slice(i, i + 2500);
  };

  it('a folha global (botão PLAY do menu inferior) liga o modo', () => {
    const handler = trechoDoHandler('app/page.tsx', 'onIniciarVelejoSolo');
    expect(handler).toContain('setModoNavegacaoSolo(true)');
  });

  it('a folha do mapa liga o modo', () => {
    const handler = trechoDoHandler('views/MapView.tsx', 'onIniciarVelejoSolo');
    expect(handler).toMatch(/setModoNavegacaoAtivo\(true\)/);
  });

  it('o estado mora no contexto, não numa tela só', () => {
    // É o que torna os dois caminhos alcançáveis. Se alguém devolver isto
    // para dentro do MapView, o botão do menu inferior quebra de novo em
    // silêncio.
    const ctx = readFileSync('context/KiteDataContext.tsx', 'utf8');
    expect(ctx).toContain('modoNavegacaoSolo');
    expect(ctx).toContain('setModoNavegacaoSolo');
  });
});

describe('aindaEstouNaTravessia', () => {
  it('encerrado e desistiu são os estados finais — saí', () => {
    expect(aindaEstouNaTravessia('encerrado')).toBe(false);
    expect(aindaEstouNaTravessia('desistiu')).toBe(false);
  });

  it('confirmado e navegando ainda contam como estar na travessia', () => {
    // Quem confirmou e não entrou na água ainda pode entrar — não é o mesmo
    // que ter saído.
    expect(aindaEstouNaTravessia('confirmado')).toBe(true);
    expect(aindaEstouNaTravessia('navegando')).toBe(true);
  });

  it('estado ausente conta como participando', () => {
    // Resposta antiga do servidor sem o campo não pode liberar duas
    // navegações ao mesmo tempo — é a invariante do produto.
    expect(aindaEstouNaTravessia(undefined)).toBe(true);
    expect(aindaEstouNaTravessia(null)).toBe(true);
  });
});

describe('encerrei o meu velejo, o grupo continua na água', () => {
  const travessia = (estado: string) => ({
    id: 'dw-1',
    nome: 'Galinhos',
    status: 'em_andamento' as const,
    minhaParticipacao: { estado },
  });

  it('a aba Mapa me solta — antes eu ficava preso até o último sair da água', () => {
    // O bug: `fecharTelaDoDownwind` não tinha efeito nenhum enquanto o
    // downwind estivesse em_andamento, mesmo eu já estando no carro.
    expect(
      mapaMostraDownwind({ downwind: travessia('encerrado'), abertoDeliberadamente: false })
    ).toBe(false);
  });

  it('mas eu posso voltar a acompanhar o grupo, a pedido', () => {
    expect(
      mapaMostraDownwind({ downwind: travessia('encerrado'), abertoDeliberadamente: true })
    ).toBe(true);
  });

  it('quem ainda está na água continua entrando sozinho', () => {
    for (const estado of ['confirmado', 'navegando']) {
      expect(
        mapaMostraDownwind({ downwind: travessia(estado), abertoDeliberadamente: false }),
        estado
      ).toBe(true);
    }
  });

  it('e o app para de dizer que estou na água quando não estou', () => {
    // Antes: "Você está na água no downwind X. Encerre a sua participação
    // antes de iniciar outra atividade" — para quem tinha acabado de
    // encerrar. E bloqueava iniciar qualquer coisa.
    const atividade = determinarAtividadeAtual({
      modoNavegacaoAtivo: false,
      downwindAtivo: travessia('encerrado'),
    });
    expect(atividade.podeIniciarOutra).toBe(true);
    expect(atividade.emAndamento).toBe(false);
  });

  it('quem não encerrou continua bloqueado — a invariante não mudou', () => {
    const atividade = determinarAtividadeAtual({
      modoNavegacaoAtivo: false,
      downwindAtivo: travessia('navegando'),
    });
    expect(atividade.podeIniciarOutra).toBe(false);
    expect(atividade.motivoBloqueio).toMatch(/na água/i);
  });
});
