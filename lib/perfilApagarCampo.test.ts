/**
 * V02 — PATCH /api/profile: "não enviado" mantém, "enviado vazio" apaga.
 *
 * Antes: COALESCE(valor || null, coluna) — vazio virava NULL e o COALESCE
 * devolvia o valor antigo, então bio, spot de casa e contato de emergência
 * nunca mais podiam ser removidos.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

import { db, ler, prepararBanco, req, type UsuarioDeTeste } from '@/test/rotasComPglite';
import { entrarComo, novaPessoa } from '@/test/entrarRapido';

let eu: UsuarioDeTeste;

beforeAll(async () => {
  await prepararBanco();
  eu = await novaPessoa({ nome: 'Pessoa do Perfil' });
}, 60_000);

const PREENCHIDO = {
  bio: 'Kiteiro desde 2015',
  homeSpot: 'Cumbuco',
  emergencyContactName: 'Maria',
  emergencyContactPhone: '85999990000',
};

async function patch(corpo: Record<string, unknown>) {
  await entrarComo(eu);
  const { PATCH } = await import('@/app/api/profile/route');
  return ler(await PATCH(req('PATCH', '/api/profile', corpo)));
}

async function perfil() {
  const r = await db.query<Record<string, string | null>>(
    'SELECT name, bio, home_spot, emergency_contact_name AS ecn, emergency_contact_phone AS ecp, weight_kg FROM users WHERE id = $1',
    [eu.id]
  );
  return r.rows[0];
}

async function preencher() {
  const r = await patch(PREENCHIDO);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

describe('PATCH /api/profile — apagar campos de texto opcionais', () => {
  it('enviar bio vazia APAGA a bio', async () => {
    await preencher();
    const r = await patch({ bio: '' });
    expect(r.status).toBe(200);
    const p = await perfil();
    expect(p.bio).toBeNull();
    // Os outros campos não foram mandados: continuam.
    expect(p.home_spot).toBe('Cumbuco');
    expect(p.ecn).toBe('Maria');
  });

  it('enviar o spot de casa vazio APAGA o spot de casa', async () => {
    await preencher();
    expect((await patch({ homeSpot: '   ' })).status).toBe(200);
    const p = await perfil();
    expect(p.home_spot).toBeNull();
    expect(p.bio).toBe(PREENCHIDO.bio);
  });

  it('o formulário do contato de emergência (manda os dois vazios) APAGA o contato', async () => {
    await preencher();
    const r = await patch({ emergencyContactName: '', emergencyContactPhone: '' });
    expect(r.status).toBe(200);
    const p = await perfil();
    expect(p.ecn).toBeNull();
    expect(p.ecp).toBeNull();
  });

  it('apagar só o telefone mantém o nome do contato', async () => {
    await preencher();
    await patch({ emergencyContactPhone: '' });
    const p = await perfil();
    expect(p.ecp).toBeNull();
    expect(p.ecn).toBe('Maria');
  });

  it('PATCH que NÃO manda os campos (ex.: só o peso) não apaga nada', async () => {
    await preencher();
    const r = await patch({ weightKg: 72 });
    expect(r.status).toBe(200);
    const p = await perfil();
    expect(Number(p.weight_kg)).toBe(72);
    expect(p.bio).toBe(PREENCHIDO.bio);
    expect(p.home_spot).toBe('Cumbuco');
    expect(p.ecn).toBe('Maria');
    expect(p.ecp).toBe('85999990000');
  });

  it('campo enviado como null ou undefined não conta como "apagar"', async () => {
    await preencher();
    await patch({ bio: null, homeSpot: undefined, emergencyContactName: null });
    const p = await perfil();
    expect(p.bio).toBe(PREENCHIDO.bio);
    expect(p.home_spot).toBe('Cumbuco');
    expect(p.ecn).toBe('Maria');
  });

  it('enviar valor novo continua substituindo', async () => {
    await preencher();
    await patch({ bio: 'Nova bio', emergencyContactName: 'João' });
    const p = await perfil();
    expect(p.bio).toBe('Nova bio');
    expect(p.ecn).toBe('João');
  });

  it('o NOME nunca fica vazio: enviar vazio é recusado e o nome fica', async () => {
    const r = await patch({ name: '   ' });
    expect(r.status).toBe(400);
    expect((await patch({ name: '' })).status).toBe(400);
    expect((await perfil()).name).toBe('Pessoa do Perfil');
  });
});
