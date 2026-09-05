import { describe, expect, it } from 'vitest';
import {
  ACOMPANHAMENTO_NUNCA_LIGA_SOZINHO,
  VALIDADE_APOIO_HORAS,
  acompanhamentoAtivo,
  devoReaproveitar,
  motivoIndisponivel,
  textoDoConvite,
} from './apoioSolo';

const agora = new Date('2026-09-05T12:00:00Z');
const daquiAPouco = new Date('2026-09-05T18:00:00Z').toISOString();
const jaPassou = new Date('2026-09-05T11:00:00Z').toISOString();

describe('validade do link', () => {
  it('dura 12h, como o link do motorista de downwind', () => {
    expect(VALIDADE_APOIO_HORAS).toBe(12);
  });

  it('link dentro da validade e velejo em andamento: serve', () => {
    expect(acompanhamentoAtivo({ expiraEm: daquiAPouco, encerradoEm: null }, agora)).toBe(true);
    expect(motivoIndisponivel({ expiraEm: daquiAPouco, encerradoEm: null }, agora)).toBeNull();
  });

  it('expirado é recusado — link de rastreio que não expira é problema, não comodidade', () => {
    expect(motivoIndisponivel({ expiraEm: jaPassou, encerradoEm: null }, agora)).toBe('expirado');
  });

  it('velejo encerrado é recusado mesmo com o link ainda no prazo', () => {
    // Saiu da água: o acompanhamento acaba junto. Continuar transmitindo seria
    // rastrear a pessoa no caminho de casa — mesma decisão de `posicaoVisivel`
    // no downwind.
    expect(
      motivoIndisponivel({ expiraEm: daquiAPouco, encerradoEm: agora.toISOString() }, agora)
    ).toBe('encerrado');
  });

  it('encerrado tem prioridade sobre expirado — o motivo mais informativo ganha', () => {
    expect(
      motivoIndisponivel({ expiraEm: jaPassou, encerradoEm: agora.toISOString() }, agora)
    ).toBe('encerrado');
  });

  it('o limite é exclusivo: no instante exato da expiração já não serve', () => {
    expect(motivoIndisponivel({ expiraEm: agora.toISOString(), encerradoEm: null }, agora)).toBe(
      'expirado'
    );
  });
});

describe('devoReaproveitar', () => {
  it('reaproveita a sessão que ainda está valendo', () => {
    // Sem isto, cada toque criaria um link novo e o amigo que recebeu o
    // primeiro veria uma trilha parada para sempre enquanto a pessoa velejava
    // na outra sessão.
    expect(devoReaproveitar({ expiraEm: daquiAPouco, encerradoEm: null }, agora)).toBe(true);
  });

  it('não reaproveita sessão expirada nem encerrada', () => {
    expect(devoReaproveitar({ expiraEm: jaPassou, encerradoEm: null }, agora)).toBe(false);
    expect(
      devoReaproveitar({ expiraEm: daquiAPouco, encerradoEm: agora.toISOString() }, agora)
    ).toBe(false);
  });

  it('sem sessão nenhuma, cria', () => {
    expect(devoReaproveitar(null, agora)).toBe(false);
  });
});

describe('contrato de privacidade', () => {
  it('a transmissão nunca liga sozinha', () => {
    // Protege uma decisão, não um comportamento acidental: nenhum velejo solo
    // manda posição ao servidor sem a pessoa ter pedido o link. É o que
    // responde ao custo de bateria e à privacidade de uma vez.
    expect(ACOMPANHAMENTO_NUNCA_LIGA_SOZINHO).toBe(true);
  });
});

describe('textoDoConvite', () => {
  it('diz quem e onde', () => {
    expect(textoDoConvite({ nome: 'Tarcyo', spot: 'Ponta do Mel' })).toBe(
      'Tarcyo está velejando em Ponta do Mel. Acompanhe ao vivo:'
    );
  });

  it('sem spot não deixa preposição solta', () => {
    expect(textoDoConvite({ nome: 'Ana', spot: null })).toBe(
      'Ana está velejando. Acompanhe ao vivo:'
    );
  });
});
