/**
 * Limite de envio por usuário nas rotas que criam linha (V05, varredura de 12/11).
 *
 * Antes deste teste, qualquer sessão logada podia gravar comentários sem teto
 * — a única barreira era o login. Cada teste usa uma pessoa nova: o limite
 * de usuário logado é em memória e por chave de usuário, então pessoas
 * diferentes não se afetam e nenhum teste depende da ordem dos outros.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

import { db, ler, params, prepararBanco, req, type UsuarioDeTeste } from '@/test/rotasComPglite';
import { entrarComo, novaPessoa } from '@/test/entrarRapido';

const LIMITE_COMENTARIOS_POR_MINUTO = 20;

let autora: UsuarioDeTeste;

beforeAll(async () => {
  await prepararBanco();
  autora = await novaPessoa({ nome: 'Autora do relato' });
}, 60_000);

async function novoPost(): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO posts (user_id, title, content) VALUES ($1, 'Relato', 'Texto do relato') RETURNING id`,
    [autora.id],
  );
  return r.rows[0].id;
}

async function comentar(id: string, texto: string) {
  const { POST } = await import('@/app/api/posts/[id]/comments/route');
  return ler(await POST(req('POST', `/api/posts/${id}/comments`, { text: texto }), params({ id })));
}

describe('limite de comentários em post', () => {
  it('até o teto passa (200); o comentário seguinte recebe 429', async () => {
    const quem = await novaPessoa({ nome: 'Comentarista em laço' });
    const id = await novoPost();
    await entrarComo(quem);

    for (let i = 1; i <= LIMITE_COMENTARIOS_POR_MINUTO; i++) {
      const r = await comentar(id, `comentário ${i}`);
      expect(r.status, `comentário ${i}: ${JSON.stringify(r.body)}`).toBe(200);
    }

    const barrado = await comentar(id, 'o que estoura o teto');
    expect(barrado.status).toBe(429);
    expect(JSON.stringify(barrado.body)).toContain('Muitos comentários');

    // O 429 veio ANTES do INSERT: o banco guardou exatamente o teto.
    const gravados = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM post_comments WHERE post_id = $1 AND user_id = $2`,
      [id, quem.id],
    );
    expect(gravados.rows[0].n).toBe(LIMITE_COMENTARIOS_POR_MINUTO);
  });

  it('o limite é por pessoa: outro usuário comenta normalmente enquanto o primeiro está barrado', async () => {
    const primeiro = await novaPessoa({ nome: 'Primeiro a estourar' });
    const outro = await novaPessoa({ nome: 'Outro velejador' });
    const id = await novoPost();

    await entrarComo(primeiro);
    for (let i = 1; i <= LIMITE_COMENTARIOS_POR_MINUTO; i++) {
      expect((await comentar(id, `c${i}`)).status).toBe(200);
    }
    expect((await comentar(id, 'estoura')).status).toBe(429);

    await entrarComo(outro);
    const r = await comentar(id, 'comentário de quem não estourou');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});
