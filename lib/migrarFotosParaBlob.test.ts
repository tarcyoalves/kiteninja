/**
 * V01 — script de migração das fotos antigas, contra PGlite, sem rede.
 * O "Blob" aqui é uma função falsa que guarda o que recebeu.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

import { db, prepararBanco, sqlTag, type UsuarioDeTeste } from '@/test/rotasComPglite';
import { novaPessoa } from '@/test/entrarRapido';
import { lerDataUrl, migrarFotos, type SqlTag, type Subir } from '@/lib/migrarFotosParaBlob';

const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const SVG = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
const HTTPS = 'https://abc.public.blob.vercel-storage.com/relatos/ja-migrada.jpg';
const sql = sqlTag as unknown as SqlTag;

let u1: UsuarioDeTeste;
let u2: UsuarioDeTeste;
let idPostA: string;
let idPostB: string;
let idPostNovo: string;
let idListing: string;

async function coluna(tabela: string, col: string, id: string): Promise<string> {
  const r = await db.query<Record<string, string>>(`SELECT ${col} AS v FROM ${tabela} WHERE id = $1`, [id]);
  return r.rows[0].v;
}

function blobFalso() {
  const subidos: Array<{ pathname: string; bytes: number; contentType: string }> = [];
  const subir: Subir = async (pathname, corpo, contentType) => {
    subidos.push({ pathname, bytes: corpo.length, contentType });
    return `https://loja.public.blob.vercel-storage.com/${pathname}`;
  };
  return { subidos, subir };
}

beforeAll(async () => {
  await prepararBanco();
  u1 = await novaPessoa({ nome: 'Antiga 1' });
  u2 = await novaPessoa({ nome: 'Antiga 2' });
  await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [JPG, u1.id]);
  await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [HTTPS, u2.id]);
  const p = async (foto: string | null) =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO posts (user_id, title, content, photo_url) VALUES ($1, 't', 'c', $2) RETURNING id`,
        [u1.id, foto]
      )
    ).rows[0].id;
  idPostA = await p(JPG);
  idPostB = await p(PNG);
  idPostNovo = await p(HTTPS);
  await p(null);
  idListing = (
    await db.query<{ id: string }>(
      `INSERT INTO listings (user_id, title, description, category, condition, price_cents, city, state)
       VALUES ($1, 'Kite', 'Kite usado em bom estado', 'Kite', 'Usado', 100000, 'Natal', 'RN') RETURNING id`,
      [u1.id]
    )
  ).rows[0].id;
  await db.query(`INSERT INTO listing_photos (listing_id, data_url, position) VALUES ($1, $2, 0), ($1, $3, 1)`, [
    idListing,
    JPG,
    SVG,
  ]);
}, 60_000);

describe('lerDataUrl', () => {
  it('lê jpeg/png e recusa svg e lixo', () => {
    expect(lerDataUrl(JPG)?.extensao).toBe('jpg');
    expect(lerDataUrl(PNG)?.contentType).toBe('image/png');
    expect(lerDataUrl(SVG)).toBeNull();
    expect(lerDataUrl('data:image/jpeg;base64,')).toBeNull();
    expect(lerDataUrl('https://x.com/a.jpg')).toBeNull();
  });
});

describe('migrarFotos', () => {
  it('DRY-RUN: conta e soma o tamanho, e NÃO sobe nem altera nada', async () => {
    const { subidos, subir } = blobFalso();
    const r = await migrarFotos({ sql, aplicar: false, subir });
    const por = Object.fromEntries(r.map((x) => [x.tabela, x]));
    expect(por['posts.photo_url'].pendentes).toBe(2);
    expect(por['users.avatar_url'].pendentes).toBe(1);
    expect(por['listing_photos.data_url'].pendentes).toBe(2);
    expect(por['posts.photo_url'].bytes).toBe(JPG.length + PNG.length);
    expect(subidos).toHaveLength(0);
    expect(await coluna('posts', 'photo_url', idPostA)).toBe(JPG);
    expect(await coluna('users', 'avatar_url', u1.id)).toBe(JPG);
  });

  it('upload que FALHA deixa a linha intacta e não interrompe as outras', async () => {
    const { subir } = blobFalso();
    let n = 0;
    const quebraNaPrimeira: Subir = async (...a) => {
      n += 1;
      if (n === 1) throw new Error('Blob fora do ar');
      return subir(...a);
    };
    const r = await migrarFotos({ sql, aplicar: true, subir: quebraNaPrimeira, tamanhoLote: 1 });
    const falhas = r.reduce((a, x) => a + x.falhas, 0);
    expect(falhas).toBe(1);
    // A primeira tabela processada é posts; ordenado por id, uma das duas ficou.
    const restantes = (await db.query(`SELECT 1 FROM posts WHERE photo_url LIKE 'data:image/%'`)).rows.length;
    expect(restantes).toBe(1);
  });

  it('APLICAR: troca por URL https, ignora o que já é URL e o svg, e é idempotente', async () => {
    const { subidos, subir } = blobFalso();
    const r1 = await migrarFotos({ sql, aplicar: true, subir, tamanhoLote: 2 });
    expect(r1.reduce((a, x) => a + x.falhas, 0)).toBe(0);

    for (const id of [idPostA, idPostB]) {
      expect(await coluna('posts', 'photo_url', id)).toMatch(/^https:\/\/loja\.public\.blob\.vercel-storage\.com\/relatos\/migrado-/);
    }
    expect(await coluna('users', 'avatar_url', u1.id)).toMatch(/^https:\/\/.*\/avatares\/migrado-.*\.jpg$/);
    // Já era URL: intocada. Post novo também.
    expect(await coluna('users', 'avatar_url', u2.id)).toBe(HTTPS);
    expect(await coluna('posts', 'photo_url', idPostNovo)).toBe(HTTPS);
    // Anúncio: a jpeg migrou, o svg ficou onde estava (não migrável).
    const fotos = (
      await db.query<{ data_url: string }>('SELECT data_url FROM listing_photos WHERE listing_id = $1 ORDER BY position', [idListing])
    ).rows.map((x) => x.data_url);
    expect(fotos[0]).toMatch(/^https:\/\/.*\/anuncios\/migrado-/);
    expect(fotos[1]).toBe(SVG);
    expect(subidos.length).toBeGreaterThan(0);

    // Segunda rodada: nada novo para subir (só o svg, que é ignorado de novo).
    const de = blobFalso();
    const r2 = await migrarFotos({ sql, aplicar: true, subir: de.subir });
    expect(de.subidos).toHaveLength(0);
    expect(r2.reduce((a, x) => a + x.migradas, 0)).toBe(0);
  });

  it('não sobrescreve a foto que a pessoa trocou DURANTE a migração', async () => {
    await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [PNG, u2.id]);
    const NOVA = 'https://abc.public.blob.vercel-storage.com/avatares/nova-da-pessoa.jpg';
    const subirEnquantoTroca: Subir = async (pathname) => {
      // Entre ler a linha e gravar, a pessoa escolhe outra foto.
      await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [NOVA, u2.id]);
      return `https://loja.public.blob.vercel-storage.com/${pathname}`;
    };
    await migrarFotos({ sql, aplicar: true, subir: subirEnquantoTroca });
    expect(await coluna('users', 'avatar_url', u2.id)).toBe(NOVA);
  });
});

describe('teto de envios por execução (plano gratuito do Blob: 2.000 operações/mês)', () => {
  it('com `maximo: 2` sobe só 2 fotos e deixa o resto para a próxima rodada', async () => {
    for (let i = 0; i < 3; i++) {
      await db.query(`INSERT INTO posts (user_id, title, content, photo_url) VALUES ($1, 'teto', 'c', $2)`, [u2.id, JPG]);
    }
    const { subidos, subir } = blobFalso();
    await migrarFotos({ sql, aplicar: true, subir, maximo: 2 });
    expect(subidos.length).toBe(2);
    const restam = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM posts WHERE title = 'teto' AND photo_url LIKE 'data:image/%'`
    );
    expect(restam.rows[0].n).toBe(1);
  });
});
