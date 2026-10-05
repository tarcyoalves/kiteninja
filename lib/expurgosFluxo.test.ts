/**
 * Expurgos preguiçosos, contra Postgres de verdade (T04 e T12 do plano).
 *
 * O que se prova aqui é o EFEITO NO BANCO, pelas rotas reais: dado vencido é
 * apagado, dado válido fica. Uma guarda de texto ("o arquivo contém
 * DELETE FROM ...") passaria com o filtro de validade removido — e um
 * DELETE sem filtro de validade apaga a posição de quem está na água agora.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

import {
  criarUsuario,
  db,
  ler,
  logarComo,
  prepararBanco,
  req,
  type UsuarioDeTeste,
} from '@/test/rotasComPglite';

beforeAll(prepararBanco, 60_000);

const expurgos = () => import('@/lib/expurgos');

let seqToken = 0;

/**
 * Sessão de apoio com datas relativas a agora, em horas. Positivo = no
 * futuro, negativo = no passado. `encerradoH` null = ainda aberta.
 */
async function sessaoApoio(userId: string, expiraH: number, encerradoH: number | null) {
  seqToken += 1;
  const r = await db.query<{ id: string }>(
    `INSERT INTO velejo_apoio_sessoes (user_id, token_hash, expira_em, encerrado_em)
     VALUES ($1, $2, NOW() + $3::int * INTERVAL '1 hour',
             CASE WHEN $4::int IS NULL THEN NULL ELSE NOW() + $4::int * INTERVAL '1 hour' END)
     RETURNING id`,
    [userId, `hash-de-teste-${seqToken}`, expiraH, encerradoH]
  );
  return r.rows[0].id;
}

async function comPosicoes(sessaoId: string, quantas = 3) {
  for (let i = 0; i < quantas; i++) {
    await db.query(
      `INSERT INTO velejo_apoio_posicoes (sessao_id, lat, lng) VALUES ($1, -3.7 , -38.5)`,
      [sessaoId]
    );
  }
  return sessaoId;
}

async function contar(sessaoId: string) {
  const r = await db.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM velejo_apoio_posicoes WHERE sessao_id = $1`,
    [sessaoId]
  );
  return r.rows[0].n;
}

describe('T04 — posições do link de apoio', () => {
  let velejador: UsuarioDeTeste;

  /** Um de cada situação, cada um com 3 posições. */
  async function cenario() {
    const dono = (await criarUsuario()).id;
    return {
      venceuHa25h: await comPosicoes(await sessaoApoio(dono, -25, null)),
      encerradaCedoHa25h: await comPosicoes(await sessaoApoio(dono, +10, -25)),
      venceuHa13h: await comPosicoes(await sessaoApoio(dono, -13, null)),
      encerradaHa2h: await comPosicoes(await sessaoApoio(dono, +10, -2)),
      ativa: await comPosicoes(await sessaoApoio(dono, +10, null)),
    };
  }

  beforeAll(async () => {
    velejador = await criarUsuario({ nome: 'Velejador do apoio' });
  });

  beforeEach(async () => {
    (await expurgos()).reiniciarExpurgos();
    await logarComo(velejador);
  });

  async function conferir(c: Awaited<ReturnType<typeof cenario>>) {
    expect(await contar(c.venceuHa25h), 'sessão vencida há 25 h').toBe(0);
    expect(await contar(c.encerradaCedoHa25h), 'encerrada há 25 h, com validade ainda pela frente').toBe(0);
    expect(await contar(c.venceuHa13h), 'vencida há 13 h: ainda dentro das 24 h de folga').toBe(3);
    expect(await contar(c.encerradaHa2h), 'encerrada há 2 h').toBe(3);
    expect(await contar(c.ativa), 'sessão ativa: é a posição de quem está na água').toBe(3);
  }

  it('ao abrir o link de apoio, apaga o vencido e mantém o válido', async () => {
    const c = await cenario();
    const { POST } = await import('@/app/api/velejo-apoio/route');
    const r = await ler(await POST());
    expect(r.status).toBe(200);
    await (await expurgos()).aguardarExpurgos();
    await conferir(c);
  });

  it('ao mandar posição, apaga o vencido, mantém o válido e guarda a posição nova', async () => {
    const { POST: abrir } = await import('@/app/api/velejo-apoio/route');
    await abrir();
    await (await expurgos()).aguardarExpurgos();

    const c = await cenario();
    (await expurgos()).reiniciarExpurgos();

    const { POST } = await import('@/app/api/velejo-apoio/posicoes/route');
    const r = await ler(await POST(req('POST', '/api/velejo-apoio/posicoes', { lat: -3.71, lng: -38.52 })));
    expect(r.status).toBe(200);
    await (await expurgos()).aguardarExpurgos();

    await conferir(c);
    const minhas = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM velejo_apoio_posicoes p
       JOIN velejo_apoio_sessoes s ON s.id = p.sessao_id
       WHERE s.user_id = $1 AND s.encerrado_em IS NULL`,
      [velejador.id]
    );
    expect(minhas.rows[0].n, 'a posição que acabou de chegar não pode ser apagada').toBeGreaterThanOrEqual(1);
  });

  it('no máximo uma vez por hora por instância: a segunda requisição não vai ao banco', async () => {
    const { POST } = await import('@/app/api/velejo-apoio/route');
    await POST();
    await (await expurgos()).aguardarExpurgos();

    // Algo venceu logo depois do primeiro expurgo. Dentro da mesma hora, não
    // é apagado: o custo no Neon é uma consulta por hora, não uma por requisição.
    const dono = (await criarUsuario()).id;
    const tardia = await comPosicoes(await sessaoApoio(dono, -30, null));
    await POST();
    await (await expurgos()).aguardarExpurgos();
    expect(await contar(tardia)).toBe(3);

    // Passada a hora (nova instância, para o teste), é apagado.
    (await expurgos()).reiniciarExpurgos();
    await POST();
    await (await expurgos()).aguardarExpurgos();
    expect(await contar(tardia)).toBe(0);
  });
});

describe('T12 — sessões de login vencidas', () => {
  /** Sessão de login com a validade relativa a agora, em minutos. */
  async function sessaoLogin(userId: string, expiraMin: number) {
    seqToken += 1;
    const r = await db.query<{ id: string }>(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + $3::int * INTERVAL '1 minute') RETURNING id`,
      [userId, `sessao-de-teste-${seqToken}`, expiraMin]
    );
    return r.rows[0].id;
  }

  async function existe(id: string) {
    const r = await db.query(`SELECT 1 FROM auth_sessions WHERE id = $1`, [id]);
    return r.rows.length === 1;
  }

  it('no login, apaga a sessão vencida e mantém a válida', async () => {
    const pessoa = await criarUsuario();
    const venceuAgora = await sessaoLogin(pessoa.id, -1);
    const venceuHaQuarentaDias = await sessaoLogin(pessoa.id, -40 * 24 * 60);
    const validaPorUmaHora = await sessaoLogin(pessoa.id, 60);
    const validaPorTrintaDias = await sessaoLogin(pessoa.id, 30 * 24 * 60);

    (await expurgos()).reiniciarExpurgos();
    const entrada = await logarComo(pessoa);
    expect(entrada.status).toBe(200);
    await (await expurgos()).aguardarExpurgos();

    expect(await existe(venceuAgora), 'venceu há 1 minuto').toBe(false);
    expect(await existe(venceuHaQuarentaDias), 'venceu há 40 dias').toBe(false);
    expect(await existe(validaPorUmaHora), 'ainda vale por 1 hora: é outro aparelho da mesma pessoa').toBe(true);
    expect(await existe(validaPorTrintaDias), 'ainda vale por 30 dias').toBe(true);

    // A sessão que o próprio login acabou de criar segue de pé: o expurgo roda
    // depois do INSERT e não pode derrubar quem acabou de entrar.
    const { GET } = await import('@/app/api/auth/me/route');
    const eu = await ler(await GET());
    expect(eu.status).toBe(200);
    expect(eu.body.user, 'quem acabou de entrar continua logado').not.toBeNull();
  });

  it('no máximo uma vez por hora por instância', async () => {
    const pessoa = await criarUsuario();
    (await expurgos()).reiniciarExpurgos();
    await logarComo(pessoa);
    await (await expurgos()).aguardarExpurgos();

    const venceuDepois = await sessaoLogin(pessoa.id, -5);
    await logarComo(pessoa);
    await (await expurgos()).aguardarExpurgos();
    expect(await existe(venceuDepois), 'dentro da mesma hora não vai ao banco de novo').toBe(true);

    (await expurgos()).reiniciarExpurgos();
    await logarComo(pessoa);
    await (await expurgos()).aguardarExpurgos();
    expect(await existe(venceuDepois)).toBe(false);
  });
});
