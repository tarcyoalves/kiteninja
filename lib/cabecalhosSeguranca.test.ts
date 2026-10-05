/**
 * Cabeçalhos de segurança do next.config.ts (T05).
 *
 * Chama o `headers()` de verdade e confere o que o Next entregaria — não lê o
 * arquivo procurando texto. A confirmação ponta a ponta (build + `next start` +
 * `curl -sI`) está no commit; este teste segura o contrato depois dele.
 */
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

async function cabecalhos() {
  const regras = await nextConfig.headers!();
  const regra = regras.find((r) => r.source === '/:path*');
  expect(regra, 'precisa existir uma regra para todas as rotas').toBeDefined();
  return new Map(regra!.headers.map((h) => [h.key, h.value]));
}

describe('cabeçalhos de segurança', () => {
  it('bloqueia o enquadramento do app em iframe (clickjacking no /admin)', async () => {
    const h = await cabecalhos();
    expect(h.get('X-Frame-Options')).toBe('DENY');
    expect(h.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
  });

  it('não vaza o token da URL no Referer, não deixa o navegador adivinhar o tipo', async () => {
    const h = await cabecalhos();
    expect(h.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(h.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('desliga câmera e microfone, mas mantém a geolocalização do próprio app', async () => {
    const h = await cabecalhos();
    expect(h.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(self)');
  });

  it('a CSP é só frame-ancestors: script-src/img-src/default-src quebrariam mapa, fontes e o WebView', async () => {
    const csp = (await cabecalhos()).get('Content-Security-Policy')!;
    expect(csp).not.toMatch(/script-src|img-src|default-src|style-src|connect-src|font-src/);
  });
});
