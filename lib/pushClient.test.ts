import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from './pushClient';

/**
 * Esta conversão nunca existiu no projeto, e a falta dela é o que manteve
 * `push_subscriptions` em ZERO com 9 usuários e as chaves VAPID corretamente
 * configuradas na Vercel: `pushManager.subscribe()` recebia a string
 * base64url crua onde a Push API exige `Uint8Array`, e o Safari do iOS
 * recusava a inscrição em silêncio.
 */
describe('urlBase64ToUint8Array', () => {
  it('devolve Uint8Array, não string — é o contrato que a Push API exige', () => {
    const r = urlBase64ToUint8Array('BOk9g2B_-KUP0jmPntmLFHs6wQ0eDQK1BRF1LcMjlzU7BiVCnxUkSVCrmj2zhUbhK8XjFiKng9EsbhRw_yIlMgI');
    expect(r).toBeInstanceOf(Uint8Array);
  });

  it('chave VAPID P-256 real decodifica para 65 bytes', () => {
    // Chave pública VAPID é um ponto EC P-256 não comprimido: 1 byte de
    // prefixo (0x04) + 32 bytes X + 32 bytes Y. Se a conversão estiver
    // errada, o tamanho não bate — é a checagem que pega erro de padding.
    const r = urlBase64ToUint8Array('BOk9g2B_-KUP0jmPntmLFHs6wQ0eDQK1BRF1LcMjlzU7BiVCnxUkSVCrmj2zhUbhK8XjFiKng9EsbhRw_yIlMgI');
    expect(r.length).toBe(65);
    expect(r[0]).toBe(0x04);
  });

  it('traduz o alfabeto base64url (-/_) para base64 padrão (+//)', () => {
    // 'a-b_' em base64url equivale a 'a+b/' em base64 padrão. Sem a troca,
    // atob lançaria ou produziria bytes errados.
    expect(() => urlBase64ToUint8Array('a-b_')).not.toThrow();
    const comTraco = urlBase64ToUint8Array('a-b_');
    const equivalentePadrao = Uint8Array.from(atob('a+b/'), (c) => c.charCodeAt(0));
    expect(Array.from(comTraco)).toEqual(Array.from(equivalentePadrao));
  });

  it('repõe o padding "=" que base64url omite', () => {
    // Comprimentos que não são múltiplo de 4 precisam de padding — sem ele,
    // atob rejeita a entrada.
    expect(() => urlBase64ToUint8Array('QQ')).not.toThrow(); // 2 chars -> precisa '=='
    expect(() => urlBase64ToUint8Array('QUJD')).not.toThrow(); // 4 chars -> nenhum padding
    expect(Array.from(urlBase64ToUint8Array('QQ'))).toEqual([65]); // 'A'
  });
});
