/**
 * V01 — fotos de relato, avatar e anúncio guardam URL do Blob, não base64.
 *
 * Pelas rotas reais, contra PGlite. Cada teste daqui tem contraprova no
 * diário (docs/diario/2026-11-12-V01-V02.md).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

import { db, ler, params, prepararBanco, req, type UsuarioDeTeste } from '@/test/rotasComPglite';
import { entrarComo, novaPessoa } from '@/test/entrarRapido';

const BLOB = 'https://abc123.public.blob.vercel-storage.com/relatos/foto-x1y2z3.jpg';
const BLOB2 = 'https://abc123.public.blob.vercel-storage.com/anuncios/capa-a1b2c3.jpg';
const DATA_ANTIGA = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

let autora: UsuarioDeTeste;

beforeAll(async () => {
  await prepararBanco();
  autora = await novaPessoa({ nome: 'Autora de Fotos' });
}, 60_000);

const RELATO = { title: 'Dia perfeito', content: 'Vento 20 nós, água lisa.' };

async function criarRelato(extra: Record<string, unknown>) {
  await entrarComo(autora);
  const { POST } = await import('@/app/api/posts/route');
  return ler(await POST(req('POST', '/api/posts', { ...RELATO, ...extra })));
}

async function feed() {
  await entrarComo(autora);
  const { GET } = await import('@/app/api/posts/route');
  const r = await ler(await GET(req('GET', '/api/posts')));
  return r.body.posts as Array<{ id: string; photoUrl?: string }>;
}

describe('relato (posts.photo_url)', () => {
  it('aceita URL https do Blob e devolve a mesma URL no feed', async () => {
    const r = await criarRelato({ photoUrl: BLOB });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const achado = (await feed()).find((p) => p.id === String(r.body.id));
    expect(achado?.photoUrl).toBe(BLOB);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['http:', 'http://abc123.public.blob.vercel-storage.com/relatos/x.jpg'],
    ['https de outro host', 'https://rastreador.exemplo.com/pixel.gif'],
    ['host enganoso', 'https://abc123.public.blob.vercel-storage.com.evil.com/x.jpg'],
    ['svg em data:', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
  ])('recusa %s', async (_nome, url) => {
    const r = await criarRelato({ photoUrl: url });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
  });

  it('CONTINUA aceitando data:image na entrada (aba/cliente antigo)', async () => {
    const r = await criarRelato({ photoUrl: DATA_ANTIGA });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('linha ANTIGA com data: já gravada no banco continua sendo devolvida', async () => {
    const ins = await db.query<{ id: string }>(
      `INSERT INTO posts (user_id, title, content, photo_url) VALUES ($1, 'Antigo', 'Relato antigo', $2) RETURNING id`,
      [autora.id, DATA_ANTIGA]
    );
    const achado = (await feed()).find((p) => p.id === ins.rows[0].id);
    expect(achado?.photoUrl).toBe(DATA_ANTIGA);
  });
});

describe('avatar (users.avatar_url)', () => {
  async function trocarAvatar(avatarUrl: string) {
    await entrarComo(autora);
    const { PATCH } = await import('@/app/api/profile/route');
    return ler(await PATCH(req('PATCH', '/api/profile', { avatarUrl })));
  }
  async function avatarNoBanco() {
    const r = await db.query<{ avatar_url: string }>('SELECT avatar_url FROM users WHERE id = $1', [autora.id]);
    return r.rows[0].avatar_url;
  }

  it('aceita URL https do Blob', async () => {
    const r = await trocarAvatar('https://abc123.public.blob.vercel-storage.com/avatares/eu-k9k9k9.jpg');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await avatarNoBanco()).toBe('https://abc123.public.blob.vercel-storage.com/avatares/eu-k9k9k9.jpg');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['http:', 'http://abc123.public.blob.vercel-storage.com/avatares/x.jpg'],
  ])('recusa %s e mantém o avatar atual', async (_nome, url) => {
    const antes = await avatarNoBanco();
    const r = await trocarAvatar(url);
    expect(r.status).toBe(400);
    expect(await avatarNoBanco()).toBe(antes);
  });

  it('avatar ANTIGO em data: continua sendo devolvido por /api/auth/me', async () => {
    await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [DATA_ANTIGA, autora.id]);
    await entrarComo(autora);
    const { GET } = await import('@/app/api/auth/me/route');
    const r = await ler(await GET());
    const user = (r.body.user ?? r.body) as { avatarUrl?: string };
    expect(user.avatarUrl).toBe(DATA_ANTIGA);
  });
});

describe('anúncio (listing_photos.data_url)', () => {
  const ANUNCIO = {
    title: 'Kite 9m em bom estado',
    description: 'Usado poucas vezes, sem remendos.',
    category: 'Kite',
    condition: 'Usado',
    priceCents: 250000,
    city: 'Natal',
    state: 'RN',
  };

  async function criarAnuncio(photos: string[]) {
    await entrarComo(autora);
    const { POST } = await import('@/app/api/listings/route');
    return ler(await POST(req('POST', '/api/listings', { ...ANUNCIO, photos })));
  }
  async function fotosDoAnuncio(id: string): Promise<string[]> {
    await entrarComo(autora);
    const { GET } = await import('@/app/api/listings/[id]/route');
    const r = await ler(await GET(req('GET', `/api/listings/${id}`), params({ id })));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return ((r.body.listing ?? r.body) as { photos: string[] }).photos;
  }

  it('aceita URLs do Blob, na ordem enviada, e as devolve', async () => {
    const r = await criarAnuncio([BLOB2, BLOB]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await fotosDoAnuncio(String(r.body.id))).toEqual([BLOB2, BLOB]);
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['http:', 'http://abc123.public.blob.vercel-storage.com/anuncios/x.jpg'],
    ['https de outro host', 'https://rastreador.exemplo.com/pixel.gif'],
  ])('recusa %s', async (_nome, url) => {
    const r = await criarAnuncio([url]);
    expect(r.status, JSON.stringify(r.body)).toBe(400);
  });

  it('CONTINUA aceitando data:image na entrada (aba/cliente antigo)', async () => {
    const r = await criarAnuncio([DATA_ANTIGA]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });

  it('PATCH troca as fotos por URLs do Blob e recusa esquema perigoso', async () => {
    const criado = await criarAnuncio([DATA_ANTIGA]);
    const id = String(criado.body.id);
    const { PATCH } = await import('@/app/api/listings/[id]/route');

    const ruim = await ler(await PATCH(req('PATCH', `/api/listings/${id}`, { photos: ['javascript:alert(1)'] }), params({ id })));
    expect(ruim.status).toBe(400);
    expect(await fotosDoAnuncio(id)).toEqual([DATA_ANTIGA]);

    const boa = await ler(await PATCH(req('PATCH', `/api/listings/${id}`, { photos: [BLOB2] }), params({ id })));
    expect(boa.status, JSON.stringify(boa.body)).toBe(200);
    expect(await fotosDoAnuncio(id)).toEqual([BLOB2]);
  });

  it('anúncio ANTIGO com data: já gravada continua sendo devolvido (detalhe e capa da lista)', async () => {
    const criado = await criarAnuncio([]);
    const id = String(criado.body.id);
    await db.query(`INSERT INTO listing_photos (listing_id, data_url, position) VALUES ($1, $2, 0)`, [id, DATA_ANTIGA]);
    expect(await fotosDoAnuncio(id)).toEqual([DATA_ANTIGA]);

    const { GET } = await import('@/app/api/listings/route');
    const lista = await ler(await GET(req('GET', '/api/listings?limit=50')));
    const item = (lista.body.listings as Array<{ id: string; coverPhoto?: string }>).find((l) => l.id === id);
    expect(item?.coverPhoto).toBe(DATA_ANTIGA);
  });
});

describe('rota do token de upload (/api/fotos/token)', () => {
  const corpo = (pathname: string) => ({
    type: 'blob.generate-client-token',
    payload: { pathname, callbackUrl: 'https://kiteninja.vercel.app/api/fotos/token', multipart: false },
  });

  it('sem login: 401', async () => {
    const { trocarPessoa } = await import('@/test/rotasComPglite');
    trocarPessoa();
    const { POST } = await import('@/app/api/fotos/token/route');
    const r = await ler(await POST(req('POST', '/api/fotos/token', corpo('relatos/a.jpg'))));
    expect(r.status).toBe(401);
  });

  it('sem BLOB_READ_WRITE_TOKEN: 503 com mensagem clara (não quebra em silêncio)', async () => {
    const guardado = process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    try {
      await entrarComo(autora);
      const { POST, GET } = await import('@/app/api/fotos/token/route');
      const r = await ler(await POST(req('POST', '/api/fotos/token', corpo('relatos/a.jpg'))));
      expect(r.status).toBe(503);
      expect(String(r.body.error)).toContain('BLOB_READ_WRITE_TOKEN');
      const g = await ler(await GET());
      expect(g.body.configurado).toBe(false);
    } finally {
      if (guardado !== undefined) process.env.BLOB_READ_WRITE_TOKEN = guardado;
    }
  });

  it('com token configurado: emite para relatos/avatares/anuncios e recusa outro prefixo', async () => {
    const guardado = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teste_falso_0000000000';
    try {
      await entrarComo(autora);
      const { POST } = await import('@/app/api/fotos/token/route');
      for (const caminho of ['relatos/a.jpg', 'avatares/a.jpg', 'anuncios/a.jpg']) {
        const r = await ler(await POST(req('POST', '/api/fotos/token', corpo(caminho))));
        expect(r.status, `${caminho}: ${JSON.stringify(r.body)}`).toBe(200);
        expect(typeof r.body.clientToken).toBe('string');
      }
      // `intro/` é de admin, `velejos/` tem rota própria: este token não serve.
      for (const caminho of ['intro/a.mp4', 'velejos/a.jpg', '../relatos/a.jpg']) {
        const r = await ler(await POST(req('POST', '/api/fotos/token', corpo(caminho))));
        expect(r.status, `${caminho}: ${JSON.stringify(r.body)}`).toBe(400);
      }
    } finally {
      if (guardado === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = guardado;
    }
  });

  /*
   * PLANO GRATUITO DO BLOB: 2.000 envios por mês; passou, a Vercel bloqueia o
   * armazenamento por 30 dias e TODAS as fotos somem. O app para de emitir
   * token em 1.500 (contado no banco), com aviso, em vez de chegar lá.
   */
  it('teto mensal do app: no 1.500º envio do mês o token é recusado (429) com aviso; abaixo disso, emite e conta', async () => {
    const guardado = process.env.BLOB_READ_WRITE_TOKEN;
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_teste_falso_0000000000';
    try {
      const pessoa = await novaPessoa({ nome: 'Teto Mensal' });
      await entrarComo(pessoa);
      const { POST } = await import('@/app/api/fotos/token/route');
      await db.query(`DELETE FROM rate_limit_tentativas WHERE chave = 'blob_upload_app'`);
      await db.query(
        `INSERT INTO rate_limit_tentativas (chave, expira_em)
         SELECT 'blob_upload_app', NOW() + INTERVAL '10 days' FROM generate_series(1, 1499)`
      );
      const ok = await ler(await POST(req('POST', '/api/fotos/token', corpo('relatos/a.jpg'))));
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      const n = await db.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM rate_limit_tentativas WHERE chave = 'blob_upload_app'`
      );
      expect(n.rows[0].n).toBe(1500);

      const barrado = await ler(await POST(req('POST', '/api/fotos/token', corpo('relatos/b.jpg'))));
      expect(barrado.status).toBe(429);
      expect(String(barrado.body.error)).toMatch(/limite mensal de fotos/i);
    } finally {
      await db.query(`DELETE FROM rate_limit_tentativas WHERE chave = 'blob_upload_app'`);
      if (guardado === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
      else process.env.BLOB_READ_WRITE_TOKEN = guardado;
    }
  });
});
