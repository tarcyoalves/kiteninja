/**
 * Defeitos achados na varredura completa de 12/11/2026, pelas rotas reais.
 *
 * Cada teste aqui falhava antes da correção (ver docs/DIARIO-DE-PROGRESSO.md,
 * entrada de 12/11, para a contraprova de cada um).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

import { db, ler, params, prepararBanco, req, trocarPessoa, type UsuarioDeTeste } from '@/test/rotasComPglite';
import { entrarComo, novaPessoa } from '@/test/entrarRapido';

let autora: UsuarioDeTeste;
let outro: UsuarioDeTeste;

const VELEJO = {
  spotId: null,
  spotName: 'Galinhos',
  spotLocation: 'Galinhos / RN',
  date: '2026-11-10',
  startTime: '14:30',
  durationMinutes: 60,
  discipline: 'Kitesurf Twintip',
  kiteSizeM2: 9,
  avgWindKnots: 20,
  rating: 5,
  notes: 'Anotação que só eu deveria ver depois de tornar privado.',
  isPublic: true,
};

beforeAll(async () => {
  await prepararBanco();
  autora = await novaPessoa({ nome: 'Autora' });
  outro = await novaPessoa({ nome: 'Outro Velejador' });
}, 60_000);

async function titulosDoFeedDeRelatos(u: UsuarioDeTeste): Promise<string[]> {
  await entrarComo(u);
  const { GET } = await import('@/app/api/posts/route');
  const r = await ler(await GET(req('GET', '/api/posts')));
  return (r.body.posts as Array<{ content: string }>).map((p) => p.content);
}

describe('privacidade do velejo no feed de relatos', () => {
  it('velejo tornado PRIVADO some do feed de relatos dos outros (e continua no da autora)', async () => {
    await entrarComo(autora);
    const sessoes = await import('@/app/api/sessions/route');
    const criado = await ler(await sessoes.POST(req('POST', '/api/sessions', VELEJO)));
    expect(criado.status, JSON.stringify(criado.body)).toBe(200);
    const id = String(criado.body.id);

    // Público: o relato automático aparece para todo mundo.
    expect(await titulosDoFeedDeRelatos(outro)).toContain(VELEJO.notes);

    await entrarComo(autora);
    const { PATCH } = await import('@/app/api/sessions/[id]/route');
    const r = await ler(await PATCH(req('PATCH', `/api/sessions/${id}`, { isPublic: false }), params({ id })));
    expect(r.status).toBe(200);

    expect(await titulosDoFeedDeRelatos(outro)).not.toContain(VELEJO.notes);
    expect(await titulosDoFeedDeRelatos(autora)).toContain(VELEJO.notes);
  });
});

describe('comentários de relato exigem login', () => {
  it('anônimo recebe 401 ao ler os comentários de um post', async () => {
    const post = await db.query<{ id: string }>(
      `INSERT INTO posts (user_id, title, content) VALUES ($1, 'Relato', 'Texto do relato') RETURNING id`,
      [autora.id],
    );
    const id = post.rows[0].id;
    await db.query(`INSERT INTO post_comments (post_id, user_id, text) VALUES ($1, $2, 'comentário interno')`, [
      id,
      outro.id,
    ]);
    const { GET } = await import('@/app/api/posts/[id]/comments/route');

    trocarPessoa(); // sem cookie
    const anonimo = await ler(await GET(req('GET', `/api/posts/${id}/comments`), params({ id })));
    expect(anonimo.status).toBe(401);

    await entrarComo(outro);
    const logado = await ler(await GET(req('GET', `/api/posts/${id}/comments`), params({ id })));
    expect(logado.status).toBe(200);
    expect((logado.body.comments as unknown[]).length).toBe(1);
  });
});

describe('paginação do feed de velejos', () => {
  it('o cursor da próxima página guarda os milissegundos (ISO), para não pular velejo do mesmo segundo', async () => {
    // Página de 15: 17 velejos públicos garantem que existe próxima página.
    // created_at com milissegundos quebrados, como acontece em produção.
    for (let i = 0; i < 17; i++) {
      await db.query(
        `INSERT INTO sessions_log (user_id, spot_name, spot_location, date, start_time, duration_minutes,
           discipline, kite_size_m2, avg_wind_knots, is_public, created_at)
         VALUES ($1, 'Galinhos', 'RN', '2026-11-10', '14:30', 60, 'Kitesurf Twintip', 9, 20, TRUE,
                 NOW() - ($2 || ' milliseconds')::interval)`,
        [autora.id, String(i * 137 + 1)],
      );
    }
    await entrarComo(outro);
    const { GET } = await import('@/app/api/feed/route');
    const r = await ler(await GET(req('GET', '/api/feed?escopo=comunidade')));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const cursor = r.body.proximoCursor as string;
    expect(cursor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    // E a página seguinte não repete nem pula: as duas juntas dão os 17 (+ o
    // que os testes acima criaram), sem id duplicado.
    const ids1 = (r.body.sessoes as Array<{ id: string }>).map((x) => x.id);
    const r2 = await ler(await GET(req('GET', `/api/feed?escopo=comunidade&cursor=${encodeURIComponent(cursor)}`)));
    const ids2 = (r2.body.sessoes as Array<{ id: string }>).map((x) => x.id);
    expect(new Set([...ids1, ...ids2]).size).toBe(ids1.length + ids2.length);
    const total = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM sessions_log WHERE is_public = TRUE`,
    );
    expect(ids1.length + ids2.length).toBe(total.rows[0].n);
  });
});

describe('entrada malformada não vira erro 500', () => {
  it('id só com traços é recusado (400/404) nas rotas de detalhe', async () => {
    await entrarComo(outro);
    const tracos = '-'.repeat(36);
    const sessao = await import('@/app/api/sessions/[id]/route');
    const rider = await import('@/app/api/riders/[id]/route');
    const anuncio = await import('@/app/api/listings/[id]/route');
    for (const r of [
      await sessao.GET(req('GET', `/api/sessions/${tracos}`), params({ id: tracos })),
      await rider.GET(req('GET', `/api/riders/${tracos}`), params({ id: tracos })),
      await anuncio.GET(req('GET', `/api/listings/${tracos}`), params({ id: tracos })),
    ]) {
      expect([400, 404]).toContain(r.status);
    }
  });

  it('limit negativo no feed de relatos é ajustado; data inválida ao editar velejo é 400', async () => {
    await entrarComo(autora);
    const posts = await import('@/app/api/posts/route');
    expect((await posts.GET(req('GET', '/api/posts?limit=-5'))).status).toBe(200);

    const meu = await db.query<{ id: string }>(`SELECT id FROM sessions_log WHERE user_id = $1 LIMIT 1`, [autora.id]);
    const id = meu.rows[0].id;
    const { PATCH } = await import('@/app/api/sessions/[id]/route');
    const r = await PATCH(req('PATCH', `/api/sessions/${id}`, { date: '12/11/2026' }), params({ id }));
    expect(r.status).toBe(400);
  });
});
