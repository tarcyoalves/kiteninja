/**
 * T01 — a varredura da escalada do SOS não pode depender do GitHub Actions.
 *
 * Roda as rotas reais (`/api/sos/active`, `/api/cron/sos-escalada`,
 * `/api/admin/saude`) contra Postgres de verdade (PGlite com o schema de
 * produção). Guarda de código-fonte não prova que a varredura roda "no
 * máximo uma vez por minuto no app inteiro" — aqui o que se mede é o raio do
 * SOS no banco e as consultas que a rota faz.
 *
 * Como "o relógio anda" sem esperar: o teste recua `escalated_at` do SOS e a
 * linha da trava no banco. Sem a trava, o recuo de `escalated_at` faria o
 * segundo poll escalar de novo (15 -> 50 km) — é isso que a contraprova vê.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Consultas feitas pela rota, para provar que a checagem em memória NÃO vai ao
// banco (Neon gratuito: o polling de 12 s não pode virar escrita a cada poll).
const espiao = vi.hoisted(() => ({ consultas: [] as string[], falharVarredura: false }));
vi.mock('@/lib/db', async () => {
  const { sqlTag } = await import('@/test/rotasComPglite');
  return {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
      espiao.consultas.push(strings.join('?'));
      return sqlTag(strings, ...values);
    },
  };
});
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);

// `after()` só existe dentro de uma requisição do Next. Aqui ele guarda a
// tarefa para o teste rodar DEPOIS de a resposta voltar — o que também prova
// que a varredura não bloqueia o polling.
const adiadas = vi.hoisted(() => ({ tarefas: [] as Array<() => unknown> }));
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (fn: () => unknown) => void adiadas.tarefas.push(fn),
}));

// Falha injetada na varredura para provar que erro dela não derruba o polling.
vi.mock('@/lib/sosEscalada', async (original) => {
  const real = await original<typeof import('@/lib/sosEscalada')>();
  return {
    ...real,
    varrerEscaladas: (...args: Parameters<typeof real.varrerEscaladas>) =>
      espiao.falharVarredura ? Promise.reject(new Error('varredura explodiu de propósito')) : real.varrerEscaladas(...args),
  };
});

import {
  criarUsuario,
  db,
  ler,
  logarComo,
  prepararBanco,
  req,
  trocarPessoa,
  type UsuarioDeTeste,
} from '@/test/rotasComPglite';
import { CHAVE_ULTIMA_VARREDURA, reiniciarMemoriaDaInstancia } from '@/lib/sosVarredura';

let admin: UsuarioDeTeste;
let rider: UsuarioDeTeste; // quem faz o polling: NÃO tem nada a ver com o SOS
let vitima: UsuarioDeTeste;
let sosId: string;

beforeAll(async () => {
  await prepararBanco();
  admin = await criarUsuario({ role: 'admin', nome: 'Dono' });
  rider = await criarUsuario({ nome: 'Quem Faz Polling' });
  vitima = await criarUsuario({ nome: 'Velejador Em Apuros' });
}, 60_000);

beforeEach(async () => {
  reiniciarMemoriaDaInstancia();
  espiao.consultas.length = 0;
  espiao.falharVarredura = false;
  adiadas.tarefas.length = 0;
  process.env.CRON_SECRET = 'segredo-so-de-teste';
  // Estado limpo: nenhuma varredura registrada, um SOS aberto há 3 min, sem
  // ninguém a caminho. `rider` não é autor nem notificado — o laço por alerta
  // da rota nunca o enxerga; só a varredura global escala este SOS.
  await db.query(`DELETE FROM app_settings WHERE key = $1`, [CHAVE_ULTIMA_VARREDURA]);
  await db.query(`DELETE FROM sos_alerts`);
  const r = await db.query<{ id: string }>(
    `INSERT INTO sos_alerts (user_id, lat, lng, status, radius_km, created_at)
     VALUES ($1, -3.7, -38.5, 'ativo', 5, NOW() - INTERVAL '3 minutes') RETURNING id`,
    [vitima.id]
  );
  sosId = r.rows[0].id;
});

async function raio(): Promise<number> {
  const r = await db.query<{ radius_km: string }>(`SELECT radius_km FROM sos_alerts WHERE id = $1`, [sosId]);
  return Number(r.rows[0].radius_km);
}

/** Roda o que a rota deixou para depois da resposta. */
async function esvaziarDepoisDaResposta() {
  const tarefas = adiadas.tarefas.splice(0);
  await Promise.all(tarefas.map((t) => t()));
}

async function poll() {
  const { GET } = await import('@/app/api/sos/active/route');
  return ler(await GET());
}

/** Recua o relógio do SOS: como se passassem 3 min desde a última ampliação. */
const recuarEscalada = () =>
  db.query(`UPDATE sos_alerts SET escalated_at = NOW() - INTERVAL '3 minutes' WHERE id = $1`, [sosId]);

/** Recua a trava no banco: como se passassem `segundos` desde a última varredura. */
const recuarTrava = (segundos: number) =>
  db.query(
    `UPDATE app_settings SET updated_at = NOW() - ($2::int * INTERVAL '1 second') WHERE key = $1`,
    [CHAVE_ULTIMA_VARREDURA, segundos]
  );

describe('T01a — o polling de /api/sos/active puxa a varredura, no máximo 1x por minuto', () => {
  it('SOS de 3 min sem resposta: o polling de quem não tem nada com ele escala o raio UMA vez', async () => {
    await logarComo(rider);

    // Resposta primeiro, varredura depois: o raio ainda é 5 quando o polling responde.
    const r1 = await poll();
    expect(r1.status).toBe(200);
    expect(r1.body.alerts).toEqual([]); // rider não vê o SOS...
    expect(await raio()).toBe(5);
    expect(adiadas.tarefas.length).toBe(1);

    await esvaziarDepoisDaResposta();
    expect(await raio()).toBe(15); // ...mas a varredura global o escalou.

    // Segundo poll logo em seguida, mesmo com o relógio do SOS recuado (sem a
    // trava ele subiria de novo, 15 -> 50): o raio fica em 15.
    await recuarEscalada();
    await poll();
    await esvaziarDepoisDaResposta();
    expect(await raio()).toBe(15);
  });

  it('a trava vale entre instâncias: memória vazia (outra instância), mas o banco recusa', async () => {
    await logarComo(rider);
    await poll();
    await esvaziarDepoisDaResposta();
    expect(await raio()).toBe(15);

    await recuarEscalada();
    reiniciarMemoriaDaInstancia(); // outra instância da Vercel: não lembra de nada
    await poll();
    await esvaziarDepoisDaResposta();
    expect(await raio()).toBe(15); // quem decidiu foi a linha no banco
  });

  it('passada a janela de 60 s a trava abre de novo (não fica presa para sempre)', async () => {
    await logarComo(rider);
    await poll();
    await esvaziarDepoisDaResposta();
    expect(await raio()).toBe(15);

    await recuarEscalada();
    await recuarTrava(61);
    reiniciarMemoriaDaInstancia();
    await poll();
    await esvaziarDepoisDaResposta();
    expect(await raio()).toBe(50);
  });

  it('dentro da janela, a checagem em memória nem consulta o banco (Neon gratuito)', async () => {
    await logarComo(rider);
    await poll();
    await esvaziarDepoisDaResposta();

    espiao.consultas.length = 0;
    for (let i = 0; i < 5; i++) {
      await poll();
      await esvaziarDepoisDaResposta();
    }
    // Cinco polls seguidos: nenhuma consulta a app_settings. (As outras
    // consultas do poll — presença, lista de SOS — são as de sempre.)
    expect(espiao.consultas.filter((q) => q.includes('app_settings'))).toEqual([]);
  });

  it('erro na varredura não derruba o polling e vai para o painel de erros', async () => {
    await logarComo(rider);
    espiao.falharVarredura = true;

    const r = await poll();
    expect(r.status).toBe(200);
    await expect(esvaziarDepoisDaResposta()).resolves.toBeUndefined();

    const erros = await db.query<{ mensagem: string; rota: string }>(
      `SELECT mensagem, rota FROM erros_registrados WHERE mensagem LIKE '%varredura explodiu%'`
    );
    expect(erros.rows.length).toBe(1);
    expect(erros.rows[0].rota).toContain('/api/sos/active');
    expect(await raio()).toBe(5); // a varredura de fato não rodou
  });
});

describe('T01a/T01c — a rota de cron anota a última varredura', () => {
  const chamarCron = async (autorizacao?: string) => {
    const { GET } = await import('@/app/api/cron/sos-escalada/route');
    const pedido = new Request('https://kiteninja.vercel.app/api/cron/sos-escalada', {
      headers: autorizacao ? { authorization: autorizacao } : {},
    });
    return ler(await GET(pedido));
  };
  const linha = async () => {
    const r = await db.query<{ value: Record<string, unknown>; segundos: string }>(
      `SELECT value, EXTRACT(EPOCH FROM (NOW() - updated_at)) AS segundos FROM app_settings WHERE key = $1`,
      [CHAVE_ULTIMA_VARREDURA]
    );
    return r.rows[0];
  };

  it('com o segredo certo: varre, escala e atualiza a "última varredura" (origem cron)', async () => {
    // Estado antigo: a última varredura foi há 1 hora, por outra fonte.
    await db.query(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ($1, '{"origem":"polling","fase":"concluida"}'::jsonb, NOW() - INTERVAL '1 hour')`,
      [CHAVE_ULTIMA_VARREDURA]
    );
    expect(Number((await linha()).segundos)).toBeGreaterThan(3000);

    const r = await chamarCron('Bearer segredo-so-de-teste');
    expect(r.status).toBe(200);
    expect(r.body.escalados).toBe(1);
    expect(await raio()).toBe(15);

    const depois = await linha();
    expect(Number(depois.segundos)).toBeLessThan(30);
    expect(depois.value.origem).toBe('cron');
    expect(depois.value.fase).toBe('concluida');
    expect(depois.value.examinados).toBe(1);
  });

  it('sem segredo ou com segredo errado: 401 e a última varredura NÃO é tocada', async () => {
    expect((await chamarCron()).status).toBe(401);
    expect((await chamarCron('Bearer errado')).status).toBe(401);
    expect(await linha()).toBeUndefined();
    expect(await raio()).toBe(5);
  });

  it('o cron também segura o polling: acabou de varrer, o poll não varre de novo', async () => {
    await chamarCron('Bearer segredo-so-de-teste');
    expect(await raio()).toBe(15);

    await logarComo(rider);
    await recuarEscalada();
    reiniciarMemoriaDaInstancia();
    await poll();
    await esvaziarDepoisDaResposta();
    expect(await raio()).toBe(15);
  });
});

describe('T01c — /api/admin/saude', () => {
  const saude = async () => {
    const { GET } = await import('@/app/api/admin/saude/route');
    return ler(await GET());
  };
  const varredura = (corpo: Record<string, unknown>) => corpo.sosVarredura as Record<string, unknown>;

  it('anônimo recebe 401 e velejador comum recebe 403', async () => {
    trocarPessoa();
    expect((await saude()).status).toBe(401);
    await logarComo(rider);
    expect((await saude()).status).toBe(403);
  });

  it('admin lê o horário; fica "parada" acima de 10 min; nunca registrada também é parada', async () => {
    await logarComo(admin);

    // Nunca houve varredura.
    let r = await saude();
    expect(r.status).toBe(200);
    expect(varredura(r.body).em).toBeNull();
    expect(varredura(r.body).parada).toBe(true);

    // Cron acabou de rodar.
    const { GET } = await import('@/app/api/cron/sos-escalada/route');
    await GET(new Request('https://kiteninja.vercel.app/api/cron/sos-escalada', {
      headers: { authorization: 'Bearer segredo-so-de-teste' },
    }));
    r = await saude();
    expect(varredura(r.body).origem).toBe('cron');
    expect(varredura(r.body).segundosAtras as number).toBeLessThan(30);
    expect(typeof varredura(r.body).em).toBe('string');
    expect(varredura(r.body).parada).toBe(false);

    // 9 min: ainda verde. 11 min: vermelho.
    await recuarTrava(9 * 60);
    expect(varredura((await saude()).body).parada).toBe(false);
    await recuarTrava(11 * 60);
    r = await saude();
    expect(varredura(r.body).parada).toBe(true);
    expect(varredura(r.body).segundosAtras as number).toBeGreaterThan(10 * 60);
  });
});
