import { describe, expect, it } from 'vitest';
import {
  detectarNovoCommit,
  podeAtualizarSozinho,
  resultadoDaAtualizacao,
} from './appUpdate';

describe('detectarNovoCommit', () => {
  const atual = 'aaae5b612b07ad99fce3ad4198b3c7a4f5b12e04';

  it('não anuncia quando bundle e deploy são o mesmo commit', () => {
    expect(detectarNovoCommit(atual, atual)).toBeNull();
  });

  it('considera SHA curto e completo como a mesma revisão', () => {
    expect(detectarNovoCommit('aaae5b6', atual)).toBeNull();
    expect(detectarNovoCommit(atual, 'aaae5b6')).toBeNull();
  });

  it('anuncia somente quando existe outro SHA Git válido', () => {
    const novo = '1234567890abcdef1234567890abcdef12345678';
    expect(detectarNovoCommit(atual, novo)).toBe(novo);
  });

  it('não usa local, horário ou valor inválido como versão', () => {
    expect(detectarNovoCommit('local', atual)).toBeNull();
    expect(detectarNovoCommit(atual, 'local')).toBeNull();
    expect(detectarNovoCommit(atual, '2026-08-31T19:21:53.256Z')).toBeNull();
    expect(detectarNovoCommit(undefined, atual)).toBeNull();
  });
});

describe('podeAtualizarSozinho', () => {
  const seguro = {
    temDownwindAtivo: false,
    temSosAtivo: false,
    temModalAberto: false,
    appVisivel: false,
  };

  it('atualiza sozinho quando não há nada a perder e o app está escondido', () => {
    expect(podeAtualizarSozinho(seguro)).toBe(true);
  });

  /**
   * A trava mais importante. Recarregar durante um downwind mata o
   * `watchPosition` e a trilha em memória — apagaria a travessia de quem está
   * na água. Ficar uma versão atrás é muito melhor que isso.
   */
  it('NUNCA durante um downwind ativo', () => {
    expect(podeAtualizarSozinho({ ...seguro, temDownwindAtivo: true })).toBe(false);
  });

  it('NUNCA durante um SOS', () => {
    expect(podeAtualizarSozinho({ ...seguro, temSosAtivo: true })).toBe(false);
  });

  /** Recarregar com formulário aberto apagaria o que a pessoa digitou. */
  it('NUNCA com modal ou formulário aberto', () => {
    expect(podeAtualizarSozinho({ ...seguro, temModalAberto: true })).toBe(false);
  });

  /**
   * Com a tela à frente do usuário, o app "piscaria" sem motivo aparente. A
   * atualização silenciosa só vale quando ninguém está olhando.
   */
  it('não recarrega na cara do usuário', () => {
    expect(podeAtualizarSozinho({ ...seguro, appVisivel: true })).toBe(false);
  });

  it('qualquer impedimento sozinho já basta para não atualizar', () => {
    expect(
      podeAtualizarSozinho({
        temDownwindAtivo: true,
        temSosAtivo: true,
        temModalAberto: true,
        appVisivel: true,
      })
    ).toBe(false);
  });
});

describe('resultadoDaAtualizacao', () => {
  const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

  it('sem o parâmetro, não houve tentativa', () => {
    expect(resultadoDaAtualizacao('', SHA)).toBe('nao-tentou');
    expect(resultadoDaAtualizacao('?foo=1', SHA)).toBe('nao-tentou');
  });

  it('bundle igual ao pedido: funcionou', () => {
    expect(resultadoDaAtualizacao(`?__app_update=${SHA}`, SHA)).toBe('funcionou');
  });

  /** O parâmetro carrega SHA curto; o bundle traz o completo. */
  it('SHA curto e completo são a mesma revisão', () => {
    expect(resultadoDaAtualizacao('?__app_update=a1b2c3d4e5f6', SHA)).toBe('funcionou');
  });

  /**
   * O caso que não tinha como ser detectado antes: recarregou, e o WebView
   * entregou a versão antiga assim mesmo. O aviso voltava em 60 s, a pessoa
   * tocava de novo, e nada dizia que a atualização não estava pegando.
   */
  it('bundle diferente do pedido: falhou', () => {
    expect(resultadoDaAtualizacao('?__app_update=ffffffffffff', SHA)).toBe('falhou');
  });

  it('sem SHA no bundle não dá para confirmar — trata como falha', () => {
    expect(resultadoDaAtualizacao(`?__app_update=${SHA}`, null)).toBe('falhou');
    expect(resultadoDaAtualizacao(`?__app_update=${SHA}`, 'nao-e-um-sha')).toBe('falhou');
  });

  it('parâmetro com lixo é ignorado', () => {
    expect(resultadoDaAtualizacao('?__app_update=xyz', SHA)).toBe('nao-tentou');
  });
});
