import { describe, expect, it } from 'vitest';
import { deveExibirToastMensagem } from './toastMensagem';

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
