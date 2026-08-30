import { describe, expect, it } from 'vitest';
import {
  JANELA_ANTI_REPETICAO_MS,
  montarAvisoInicio,
  podeAvisarDeNovo,
} from './avisoVelejo';

describe('podeAvisarDeNovo', () => {
  const agora = new Date('2026-08-26T12:00:00Z');

  it('avisa quando nunca avisou antes', () => {
    expect(podeAvisarDeNovo(null, agora)).toBe(true);
  });

  /**
   * O caso que motivou a janela: tocar "Iniciar" duas vezes seguidas
   * acordaria o celular de todo mundo que segue a pessoa, duas vezes.
   */
  it('NÃO avisa de novo logo em seguida', () => {
    const ummin = new Date(agora.getTime() - 60_000);
    expect(podeAvisarDeNovo(ummin, agora)).toBe(false);
  });

  it('não avisa dentro da janela, mesmo perto do fim', () => {
    const quase = new Date(agora.getTime() - (JANELA_ANTI_REPETICAO_MS - 1));
    expect(podeAvisarDeNovo(quase, agora)).toBe(false);
  });

  it('avisa exatamente ao completar a janela', () => {
    const noLimite = new Date(agora.getTime() - JANELA_ANTI_REPETICAO_MS);
    expect(podeAvisarDeNovo(noLimite, agora)).toBe(true);
  });

  it('avisa de novo numa sessão de outro dia', () => {
    const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
    expect(podeAvisarDeNovo(ontem, agora)).toBe(true);
  });
});

describe('montarAvisoInicio', () => {
  it('põe o nome no título — é o que decide se a pessoa abre o app', () => {
    const { title } = montarAvisoInicio('Tarcyo', 'velejo_iniciado', 'Ponta do Mel');
    expect(title).toContain('Tarcyo');
  });

  it('inclui o spot quando existe', () => {
    const { body } = montarAvisoInicio('Tarcyo', 'velejo_iniciado', 'Ponta do Mel');
    expect(body).toContain('Ponta do Mel');
  });

  /**
   * Sem spot o texto não pode virar "em undefined" nem "em " solto — texto
   * curto é melhor que texto quebrado.
   */
  it.each([undefined, null, '', '   '])('omite o spot quando é %p', (spot) => {
    const { body } = montarAvisoInicio('Tarcyo', 'velejo_iniciado', spot);
    expect(body).not.toContain('undefined');
    expect(body).not.toContain('null');
    expect(body).not.toMatch(/\sem\s*$/);
    expect(body.trim()).toBe('Velejo começando agora.');
  });

  it('distingue downwind de velejo solo', () => {
    const dw = montarAvisoInicio('Tarcyo', 'downwind_iniciado');
    const solo = montarAvisoInicio('Tarcyo', 'velejo_iniciado');
    expect(dw.title).toContain('downwind');
    expect(dw.title).not.toBe(solo.title);
  });

  it('não deixa o título vazio quando o nome vem em branco', () => {
    const { title } = montarAvisoInicio('   ', 'velejo_iniciado');
    expect(title.trim()).not.toBe('');
    expect(title).toContain('velejador');
  });
});
