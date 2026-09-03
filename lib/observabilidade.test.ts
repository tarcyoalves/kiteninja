import { describe, it, expect } from 'vitest';
import { impressaoDigital } from './observabilidade';

/**
 * A impressão digital é o que impede a tabela de erros de encher o banco do
 * plano gratuito numa tarde: sem ela, um cliente em laço geraria uma linha por
 * falha. Estes testes travam as duas propriedades de que isso depende — id na
 * URL não cria linha nova, e rotas de verdade diferentes não se misturam.
 */
describe('impressaoDigital', () => {
  it('agrupa o mesmo erro vindo de ids diferentes na mesma rota', () => {
    const a = impressaoDigital(
      'servidor',
      '/api/downwind/a1b2c3d4-1111-2222-3333-444455556666/live',
      'boom'
    );
    const b = impressaoDigital(
      'servidor',
      '/api/downwind/f0e1d2c3-9999-8888-7777-666655554444/live',
      'boom'
    );
    expect(a).toBe(b);
    expect(a).toBe('servidor|/api/downwind/#id/live|boom');
  });

  it('agrupa ids numéricos também', () => {
    expect(impressaoDigital('cliente', '/velejos/12345', 'x')).toBe(
      impressaoDigital('cliente', '/velejos/98', 'x')
    );
  });

  it('não mistura rotas diferentes', () => {
    expect(impressaoDigital('servidor', '/api/feed', 'boom')).not.toBe(
      impressaoDigital('servidor', '/api/spots', 'boom')
    );
  });

  it('não mistura servidor com cliente', () => {
    expect(impressaoDigital('servidor', '/api/feed', 'boom')).not.toBe(
      impressaoDigital('cliente', '/api/feed', 'boom')
    );
  });

  it('não mistura mensagens diferentes', () => {
    expect(impressaoDigital('servidor', '/api/feed', 'boom')).not.toBe(
      impressaoDigital('servidor', '/api/feed', 'crash')
    );
  });

  it('aceita rota ausente sem quebrar', () => {
    expect(impressaoDigital('servidor', null, 'boom')).toBe('servidor|desconhecida|boom');
  });

  it('trunca para caber na coluna, mesmo com stack gigante na mensagem', () => {
    const enorme = 'x'.repeat(5000);
    expect(impressaoDigital('cliente', '/api/feed', enorme).length).toBeLessThanOrEqual(900);
  });
});
