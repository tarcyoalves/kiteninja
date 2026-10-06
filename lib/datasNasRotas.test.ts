/**
 * Datas que as rotas entregam ao app, contra Postgres de verdade.
 *
 * Bug visto no celular: o feed mostrava "Mon Oct 05 2026 23:58:21 GMT+0000
 * (Coordinated Universal Time)" e o Diário "Tue Oct 06 2026 00:00:00
 * GMT+0000…". O driver devolve `timestamptz`/`date` como objeto Date, e as
 * rotas faziam `String(valor)`. Os testes de lib/datas.test.ts cobrem as
 * funções; este cobre o caminho inteiro — gravar pela rota e ler pela rota —
 * para que uma rota nova (ou um `String()` reintroduzido) não traga o texto
 * cru de volta.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

import { criarUsuario, ler, logarComo, prepararBanco, req, type UsuarioDeTeste } from '@/test/rotasComPglite';

let rider: UsuarioDeTeste;
const ISO_INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

beforeAll(async () => {
  await prepararBanco();
  rider = await criarUsuario({ nome: 'Velejadora das Datas' });
}, 60_000);

describe('datas nas respostas das rotas', () => {
  it('velejo volta com a data do calendário (AAAA-MM-DD) e o post do feed com instante ISO', async () => {
    await logarComo(rider);
    const sessoes = await import('@/app/api/sessions/route');
    const criado = await ler(
      await sessoes.POST(
        req('POST', '/api/sessions', {
          spotId: null, // como o KiteDataContext manda para spot fora do banco
          spotName: 'Galinhos',
          spotLocation: 'Galinhos / RN',
          date: '2026-10-04',
          startTime: '14:30',
          durationMinutes: 85,
          discipline: 'Kitesurf Twintip',
          kiteSizeM2: 12,
          avgWindKnots: 19,
          rating: 5,
          isPublic: true,
        }),
      ),
    );
    expect(criado.status, JSON.stringify(criado.body)).toBeLessThan(300);

    const lista = await ler(await sessoes.GET());
    const velejos = (Array.isArray(lista.body) ? lista.body : (lista.body.sessions as unknown[])) as Array<{
      date: string;
    }>;
    expect(velejos.length).toBeGreaterThan(0);
    // Exatamente o dia gravado — nem texto de Date, nem um dia antes por fuso.
    expect(velejos[0].date).toBe('2026-10-04');

    const posts = await import('@/app/api/posts/route');
    const feed = await ler(await posts.GET(req('GET', '/api/posts')));
    const itens = (Array.isArray(feed.body) ? feed.body : (feed.body.posts as unknown[])) as Array<{
      timestamp: string;
    }>;
    expect(itens.length).toBeGreaterThan(0);
    expect(itens[0].timestamp).toMatch(ISO_INSTANTE);
  });
});
