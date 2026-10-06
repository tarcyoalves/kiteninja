/**
 * Banco de PRÉ-VISUALIZAÇÃO: Postgres em memória (PGlite) com dados de exemplo.
 *
 * POR QUE EXISTE
 *
 * Para ver as telas do app de verdade — no tamanho de um celular, logado, com
 * feed, eventos, downwind e chat preenchidos — é preciso um banco. O de
 * produção não se toca para isso. Com `KITENINJA_PREVIEW=1 npm run dev`, o app
 * inteiro roda localmente contra este banco, que nasce com o lib/schema.sql de
 * produção e dados fictícios. Foi assim que a análise de experiência mobile de
 * 06/10/2026 viu as telas em vez de deduzi-las lendo JSX.
 *
 * Como usar: `npm run dev:preview` e abrir http://localhost:3000. O banco nasce
 * de novo a cada vez que o servidor sobe; nada é gravado em disco.
 *
 * NUNCA em produção: o next.config.ts só aponta `@/lib/db` para cá com
 * KITENINJA_PREVIEW=1 fora da Vercel, e este módulo ainda se recusa a carregar
 * com NODE_ENV=production (abaixo).
 *
 * Contas de exemplo (senha igual para todas): `preview-kite-123`
 *   admin@preview.kiteninja   — admin
 *   bruno@preview.kiteninja   — velejador (o "você" das capturas)
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INITIAL_SPOTS } from '../data/spotsCatalogo';
import { splitSqlStatements } from './splitSqlStatements';

if (process.env.NODE_ENV === 'production') {
  throw new Error('lib/dbPreview.ts é só para `npm run dev:preview` — nunca em build de produção.');
}

export const SENHA_PREVIEW = 'preview-kite-123';

type Estado = { db: PGlite; pronto: Promise<void> };
// No globalThis: o `next dev` recarrega módulos a cada edição, e um banco novo
// a cada recarga apagaria a sessão de quem está logado na pré-visualização.
const g = globalThis as unknown as { __kitePreview?: Estado };

function estado(): Estado {
  if (!g.__kitePreview) {
    const db = new PGlite({ extensions: { pgcrypto } });
    g.__kitePreview = { db, pronto: preparar(db) };
  }
  return g.__kitePreview;
}

/** Mesmo contrato do `neon()`: template tag que resolve nas linhas. */
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const { db, pronto } = estado();
  let text = strings[0];
  for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1];
  return pronto.then(() => db.query(text, values as unknown[]).then((r) => r.rows));
}

async function preparar(db: PGlite): Promise<void> {
  const schema = readFileSync(join(process.cwd(), 'lib', 'schema.sql'), 'utf8');
  for (const st of splitSqlStatements(schema)) {
    try {
      await db.exec(st);
    } catch {
      // objeto que o PGlite não suporta não interessa à pré-visualização
    }
  }
  await semear(db);
}

const minutosAtras = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const diasAFrente = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
/** "sábado, 11 de outubro" — o mesmo dia de `diasAFrente(d)`, para o texto não envelhecer. */
const diaPorExtenso = (d: number) =>
  new Date(Date.now() + d * 86_400_000).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'America/Fortaleza',
  });

/** Trilha em zigue-zague de contravento perto de um ponto, [lat, lng, tsMs]. */
function trilha(lat: number, lng: number, n = 140): Array<[number, number, number]> {
  const t0 = Date.now() - 2 * 3600_000;
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const perna = Math.floor(i / 14);
    const dentro = i % 14;
    const lado = perna % 2 === 0 ? 1 : -1;
    pts.push([
      lat + i * 0.00018 + Math.sin(i / 6) * 0.0003,
      lng + lado * (dentro - 7) * 0.0006,
      t0 + i * 45_000,
    ]);
  }
  return pts;
}

async function semear(db: PGlite): Promise<void> {
  const q = (text: string, params: unknown[] = []) => db.query(text, params);
  const hash = await bcrypt.hash(SENHA_PREVIEW, 8);

  for (const s of INITIAL_SPOTS) {
    await q(
      `INSERT INTO spots (id, name, location, state, country, country_flag, lat, lng,
         wind_safety, water_condition, bottom_type, difficulty, ideal_wind_directions,
         hazards, amenities, webcam_url, webcam_live_stream, cover_image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.name, s.location, s.state, s.country, s.countryFlag, s.lat, s.lng,
       s.windSafety, s.waterCondition, s.bottomType, s.difficulty, s.idealWindDirections,
       s.hazards, s.amenities, s.webcamUrl ?? null, s.webcamLiveStream ?? false, s.coverImage]
    );
  }

  const pessoas = [
    { nome: 'Ana Ribeiro', email: 'admin@preview.kiteninja', role: 'admin', nivel: 'Avançado', spot: 'galinhos' },
    { nome: 'Bruno Costa', email: 'bruno@preview.kiteninja', role: 'rider', nivel: 'Intermediário', spot: 'galinhos' },
    { nome: 'Carla Menezes', email: 'carla@preview.kiteninja', role: 'instructor', nivel: 'Avançado', spot: 'ponta-do-mel' },
    { nome: 'Diego Farias', email: 'diego@preview.kiteninja', role: 'rider', nivel: 'Iniciante', spot: 'porto-do-mangue' },
    { nome: 'Elisa Prado', email: 'elisa@preview.kiteninja', role: 'rider', nivel: 'Intermediário', spot: 'galinhos' },
  ];
  const ids: Record<string, string> = {};
  for (const [i, p] of pessoas.entries()) {
    const r = await q(
      `INSERT INTO users (email, password_hash, name, role, rider_id, rider_level, home_spot,
         weight_kg, disciplines, bio, last_login_at, last_seen_at, login_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW(),3) RETURNING id`,
      [p.email, hash, p.nome, p.role, `KN-PV${i + 1}`, p.nivel, p.spot, 70 + i * 3,
       ['Freeride', 'Downwind'], `Velejo no RN desde ${2015 + i}.`]
    );
    ids[p.email.split('@')[0]] = (r.rows[0] as { id: string }).id;
  }
  const { admin, bruno, carla, diego, elisa } = ids;

  for (const [a, b] of [[bruno, carla], [bruno, elisa], [carla, bruno], [diego, bruno], [elisa, carla]]) {
    await q(`INSERT INTO user_follows (follower_id, following_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [a, b]);
  }

  const sessoes: Array<[string, string, string, number, number, number]> = [
    [carla, 'ponta-do-mel', 'Ponta do Mel', 9, 22.4, 31.8],
    [bruno, 'galinhos', 'Galinhos', 12, 28.1, 24.6],
    [elisa, 'galinhos', 'Galinhos', 9, 19.7, 27.2],
    [diego, 'porto-do-mangue', 'Porto do Mangue', 12, 8.3, 16.9],
  ];
  for (const [i, [uid, spotId, spotNome, kite, dist, vmax]] of sessoes.entries()) {
    const spot = INITIAL_SPOTS.find((s) => s.id === spotId)!;
    const r = await q(
      `INSERT INTO sessions_log (user_id, spot_id, spot_name, spot_location, date, start_time,
         duration_minutes, discipline, kite_size_m2, avg_wind_knots, max_gust_knots, wind_direction,
         rating, distance_km, max_speed_knots, notes, is_public, trilha_reduzida, lat_inicial, lng_inicial, created_at)
       VALUES ($1,$2,$3,$4,$5,'14:30',$6,'Freeride',$7,$8,$9,'E',$10,$11,$12,$13,TRUE,$14::jsonb,$15,$16,$17)
       RETURNING id`,
      [uid, spotId, spotNome, spot.location, new Date().toISOString().slice(0, 10), 75 + i * 10, kite,
       18 + i, 24 + i, 4 + (i % 2), dist, vmax, i === 0 ? 'Vento firme a tarde toda, maré subindo.' : null,
       JSON.stringify(trilha(spot.lat, spot.lng)), spot.lat, spot.lng, minutosAtras(30 + i * 90)]
    );
    const sid = (r.rows[0] as { id: string }).id;
    await q(
      `INSERT INTO posts (user_id, session_id, title, content, spot_name, spot_location, wind_knots, wind_kite_used, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [uid, sid, `Velejo em ${spotNome}`, i === 0 ? 'Que tarde! 22 km de downwind com a galera.' : 'Sessão boa hoje.',
       spotNome, spot.location, 18 + i, `${kite}m`, minutosAtras(30 + i * 90)]
    );
  }

  const ev = await q(
    `INSERT INTO events (title, event_date, location, spot_name, type, description, organizer, event_at, uf)
     VALUES ($1,$2,$3,$4,'Downwind',$5,$6,$7,'RN') RETURNING id`,
    ['Downwind Galinhos → Porto do Mangue', diaPorExtenso(5), 'Galinhos / RN', 'Galinhos',
     'Saída às 13h da praia do farol. Carro de apoio confirmado.', 'Ana Ribeiro', diasAFrente(5)]
  );
  const eventoId = (ev.rows[0] as { id: string }).id;
  const dw = await q(
    `INSERT INTO downwinds (nome, spot_saida, spot_chegada, criado_por, status, previsto_para, visibilidade, event_id)
     VALUES ($1,'galinhos','porto-do-mangue',$2,'aberto',$3,'comunidade',$4) RETURNING id`,
    ['Downwind Galinhos → Porto do Mangue', admin, diasAFrente(5), eventoId]
  );
  const dwId = (dw.rows[0] as { id: string }).id;
  await q(`INSERT INTO downwind_participantes (downwind_id, user_id, papel, eh_organizador) VALUES ($1,$2,'velejador',TRUE)`, [dwId, admin]);
  await q(`INSERT INTO downwind_participantes (downwind_id, user_id, papel) VALUES ($1,$2,'velejador')`, [dwId, carla]);
  await q(`INSERT INTO downwind_participantes (downwind_id, user_id, papel) VALUES ($1,$2,'apoio_terra')`, [dwId, diego]);
  for (const u of [admin, carla, elisa]) {
    await q(`INSERT INTO event_registrations (event_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [eventoId, u]);
  }
  await q(
    `INSERT INTO events (title, event_date, location, spot_name, type, description, organizer, event_at, uf)
     VALUES ('Clínica de transições', $2, 'Ponta do Mel / RN', 'Ponta do Mel', 'Clínica',
             'Aula em grupo para jibe e tack. Traga seu equipamento.', 'Carla Menezes', $1, 'RN')`,
    [diasAFrente(13), diaPorExtenso(13)]
  );

  const msgs: Array<[string, string, number]> = [
    [carla, 'Bom dia! Vento entrando forte em Ponta do Mel 🌬️', 95],
    [elisa, 'Galinhos tá 18 nós constante, maré enchendo', 80],
    [diego, 'Alguém tem uma barra sobrando pra emprestar sábado?', 42],
    [bruno, 'Vou no downwind de sábado! Quem mais vai?', 12],
    [carla, 'Eu vou. Levo o 9m.', 6],
  ];
  for (const [uid, texto, min] of msgs) {
    await q(`INSERT INTO chat_messages (user_id, room, text, created_at) VALUES ($1,'geral',$2,$3)`, [uid, texto, minutosAtras(min)]);
  }

  await q(
    `INSERT INTO listings (user_id, title, description, category, condition, price_cents, brand, model, year_manufactured, size_m2, city, state)
     VALUES ($1,'Kite Core XR7 9m','Pouco uso, sem reparos. Acompanha bolsa.','Kite','Semi-novo',520000,'Core','XR7',2023,9,'Natal','RN')`,
    [carla]
  );
  await q(
    `INSERT INTO listings (user_id, title, description, category, condition, price_cents, brand, model, year_manufactured, size_cm, city, state)
     VALUES ($1,'Prancha Twin Tip 138','Prancha boa para iniciantes, com strap novo.','Prancha','Usado',120000,'North','Trace',2021,138,'Galinhos','RN')`,
    [diego]
  );

  await q(
    `INSERT INTO safety_alerts (user_id, title, spot_name, severity, description)
     VALUES ($1,'Água-viva na Barra','Barra de Areia Branca','alerta','Muita água-viva perto da arrebentação hoje à tarde.')`,
    [elisa]
  );

  for (const [u, min] of [[carla, 1], [elisa, 2], [bruno, 0]] as Array<[string, number]>) {
    await q(
      `INSERT INTO user_presence (user_id, last_seen_at, room) VALUES ($1,$2,'geral')
       ON CONFLICT (user_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [u, minutosAtras(min)]
    );
  }
}
