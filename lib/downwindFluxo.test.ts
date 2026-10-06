/**
 * Downwind de ponta a ponta pelas ROTAS, contra Postgres de verdade (T13,
 * fluxo 2): criar, entrar, espectador, iniciar, posição, encerrar, cancelar.
 *
 * Downwind é rastreamento de pessoas na água. As regras de acesso têm teste
 * puro (lib/downwindAcesso.test.ts, lib/downwind.test.ts), mas o que decide se
 * alguém é esquecido no mar ou vigiado em casa é o CAMINHO: a rota carregou a
 * participação certa? o SQL do mapa filtrou o espectador? o quórum olhou a
 * lista inteira? É isso que estes testes exercitam.
 *
 * Regras que machucam se quebrarem (cada uma tem teste e contraprova):
 *  - espectador não entra no quórum de encerramento, não transmite posição e
 *    não aparece como marcador no mapa;
 *  - só o organizador (ou moderação) encerra e cancela;
 *  - o downwind não encerra com velejador ainda na água;
 *  - quem não participa recebe 404 (não confirma que o downwind existe).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', async () => (await import('@/test/rotasComPglite')).dbMock);
vi.mock('next/headers', async () => (await import('@/test/rotasComPglite')).headersMock);
// Push nunca sai do teste (aviso de início aos seguidores, FCM do encerramento).
vi.mock('@/lib/push', async (original) => ({
  ...(await original<typeof import('@/lib/push')>()),
  sendPushToUsers: async () => undefined,
  sendPushToUser: async () => undefined,
  sendFcmToUser: async () => undefined,
}));

import { db, ler, params, prepararBanco, req, trocarPessoa, type UsuarioDeTeste } from '@/test/rotasComPglite';
import { entrarComo, novaPessoa } from '@/test/entrarRapido';

const SAIDA = 't13-dw-saida';
const CHEGADA = 't13-dw-chegada';

beforeAll(async () => {
  await prepararBanco();
  await db.query(
    `INSERT INTO spots (id, name, location, state, lat, lng, wind_safety, water_condition, bottom_type, difficulty, cover_image)
     VALUES ($1, 'Saída T13', 'Icaraizinho / CE', 'CE', -3.0, -39.0, 'a', 'a', 'a', 'a', 'x'),
            ($2, 'Chegada T13', 'Camocim / CE', 'CE', -2.9, -40.8, 'a', 'a', 'a', 'a', 'x')`,
    [SAIDA, CHEGADA]
  );
}, 60_000);

beforeEach(() => {
  trocarPessoa();
});

// --------------------------------------------------------------- helpers ----

const rotas = {
  raiz: () => import('@/app/api/downwind/route'),
  entrar: () => import('@/app/api/downwind/[id]/entrar/route'),
  status: () => import('@/app/api/downwind/[id]/status/route'),
  posicoes: () => import('@/app/api/downwind/[id]/posicoes/route'),
  participante: () => import('@/app/api/downwind/[id]/participantes/[userId]/route'),
};

async function criar(org: UsuarioDeTeste, corpo: Record<string, unknown> = {}) {
  await entrarComo(org);
  const { POST } = await rotas.raiz();
  return ler(
    await POST(
      req('POST', '/api/downwind', { nome: 'Travessia de teste', spotSaida: SAIDA, spotChegada: CHEGADA, ...corpo })
    )
  );
}

async function entrar(quem: UsuarioDeTeste, id: string, corpo?: Record<string, unknown>) {
  await entrarComo(quem);
  const { POST } = await rotas.entrar();
  return ler(await POST(req('POST', `/api/downwind/${id}/entrar`, corpo), params({ id })));
}

async function mudarStatus(quem: UsuarioDeTeste | null, id: string, para: string) {
  if (quem) await entrarComo(quem);
  else trocarPessoa();
  const { POST } = await rotas.status();
  return ler(await POST(req('POST', `/api/downwind/${id}/status`, { para }), params({ id })));
}

async function reportar(quem: UsuarioDeTeste | null, id: string, corpo: Record<string, unknown>) {
  if (quem) await entrarComo(quem);
  else trocarPessoa();
  const { POST } = await rotas.posicoes();
  return ler(await POST(req('POST', `/api/downwind/${id}/posicoes`, corpo), params({ id })));
}

async function mapa(quem: UsuarioDeTeste, id: string) {
  await entrarComo(quem);
  const { GET } = await rotas.posicoes();
  return ler(await GET(req('GET', `/api/downwind/${id}/posicoes`), params({ id })));
}

async function mudarParticipante(quem: UsuarioDeTeste, id: string, alvo: UsuarioDeTeste, corpo: Record<string, unknown>) {
  await entrarComo(quem);
  const { PATCH } = await rotas.participante();
  return ler(
    await PATCH(
      req('PATCH', `/api/downwind/${id}/participantes/${alvo.id}`, corpo),
      params({ id, userId: alvo.id })
    )
  );
}

async function estadoDe(id: string, u: UsuarioDeTeste) {
  const r = await db.query<{ estado: string; papel: string }>(
    `SELECT estado, papel FROM downwind_participantes WHERE downwind_id = $1 AND user_id = $2`,
    [id, u.id]
  );
  return r.rows[0] ?? null;
}

async function statusDe(id: string) {
  return (await db.query<{ status: string }>(`SELECT status FROM downwinds WHERE id = $1`, [id])).rows[0].status;
}

async function posicoesGravadas(id: string, u: UsuarioDeTeste) {
  return (await db.query(`SELECT 1 FROM downwind_posicoes WHERE downwind_id = $1 AND user_id = $2`, [id, u.id])).rows.length;
}

interface Cenario {
  id: string;
  org: UsuarioDeTeste;
  velejador: UsuarioDeTeste;
  apoio: UsuarioDeTeste;
  espectador: UsuarioDeTeste;
  estranho: UsuarioDeTeste;
}

/** Downwind aberto com organizador, um velejador, um apoio em terra, um espectador e um estranho. */
async function montar(corpo: Record<string, unknown> = {}): Promise<Cenario> {
  const org = await novaPessoa({ nome: 'Organizador' });
  const velejador = await novaPessoa({ nome: 'Velejador' });
  const apoio = await novaPessoa({ nome: 'Apoio' });
  const espectador = await novaPessoa({ nome: 'Espectador' });
  const estranho = await novaPessoa({ nome: 'Estranho' });
  const c = await criar(org, corpo);
  expect(c.status, JSON.stringify(c.body)).toBe(200);
  const id = String(c.body.id);
  for (const [u, papel] of [
    [velejador, 'velejador'],
    [apoio, 'apoio_terra'],
    [espectador, 'espectador'],
  ] as const) {
    const r = await entrar(u, id, { papel });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
  return { id, org, velejador, apoio, espectador, estranho };
}

/** Começa a travessia (o organizador toca "Iniciar") e põe o velejador na água. */
async function iniciar(c: Cenario) {
  const r = await mudarStatus(c.org, c.id, 'em_andamento');
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await db.query(`UPDATE downwind_participantes SET estado = 'navegando' WHERE downwind_id = $1 AND user_id = $2`, [c.id, c.velejador.id]);
}

const PONTO = { lat: -3.0, lng: -39.1, accuracyM: 8 };

// ---------------------------------------------------------------------------

describe('downwind — criar e listar', () => {
  it('anônimo não cria (401)', async () => {
    trocarPessoa();
    const { POST } = await rotas.raiz();
    const r = await ler(await POST(req('POST', '/api/downwind', { nome: 'Sem login', spotSaida: SAIDA })));
    expect(r.status).toBe(401);
  });

  it('criar: nasce "aberto" e PRIVADO, o criador vira organizador-velejador e o evento é criado', async () => {
    const org = await novaPessoa();
    const r = await criar(org);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const id = String(r.body.id);
    expect(r.body.status).toBe('aberto');
    expect(r.body.visibilidade).toBe('privado');

    const p = await db.query<{ papel: string; eh_organizador: boolean; estado: string }>(
      `SELECT papel, eh_organizador, estado FROM downwind_participantes WHERE downwind_id = $1 AND user_id = $2`,
      [id, org.id]
    );
    expect(p.rows).toEqual([{ papel: 'velejador', eh_organizador: true, estado: 'confirmado' }]);
    const ev = await db.query<{ type: string }>(`SELECT type FROM events WHERE id = $1`, [r.body.eventId]);
    expect(ev.rows[0].type).toBe('Downwind');
  });

  it('entrada inválida é 400: spot de saída que não existe e nome curto', async () => {
    const org = await novaPessoa();
    expect((await criar(org, { spotSaida: 'spot-que-nao-existe' })).status).toBe(400);
    expect((await criar(org, { nome: 'ab' })).status).toBe(400);
    expect((await criar(org, { visibilidade: 'publico-total' })).status).toBe(400);
    // Nada ficou pela metade no banco.
    const n = await db.query(`SELECT 1 FROM downwinds WHERE criado_por = $1`, [org.id]);
    expect(n.rows).toHaveLength(0);
  });

  it('a lista mostra o privado só a criador e participantes; o da comunidade, a todos', async () => {
    const org = await novaPessoa();
    const participante = await novaPessoa();
    const estranho = await novaPessoa();
    const priv = String((await criar(org, { nome: 'Privado T13' })).body.id);
    const pub = String((await criar(org, { nome: 'Comunidade T13', visibilidade: 'comunidade' })).body.id);
    await entrar(participante, priv);

    const { GET } = await rotas.raiz();
    const ver = async (u: UsuarioDeTeste) => {
      await entrarComo(u);
      const r = await ler(await GET());
      return ((r.body.downwinds as Array<{ id: string }>) ?? []).map((d) => d.id);
    };
    expect(await ver(org)).toEqual(expect.arrayContaining([priv, pub]));
    expect(await ver(participante)).toEqual(expect.arrayContaining([priv, pub]));
    const doEstranho = await ver(estranho);
    expect(doEstranho).toContain(pub);
    expect(doEstranho).not.toContain(priv);
  });
});

// ---------------------------------------------------------------------------

describe('downwind — entrar e espectador', () => {
  it('entrar é idempotente e o papel pedido vale: velejador, apoio em terra e espectador', async () => {
    const c = await montar();
    expect((await estadoDe(c.id, c.velejador))?.papel).toBe('velejador');
    expect((await estadoDe(c.id, c.apoio))?.papel).toBe('apoio_terra');
    expect((await estadoDe(c.id, c.espectador))?.papel).toBe('espectador');

    const de_novo = await entrar(c.velejador, c.id);
    expect(de_novo.status).toBe(200);
    const n = await db.query(`SELECT 1 FROM downwind_participantes WHERE downwind_id = $1 AND user_id = $2`, [c.id, c.velejador.id]);
    expect(n.rows).toHaveLength(1);
  });

  it('papel desconhecido é 400; id malformado ou inexistente é 404 (nunca 500)', async () => {
    const c = await montar();
    expect((await entrar(c.estranho, c.id, { papel: 'capitao' })).status).toBe(400);
    expect((await entrar(c.estranho, 'nao-e-uuid')).status).toBe(404);
    expect((await entrar(c.estranho, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('quem está NAVEGANDO não vira espectador por um toque errado (409) — senão sai do quórum e some do mapa', async () => {
    const c = await montar();
    await iniciar(c);
    const r = await entrar(c.velejador, c.id, { papel: 'espectador' });
    expect(r.status).toBe(409);
    expect((await estadoDe(c.id, c.velejador))).toEqual({ estado: 'navegando', papel: 'velejador' });
  });

  it('uma travessia por vez: com outra em andamento a entrada é recusada (409) e nomeia a que trava', async () => {
    const a = await montar({ nome: 'Travessia A' });
    await iniciar(a);
    const b = await montar({ nome: 'Travessia B' });
    const r = await entrar(a.velejador, b.id);
    expect(r.status).toBe(409);
    expect(String(r.body.error)).toContain('Travessia A');
    expect(await estadoDe(b.id, a.velejador)).toBeNull();
  });

  it('espectador de uma travessia em andamento não é impedido de entrar em outra', async () => {
    const a = await montar({ nome: 'Travessia C' });
    await iniciar(a);
    const b = await montar({ nome: 'Travessia D' });
    expect((await entrar(a.espectador, b.id)).status).toBe(200);
  });

  it('downwind encerrado ou cancelado não aceita entrada (409)', async () => {
    const c = await montar();
    await mudarStatus(c.org, c.id, 'cancelado');
    expect((await entrar(c.estranho, c.id)).status).toBe(409);
  });

  /*
   * POSSÍVEL DEFEITO DE PRODUÇÃO (não corrigido — T13 só cria testes): a rota
   * de entrada não olha `visibilidade`. Quem tem o UUID de um downwind PRIVADO
   * entra nele como velejador e passa a ver o mapa ao vivo com a posição de
   * todos. lib/downwindAcesso.ts (podeVerReplayAoVivo) diz que "UUID não é
   * segredo: aparece em link compartilhado, histórico, print" e que privado é
   * "restrito a quem participa" — mas participar é autoatendimento. O teste
   * descreve o comportamento DESEJADO e hoje falha; quando o dono decidir (o
   * convite por link/usuário existe justamente para entrar em privado), troque
   * `it.fails` por `it`.
   */
  it.fails('DEFEITO?: quem tem só o id de um downwind PRIVADO não entra nele sozinho', async () => {
    const c = await montar(); // privado por padrão
    const intruso = await novaPessoa({ nome: 'Intruso Com O UUID' });
    await iniciar(c);
    await reportar(c.velejador, c.id, PONTO);
    const r = await entrar(intruso, c.id);
    // Medido ao escrever o teste: hoje a entrada responde 200 e o GET do mapa
    // logo depois também (200) — o intruso já enxerga a posição de quem está
    // na água.
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await estadoDe(c.id, intruso)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('downwind — iniciar', () => {
  it('velejador inicia: vira "em_andamento", ganha iniciado_em e o próprio vira "navegando"', async () => {
    const c = await montar();
    const r = await mudarStatus(c.velejador, c.id, 'em_andamento');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await statusDe(c.id)).toBe('em_andamento');
    const d = await db.query<{ iniciado_em: string | null }>(`SELECT iniciado_em FROM downwinds WHERE id = $1`, [c.id]);
    expect(d.rows[0].iniciado_em).not.toBeNull();
    expect((await estadoDe(c.id, c.velejador))?.estado).toBe('navegando');
  });

  it('segundo toque em "Iniciar" é no-op (200) e não muda o iniciado_em', async () => {
    const c = await montar();
    await mudarStatus(c.org, c.id, 'em_andamento');
    const antes = (await db.query<{ iniciado_em: string }>(`SELECT iniciado_em FROM downwinds WHERE id = $1`, [c.id])).rows[0].iniciado_em;
    const r = await mudarStatus(c.velejador, c.id, 'em_andamento');
    expect(r.status).toBe(200);
    const depois = (await db.query<{ iniciado_em: string }>(`SELECT iniciado_em FROM downwinds WHERE id = $1`, [c.id])).rows[0].iniciado_em;
    expect(new Date(depois).getTime()).toBe(new Date(antes).getTime());
  });

  it('apoio em terra e espectador NÃO iniciam (403); estranho recebe 404; anônimo 401; nada muda', async () => {
    const c = await montar();
    expect((await mudarStatus(c.apoio, c.id, 'em_andamento')).status).toBe(403);
    expect((await mudarStatus(c.espectador, c.id, 'em_andamento')).status).toBe(403);
    expect((await mudarStatus(c.estranho, c.id, 'em_andamento')).status).toBe(404);
    expect((await mudarStatus(null, c.id, 'em_andamento')).status).toBe(401);
    expect(await statusDe(c.id)).toBe('aberto');
  });

  it('downwind cancelado não inicia (409)', async () => {
    const c = await montar();
    await mudarStatus(c.org, c.id, 'cancelado');
    expect((await mudarStatus(c.velejador, c.id, 'em_andamento')).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------

describe('downwind — posição: quem transmite e quem aparece', () => {
  it('velejador na água grava posição; o ponto vai para o banco', async () => {
    const c = await montar();
    await iniciar(c);
    const r = await reportar(c.velejador, c.id, PONTO);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await posicoesGravadas(c.id, c.velejador)).toBe(1);
  });

  it('ESPECTADOR não transmite posição: 403 e NADA é gravado', async () => {
    const c = await montar();
    await iniciar(c);
    const r = await reportar(c.espectador, c.id, PONTO);
    expect(r.status).toBe(403);
    expect(await posicoesGravadas(c.id, c.espectador)).toBe(0);
  });

  it('só reporta com o downwind em andamento (aberto = 409), e só quem participa (estranho 404, anônimo 401)', async () => {
    const c = await montar();
    expect((await reportar(c.velejador, c.id, PONTO)).status).toBe(409);
    await iniciar(c);
    expect((await reportar(c.estranho, c.id, PONTO)).status).toBe(404);
    expect((await reportar(null, c.id, PONTO)).status).toBe(401);
    expect(await posicoesGravadas(c.id, c.estranho)).toBe(0);
  });

  it('quem já saiu da água (encerrou a própria participação) não reporta mais (409)', async () => {
    const c = await montar();
    await iniciar(c);
    await db.query(`UPDATE downwind_participantes SET estado = 'encerrado' WHERE downwind_id = $1 AND user_id = $2`, [c.id, c.velejador.id]);
    expect((await reportar(c.velejador, c.id, PONTO)).status).toBe(409);
  });

  it('coordenada impossível é 400', async () => {
    const c = await montar();
    await iniciar(c);
    expect((await reportar(c.velejador, c.id, { lat: 999, lng: 0 })).status).toBe(400);
    expect(await posicoesGravadas(c.id, c.velejador)).toBe(0);
  });

  it('o mapa: velejadores e apoio aparecem; o ESPECTADOR não é marcador nem entra na lista', async () => {
    const c = await montar();
    await iniciar(c);
    await reportar(c.velejador, c.id, PONTO);
    const r = await mapa(c.org, c.id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const lista = r.body.participantes as Array<{ userId: string; lat: number | null }>;
    const ids = lista.map((p) => p.userId);
    expect(ids).toEqual(expect.arrayContaining([c.org.id, c.velejador.id, c.apoio.id]));
    expect(ids).not.toContain(c.espectador.id);
    const dele = lista.find((p) => p.userId === c.velejador.id)!;
    expect(dele.lat).toBeCloseTo(PONTO.lat, 4);
  });

  it('o espectador acompanha o mapa (200) mas só o dos outros — e a posição de quem saiu da água não é servida', async () => {
    const c = await montar();
    await iniciar(c);
    await reportar(c.velejador, c.id, PONTO);
    expect((await mapa(c.espectador, c.id)).status).toBe(200);

    await db.query(`UPDATE downwind_participantes SET estado = 'encerrado' WHERE downwind_id = $1 AND user_id = $2`, [c.id, c.velejador.id]);
    const r = await mapa(c.org, c.id);
    const dele = (r.body.participantes as Array<{ userId: string; lat: number | null; lng: number | null }>).find(
      (p) => p.userId === c.velejador.id
    )!;
    expect(dele.lat).toBeNull();
    expect(dele.lng).toBeNull();
  });

  it('quem não participa recebe 404 no mapa — e moderação NÃO ganha acesso à posição por ser moderação', async () => {
    const c = await montar();
    await iniciar(c);
    await reportar(c.velejador, c.id, PONTO);
    expect((await mapa(c.estranho, c.id)).status).toBe(404);
    const mod = await novaPessoa({ role: 'moderator' });
    expect((await mapa(mod, c.id)).status).toBe(404);
    // Mesma resposta de um downwind que não existe: não confirma existência.
    const inexistente = await mapa(c.estranho, '00000000-0000-4000-8000-000000000000');
    expect(inexistente.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------

describe('downwind — encerrar: quórum e quem pode', () => {
  it('com velejador ainda NA ÁGUA o downwind não encerra (409), nem para o organizador', async () => {
    const c = await montar();
    await iniciar(c);
    const r = await mudarStatus(c.org, c.id, 'encerrado');
    expect(r.status).toBe(409);
    expect(await statusDe(c.id)).toBe('em_andamento');
  });

  it('o ESPECTADOR e o apoio em terra não entram no quórum: encerra quando só os VELEJADORES saíram', async () => {
    const c = await montar();
    await iniciar(c);
    await db.query(
      `UPDATE downwind_participantes SET estado = 'encerrado' WHERE downwind_id = $1 AND papel = 'velejador'`,
      [c.id]
    );
    // espectador e apoio seguem "confirmado".
    expect((await estadoDe(c.id, c.espectador))?.estado).toBe('confirmado');
    expect((await estadoDe(c.id, c.apoio))?.estado).toBe('confirmado');

    const r = await mudarStatus(c.org, c.id, 'encerrado');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await statusDe(c.id)).toBe('encerrado');
  });

  it('só o organizador encerra: participante comum, apoio e espectador levam 403; estranho 404; anônimo 401', async () => {
    const c = await montar();
    await iniciar(c);
    await db.query(`UPDATE downwind_participantes SET estado = 'encerrado' WHERE downwind_id = $1 AND papel = 'velejador'`, [c.id]);
    for (const quem of [c.velejador, c.apoio, c.espectador]) {
      expect((await mudarStatus(quem, c.id, 'encerrado')).status).toBe(403);
    }
    expect((await mudarStatus(c.estranho, c.id, 'encerrado')).status).toBe(404);
    expect((await mudarStatus(null, c.id, 'encerrado')).status).toBe(401);
    expect(await statusDe(c.id)).toBe('em_andamento');
  });

  it('moderação encerra um downwind travado (sem ser participante), desde que o quórum feche', async () => {
    const c = await montar();
    await iniciar(c);
    await db.query(`UPDATE downwind_participantes SET estado = 'encerrado' WHERE downwind_id = $1 AND papel = 'velejador'`, [c.id]);
    const mod = await novaPessoa({ role: 'moderator' });
    const r = await mudarStatus(mod, c.id, 'encerrado');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await statusDe(c.id)).toBe('encerrado');
  });

  it('encerrar grava o resumo da travessia (distância) e depois disso o downwind não aceita mais posição', async () => {
    const c = await montar();
    await iniciar(c);
    await reportar(c.velejador, c.id, { lat: -3.0, lng: -39.0 });
    await db.query(`UPDATE downwind_posicoes SET registrado_em = NOW() - INTERVAL '10 minutes' WHERE downwind_id = $1`, [c.id]);
    await reportar(c.velejador, c.id, { lat: -3.0, lng: -39.09 });
    await db.query(`UPDATE downwind_participantes SET estado = 'encerrado' WHERE downwind_id = $1 AND papel = 'velejador'`, [c.id]);

    expect((await mudarStatus(c.org, c.id, 'encerrado')).status).toBe(200);
    const resumo = await db.query<{ distancia_km: string | null }>(
      `SELECT distancia_km FROM downwind_participantes WHERE downwind_id = $1 AND user_id = $2`,
      [c.id, c.velejador.id]
    );
    expect(Number(resumo.rows[0].distancia_km)).toBeGreaterThan(5);

    expect((await reportar(c.velejador, c.id, PONTO)).status).toBe(409);
    expect((await mudarStatus(c.org, c.id, 'encerrado')).status).toBe(409);
  });

  it('o ÚLTIMO velejador a encerrar a própria participação fecha o downwind sozinho — espectador "confirmado" não segura', async () => {
    const c = await montar();
    await iniciar(c);
    // O organizador também é velejador: sai primeiro, o downwind segue aberto.
    await db.query(`UPDATE downwind_participantes SET estado = 'navegando' WHERE downwind_id = $1 AND user_id = $2`, [c.id, c.org.id]);
    expect((await mudarParticipante(c.org, c.id, c.org, { estado: 'encerrado' })).status).toBe(200);
    expect(await statusDe(c.id)).toBe('em_andamento');

    expect((await mudarParticipante(c.velejador, c.id, c.velejador, { estado: 'encerrado' })).status).toBe(200);
    expect(await statusDe(c.id)).toBe('encerrado');
  });

  it('participante comum não muda o estado de OUTRO (403); o organizador só pode marcar terceiro como "encerrado"', async () => {
    const c = await montar();
    await iniciar(c);
    expect((await mudarParticipante(c.apoio, c.id, c.velejador, { estado: 'encerrado' })).status).toBe(403);
    expect((await estadoDe(c.id, c.velejador))?.estado).toBe('navegando');

    expect((await mudarParticipante(c.org, c.id, c.velejador, { estado: 'desistiu' })).status).toBe(403);
    expect((await mudarParticipante(c.org, c.id, c.velejador, { estado: 'encerrado' })).status).toBe(200);
    expect((await estadoDe(c.id, c.velejador))?.estado).toBe('encerrado');
  });
});

// ---------------------------------------------------------------------------

describe('downwind — cancelar', () => {
  it('o organizador cancela antes de sair da praia (sem quórum) e o downwind deixa de aceitar gente e posição', async () => {
    const c = await montar();
    const r = await mudarStatus(c.org, c.id, 'cancelado');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await statusDe(c.id)).toBe('cancelado');
    expect((await entrar(c.estranho, c.id)).status).toBe(409);
    expect((await reportar(c.velejador, c.id, PONTO)).status).toBe(409);
  });

  it('cancelar em andamento, com velejador ainda "navegando", funciona e GUARDA o resumo antes de a trilha ser purgada', async () => {
    const c = await montar();
    await iniciar(c);
    await reportar(c.velejador, c.id, { lat: -3.0, lng: -39.0 });
    await db.query(`UPDATE downwind_posicoes SET registrado_em = NOW() - INTERVAL '10 minutes' WHERE downwind_id = $1`, [c.id]);
    await reportar(c.velejador, c.id, { lat: -3.0, lng: -39.09 });

    const r = await mudarStatus(c.org, c.id, 'cancelado');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await statusDe(c.id)).toBe('cancelado');
    const resumo = await db.query<{ distancia_km: string | null }>(
      `SELECT distancia_km FROM downwind_participantes WHERE downwind_id = $1 AND user_id = $2`,
      [c.id, c.velejador.id]
    );
    expect(Number(resumo.rows[0].distancia_km)).toBeGreaterThan(5);
  });

  it('NÃO-organizador não cancela: participante, apoio e espectador 403; estranho 404; anônimo 401', async () => {
    const c = await montar();
    for (const quem of [c.velejador, c.apoio, c.espectador]) {
      expect((await mudarStatus(quem, c.id, 'cancelado')).status).toBe(403);
    }
    expect((await mudarStatus(c.estranho, c.id, 'cancelado')).status).toBe(404);
    expect((await mudarStatus(null, c.id, 'cancelado')).status).toBe(401);
    expect(await statusDe(c.id)).toBe('aberto');
  });

  it('moderação cancela um downwind alheio; instrutor comum (sem ser organizador) não', async () => {
    const c = await montar();
    const instrutor = await novaPessoa({ role: 'instructor' });
    await entrar(instrutor, c.id);
    expect((await mudarStatus(instrutor, c.id, 'cancelado')).status).toBe(403);
    const mod = await novaPessoa({ role: 'moderator' });
    expect((await mudarStatus(mod, c.id, 'cancelado')).status).toBe(200);
    expect(await statusDe(c.id)).toBe('cancelado');
  });

  it('o que já terminou não volta nem cancela de novo (409)', async () => {
    const c = await montar();
    await mudarStatus(c.org, c.id, 'cancelado');
    expect((await mudarStatus(c.org, c.id, 'cancelado')).status).toBe(409);
    expect((await mudarStatus(c.org, c.id, 'em_andamento')).status).toBe(409);
  });

  it('estado desconhecido no corpo é 400; id que não é UUID é 404', async () => {
    const c = await montar();
    expect((await mudarStatus(c.org, c.id, 'pausado')).status).toBe(400);
    expect((await mudarStatus(c.org, 'nao-e-uuid', 'cancelado')).status).toBe(404);
  });
});
