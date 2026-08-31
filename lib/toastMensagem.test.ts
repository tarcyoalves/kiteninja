import { describe, expect, it } from 'vitest';
import { deveExibirToastMensagem, escolherAvisoMaisRecente } from './toastMensagem';

describe('deveExibirToastMensagem', () => {
  it('não exibe nada quando não há mensagem', () => {
    expect(deveExibirToastMensagem(null, null)).toBe(false);
    expect(deveExibirToastMensagem(null, 'm1')).toBe(false);
  });

  it('exibe uma mensagem que ainda não foi mostrada', () => {
    expect(deveExibirToastMensagem({ id: 'm1' }, null)).toBe(true);
  });

  /**
   * A regressão em si. Antes da correção, trocar de aba reexecutava o efeito
   * do toast com a mesma mensagem ainda no contexto e o popup reaparecia —
   * de novo, e de novo, a cada navegação, mesmo já lido.
   */
  it('NÃO reexibe a mesma mensagem já mostrada', () => {
    expect(deveExibirToastMensagem({ id: 'm1' }, 'm1')).toBe(false);
  });

  it('exibe a próxima mensagem que chega depois de uma já mostrada', () => {
    expect(deveExibirToastMensagem({ id: 'm2' }, 'm1')).toBe(true);
  });

  /**
   * Identidade é por id, nunca por conteúdo: duas mensagens com o mesmo texto
   * ("bora?" mandado duas vezes) são dois avisos legítimos e os dois devem
   * aparecer. Comparar texto engoliria o segundo.
   */
  it('trata mensagens de texto idêntico mas ids distintos como avisos distintos', () => {
    const primeira = { id: 'm1', text: 'bora?' };
    const segunda = { id: 'm2', text: 'bora?' };
    expect(deveExibirToastMensagem(primeira, null)).toBe(true);
    expect(deveExibirToastMensagem(segunda, primeira.id)).toBe(true);
  });
});

describe('escolherAvisoMaisRecente', () => {
  const geral = {
    id: 'm1',
    nome: 'Chat',
    texto: 'oi geral',
    quando: '2026-08-31T12:00:00.000Z',
    ehDm: false,
  };
  const dm = {
    id: 'dm:u1:2026-08-31T12:00:05.000Z',
    nome: 'Tarcyo',
    texto: 'oi direto',
    quando: '2026-08-31T12:00:05.000Z',
    ehDm: true,
  };

  it('devolve null quando não há aviso nenhum', () => {
    expect(escolherAvisoMaisRecente(null, null)).toBeNull();
  });

  it('devolve o único que existe', () => {
    expect(escolherAvisoMaisRecente(geral, null)).toBe(geral);
    expect(escolherAvisoMaisRecente(null, dm)).toBe(dm);
  });

  /**
   * O caso que motivou a função: os dois watchers fazem poll independente,
   * então a DM mais nova pode chegar ao cliente DEPOIS de uma mensagem de
   * chat mais velha. Ordenar por chegada mostraria a errada.
   */
  it('escolhe pelo horário da mensagem, não pela ordem de chegada', () => {
    expect(escolherAvisoMaisRecente(geral, dm)).toBe(dm);

    const geralMaisNovo = { ...geral, quando: '2026-08-31T12:00:09.000Z' };
    expect(escolherAvisoMaisRecente(geralMaisNovo, dm)).toBe(geralMaisNovo);
  });

  it('no empate exato, a DM vence — é endereçada à pessoa', () => {
    const mesmoInstante = { ...dm, quando: geral.quando };
    expect(escolherAvisoMaisRecente(geral, mesmoInstante)).toBe(mesmoInstante);
  });
});
