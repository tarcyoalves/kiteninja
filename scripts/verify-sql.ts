/**
 * Valida o schema e as queries das rotas contra um Postgres real, em processo
 * (PGlite). Não precisa de Neon nem de rede — serve para pegar coluna
 * inexistente, violação de constraint e erro de sintaxe antes do deploy.
 *
 *   npx tsx scripts/verify-sql.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Espera que a query FALHE (constraint deve barrar). */
async function expectFail(db: PGlite, name: string, sql: string, params: unknown[] = []) {
  try {
    await db.query(sql, params);
    check(name, false, 'a query passou, mas devia ter sido rejeitada');
  } catch {
    check(name, true);
  }
}

/** Espera que a query FUNCIONE. */
async function expectOk(
  db: PGlite,
  name: string,
  sql: string,
  params: unknown[] = []
): Promise<Record<string, unknown>[]> {
  try {
    const res = await db.query(sql, params);
    check(name, true);
    return res.rows as Record<string, unknown>[];
  } catch (err) {
    check(name, false, err instanceof Error ? err.message.split('\n')[0] : String(err));
    return [];
  }
}

async function main() {
  console.log('Postgres em processo (PGlite)\n');
  // gen_random_uuid() vem do pgcrypto; no Neon a extensão já está disponível,
  // aqui ela precisa ser carregada explicitamente.
  const db = new PGlite({ extensions: { pgcrypto } });

  // ------------------------------------------------------------- schema
  console.log('Schema:');
  const schema = readFileSync(join(process.cwd(), 'lib', 'schema.sql'), 'utf8');
  try {
    await db.exec(schema);
    check('lib/schema.sql aplica sem erro', true);
  } catch (err) {
    check('lib/schema.sql aplica sem erro', false, err instanceof Error ? err.message : '');
    console.log('\nSchema inválido, abortando.');
    process.exit(1);
  }

  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
  );
  const found = new Set(tables.rows.map((r) => r.table_name));
  for (const t of [
    'users',
    'invites',
    'auth_sessions',
    'spots',
    'favorites',
    'sessions_log',
    'posts',
    'post_likes',
    'post_comments',
    'safety_alerts',
    'events',
    'event_registrations',
    'password_reset_tokens',
    'audit_logs',
    'content_reports',
    'notification_preferences',
    'sos_alerts',
    'sos_responders',
    'push_subscriptions',
  ]) {
    check(`tabela ${t}`, found.has(t));
  }

  // ----------------------------------------------------- dados de apoio
  const admin = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, role, rider_id)
     VALUES ('admin@t.local', '$2b$12$x', 'Admin', 'admin', '0001') RETURNING id`
  );
  const adminId = admin.rows[0].id;

  const riderA = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('a@t.local', '$2b$12$x', 'Rider A', '1001') RETURNING id`
    )
  ).rows[0].id;

  const riderB = (
    await db.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, rider_id)
       VALUES ('b@t.local', '$2b$12$x', 'Rider B', '1002') RETURNING id`
    )
  ).rows[0].id;

  await db.query(
    `INSERT INTO spots (id, name, location, state, lat, lng, wind_safety,
       water_condition, bottom_type, difficulty, cover_image)
     VALUES ('ponta-do-mel', 'Ponta do Mel', 'Areia Branca / RN', 'RN',
       -4.9572, -36.8833, 'Side-Onshore', 'Chop Médio', 'Areia',
       'Intermediário', 'x.jpg')`
  );

  // ------------------------------------------------------- constraints
  console.log('\nConstraints:');
  await expectFail(
    db,
    'email duplicado é rejeitado',
    `INSERT INTO users (email, password_hash, name, rider_id)
     VALUES ('a@t.local', 'x', 'Dup', '9')`
  );
  await expectFail(
    db,
    'role fora do CHECK é rejeitada',
    `INSERT INTO users (email, password_hash, name, rider_id, role)
     VALUES ('c@t.local', 'x', 'X', '9', 'superuser')`
  );
  await expectFail(
    db,
    'rating fora de 1..5 é rejeitado',
    `INSERT INTO sessions_log (user_id, spot_name, spot_location, date, start_time,
       duration_minutes, discipline, kite_size_m2, avg_wind_knots, rating)
     VALUES ($1, 'S', 'L', CURRENT_DATE, '10:00', 90, 'Kitesurf Twintip', 9, 18, 9)`,
    [riderA]
  );
  await expectFail(
    db,
    'duration_minutes <= 0 é rejeitado',
    `INSERT INTO sessions_log (user_id, spot_name, spot_location, date, start_time,
       duration_minutes, discipline, kite_size_m2, avg_wind_knots, rating)
     VALUES ($1, 'S', 'L', CURRENT_DATE, '10:00', 0, 'Kitesurf Twintip', 9, 18, 5)`,
    [riderA]
  );
  await expectFail(
    db,
    'severity fora do CHECK é rejeitada',
    `INSERT INTO safety_alerts (user_id, title, spot_name, severity, description)
     VALUES ($1, 'T', 'S', 'catastrofe', 'D')`,
    [riderA]
  );
  await expectFail(
    db,
    'sos status fora do CHECK é rejeitado',
    `INSERT INTO sos_alerts (user_id, status) VALUES ($1, 'socorro_invalido')`,
    [riderA]
  );
  await expectFail(
    db,
    'sos_responder state fora do CHECK é rejeitado',
    `INSERT INTO sos_responders (sos_id, user_id, state) VALUES (gen_random_uuid(), $1, 'voando')`,
    [riderA]
  );

  // ------------------------------------------- queries reais das rotas
  console.log('\nQueries das rotas de auth:');
  await expectOk(
    db,
    'login: busca por email em minúsculas',
    `SELECT id, password_hash, name, role, must_change_password
     FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    ['a@t.local']
  );

  await db.query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
     VALUES ($1, 'hash-de-teste', NOW() + INTERVAL '30 days')`,
    [riderA]
  );
  const sessionLookup = await expectOk(
    db,
    'getSessionUser: join sessão + usuário',
    `SELECT u.id, u.email, u.name, u.role, u.must_change_password
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() LIMIT 1`,
    ['hash-de-teste']
  );
  check('sessão válida resolve 1 usuário', sessionLookup.length === 1);

  await expectOk(
    db,
    '/api/auth/me: perfil + estatísticas agregadas',
    `SELECT COUNT(*)::int AS total_sessions,
            COALESCE(SUM(duration_minutes), 0)::int AS total_minutes,
            COALESCE(SUM(distance_km), 0)::float AS total_km,
            COALESCE(MAX(max_speed_knots), 0)::float AS max_knots
     FROM sessions_log WHERE user_id = $1`,
    [riderA]
  );

  console.log('\nQueries de convite:');
  const inv = await db.query<{ id: string }>(
    `INSERT INTO invites (token_hash, created_by, expires_at)
     VALUES ('inv-hash', $1, NOW() + INTERVAL '7 days') RETURNING id`,
    [adminId]
  );
  const inviteId = inv.rows[0].id;

  await expectOk(
    db,
    'findUsableInvite',
    `SELECT id, email FROM invites
     WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL
       AND expires_at > NOW() LIMIT 1`,
    ['inv-hash']
  );

  const firstUse = await db.query(
    `UPDATE invites SET used_at = NOW(), used_by = $2
     WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [inviteId, riderA]
  );
  check('consumeInvite: primeiro uso vence', firstUse.rows.length === 1);

  const secondUse = await db.query(
    `UPDATE invites SET used_at = NOW(), used_by = $2
     WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id`,
    [inviteId, riderB]
  );
  check('consumeInvite: segundo uso é bloqueado', secondUse.rows.length === 0);

  await expectOk(
    db,
    'listagem de convites do admin',
    `SELECT i.id, i.email, i.note, i.expires_at, i.used_at, i.revoked_at,
            u.name AS used_by_name
     FROM invites i LEFT JOIN users u ON u.id = i.used_by
     ORDER BY i.created_at DESC LIMIT 100`
  );

  console.log('\nRecuperação de Senha & Ciclo de Vida:');
  const resetToken = await db.query<{ id: string }>(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, 'reset-hash-teste', NOW() + INTERVAL '2 hours') RETURNING id`,
    [riderA]
  );
  check('criação de token de recuperação de senha', resetToken.rows.length === 1);

  await expectOk(
    db,
    'validação de token de recuperação aberto',
    `SELECT r.id, r.user_id, u.email
     FROM password_reset_tokens r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = $1 AND r.used_at IS NULL AND r.expires_at > NOW() LIMIT 1`,
    ['reset-hash-teste']
  );

  const resetConsume = await db.query(
    `UPDATE password_reset_tokens SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL RETURNING id`,
    ['reset-hash-teste']
  );
  check('consumo de token de recuperação de senha', resetConsume.rows.length === 1);

  const resetReconsume = await db.query(
    `UPDATE password_reset_tokens SET used_at = NOW()
     WHERE token_hash = $1 AND used_at IS NULL RETURNING id`,
    ['reset-hash-teste']
  );
  check('segundo consumo do token é barrado', resetReconsume.rows.length === 0);

  console.log('\nAuditoria e Notificações:');
  await expectOk(
    db,
    'inserção de log de auditoria',
    `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
     VALUES ($1, 'ROLE_CHANGED', 'user', $2) RETURNING id`,
    [adminId, riderA]
  );

  await expectOk(
    db,
    'inserção de preferências de notificação',
    `INSERT INTO notification_preferences (user_id, wind_alerts_enabled, wind_min_knots)
     VALUES ($1, TRUE, 18.0) ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
    [riderA]
  );

  console.log('\nConfiguração global (app_settings):');
  await expectOk(
    db,
    'grava a abertura com upsert por chave',
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('intro_video', $1::jsonb, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [
      JSON.stringify({ url: 'https://blob/x.mp4', inicioSeg: 1, fimSeg: 6, ativo: true }),
      adminId,
    ]
  );

  // O upsert é o caminho normal: o admin troca a abertura várias vezes.
  await expectOk(
    db,
    'segunda gravação sobrescreve em vez de duplicar',
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ('intro_video', $1::jsonb, $2, NOW())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [
      JSON.stringify({ url: 'https://blob/y.mp4', inicioSeg: 0, fimSeg: 4, ativo: true }),
      adminId,
    ]
  );

  const settings = await db.query<{ cnt: number; url: string }>(
    `SELECT COUNT(*)::int AS cnt, MAX(value->>'url') AS url
     FROM app_settings WHERE key = 'intro_video'`
  );
  check('app_settings tem 1 linha por chave', Number(settings.rows[0].cnt) === 1);
  check('valor gravado é o último enviado', settings.rows[0].url === 'https://blob/y.mp4');

  const leitura = await db.query(
    `SELECT value FROM app_settings WHERE key = 'intro_video' LIMIT 1`
  );
  const lido = leitura.rows[0] as { value: Record<string, unknown> };
  check('JSONB volta como objeto, não string', typeof lido.value === 'object');
  check('campo do trecho preserva número', Number(lido.value.fimSeg) === 4);

  console.log('\nIsolamento entre velejadores:');
  const sess = await db.query<{ id: string }>(
    `INSERT INTO sessions_log (user_id, spot_id, spot_name, spot_location, date,
       start_time, duration_minutes, discipline, kite_size_m2, avg_wind_knots, rating)
     VALUES ($1, 'ponta-do-mel', 'Ponta do Mel', 'RN', CURRENT_DATE, '10:00',
       90, 'Kitesurf Twintip', 9, 18, 5) RETURNING id`,
    [riderA]
  );
  const sessAId = sess.rows[0].id;

  const crossDelete = await db.query(
    `DELETE FROM sessions_log WHERE id = $1 AND user_id = $2 RETURNING id`,
    [sessAId, riderB]
  );
  check('B NÃO apaga sessão de A', crossDelete.rows.length === 0);

  const intact = await db.query(`SELECT id FROM sessions_log WHERE id = $1`, [sessAId]);
  check('sessão de A continua intacta', intact.rows.length === 1);

  // O PATCH real usa COALESCE para só alterar campos enviados.
  const patched = await db.query<{ spot_name: string; rating: number; notes: string }>(
    `UPDATE sessions_log SET
       spot_name = COALESCE($3, spot_name),
       rating    = COALESCE($4, rating),
       notes     = COALESCE($5, notes)
     WHERE id = $1 AND user_id = $2 RETURNING spot_name, rating, notes`,
    [sessAId, riderA, null, 4, 'vento bom']
  );
  check('PATCH com COALESCE preserva campo não enviado', patched.rows[0]?.spot_name === 'Ponta do Mel');
  check('PATCH aplica campo enviado', Number(patched.rows[0]?.rating) === 4);

  const crossPatch = await db.query(
    `UPDATE sessions_log SET rating = 1 WHERE id = $1 AND user_id = $2 RETURNING id`,
    [sessAId, riderB]
  );
  check('B NÃO edita sessão de A', crossPatch.rows.length === 0);

  console.log('\nToggles (chave composta, sem coluna id):');
  const post = await db.query<{ id: string }>(
    `INSERT INTO posts (user_id, title, content) VALUES ($1, 'T', 'C') RETURNING id`,
    [riderA]
  );
  const postId = post.rows[0].id;

  // Reproduz exatamente o toggle da rota: DELETE ... RETURNING, senão INSERT.
  const likeRemove1 = await db.query(
    `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2 RETURNING post_id`,
    [postId, riderB]
  );
  check('like: primeiro DELETE não remove nada', likeRemove1.rows.length === 0);

  await expectOk(
    db,
    'like: INSERT com ON CONFLICT',
    `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)
     ON CONFLICT (post_id, user_id) DO NOTHING`,
    [postId, riderB]
  );
  await expectOk(
    db,
    'like: INSERT repetido não duplica',
    `INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2)
     ON CONFLICT (post_id, user_id) DO NOTHING`,
    [postId, riderB]
  );

  const likeCount = await db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM post_likes WHERE post_id = $1`,
    [postId]
  );
  check('like: contagem é 1 após dois inserts', Number(likeCount.rows[0].cnt) === 1);

  const likeRemove2 = await db.query(
    `DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2 RETURNING post_id`,
    [postId, riderB]
  );
  check('like: DELETE remove ao destoggle', likeRemove2.rows.length === 1);

  await expectOk(
    db,
    'favorito: toggle por DELETE RETURNING',
    `DELETE FROM favorites WHERE user_id = $1 AND spot_id = $2 RETURNING spot_id`,
    [riderA, 'ponta-do-mel']
  );
  await expectOk(
    db,
    'favorito: INSERT com ON CONFLICT',
    `INSERT INTO favorites (user_id, spot_id) VALUES ($1, $2)
     ON CONFLICT (user_id, spot_id) DO NOTHING`,
    [riderA, 'ponta-do-mel']
  );

  const favB = await db.query(`SELECT spot_id FROM favorites WHERE user_id = $1`, [riderB]);
  check('favorito de A não aparece para B', favB.rows.length === 0);

  const ev = await db.query<{ id: string }>(
    `INSERT INTO events (title, event_date, location, type, description, organizer)
     VALUES ('Downwind', '20/08', 'RN', 'Downwind', 'D', 'Org') RETURNING id`
  );
  await expectOk(
    db,
    'inscrição em evento: toggle',
    `DELETE FROM event_registrations WHERE event_id = $1 AND user_id = $2 RETURNING event_id`,
    [ev.rows[0].id, riderA]
  );
  await expectOk(
    db,
    'inscrição em evento: INSERT ON CONFLICT',
    `INSERT INTO event_registrations (event_id, user_id) VALUES ($1, $2)
     ON CONFLICT (event_id, user_id) DO NOTHING`,
    [ev.rows[0].id, riderA]
  );

  console.log('\nFeed:');
  await expectOk(
    db,
    'feed com likes, comentários e isLiked do usuário',
    `SELECT p.id, p.title, p.content, p.created_at,
            u.name AS author_name, u.avatar_url, u.rider_id, u.country_flag,
            (SELECT COUNT(*)::int FROM post_likes pl WHERE pl.post_id = p.id) AS likes,
            (SELECT COUNT(*)::int FROM post_comments pc WHERE pc.post_id = p.id) AS comments_count,
            EXISTS (SELECT 1 FROM post_likes pl2 WHERE pl2.post_id = p.id AND pl2.user_id = $1) AS is_liked
     FROM posts p JOIN users u ON u.id = p.user_id
     ORDER BY p.created_at DESC LIMIT 50`,
    [riderA]
  );

  await expectOk(
    db,
    'eventos com participantes e inscrição do usuário',
    `SELECT e.id, e.title, e.event_date, e.location, e.type,
            (SELECT COUNT(*)::int FROM event_registrations er WHERE er.event_id = e.id) AS participants_count,
            EXISTS (SELECT 1 FROM event_registrations er2 WHERE er2.event_id = e.id AND er2.user_id = $1) AS is_registered
     FROM events e ORDER BY e.created_at DESC`,
    [riderA]
  );

  await expectOk(
    db,
    'alertas ativos com autor',
    `SELECT a.id, a.title, a.spot_name, a.severity, a.description, a.status,
            a.created_at, u.name AS reported_by
     FROM safety_alerts a JOIN users u ON u.id = a.user_id
     WHERE a.status = 'Ativo' ORDER BY a.created_at DESC`
  );

  console.log('\nSistema de Socorro (SOS) e Web Push:');
  const sosNullCoords = await expectOk(
    db,
    'SOS é aceito sem coordenadas (GPS demorou/falhou)',
    `INSERT INTO sos_alerts (user_id, status, radius_km) VALUES ($1, 'ativo', 5) RETURNING id`,
    [riderA]
  );
  check('SOS sem coordenada tem 1 linha', sosNullCoords.length === 1);

  const sosComCoords = await db.query<{ id: string }>(
    `INSERT INTO sos_alerts (user_id, lat, lng, accuracy_m, spot_id, message, status, radius_km)
     VALUES ($1, -4.9572, -36.8833, 15.5, 'ponta-do-mel', 'prancha quebrada', 'ativo', 5) RETURNING id`,
    [riderA]
  );
  const sosId = sosComCoords.rows[0].id;
  check('criação de SOS com coordenadas e spot', Boolean(sosId));

  await expectOk(
    db,
    'sos_responders: notifica rider B',
    `INSERT INTO sos_responders (sos_id, user_id, state, distance_km)
     VALUES ($1, $2, 'notificado', 3.2)`,
    [sosId, riderB]
  );

  await expectFail(
    db,
    'sos_responders: PK composta (sos_id, user_id) rejeita duplicata sem ON CONFLICT',
    `INSERT INTO sos_responders (sos_id, user_id, state) VALUES ($1, $2, 'notificado')`,
    [sosId, riderB]
  );

  await expectOk(
    db,
    'sos_responders: UPSERT para state=a_caminho atualiza sem duplicar',
    `INSERT INTO sos_responders (sos_id, user_id, state, lat, lng, responded_at)
     VALUES ($1, $2, 'a_caminho', -4.9500, -36.8800, NOW())
     ON CONFLICT (sos_id, user_id) DO UPDATE
       SET state = EXCLUDED.state, lat = EXCLUDED.lat, lng = EXCLUDED.lng, responded_at = EXCLUDED.responded_at`,
    [sosId, riderB]
  );

  const respondersCount = await db.query<{ cnt: number }>(
    `SELECT COUNT(*)::int AS cnt FROM sos_responders WHERE sos_id = $1`,
    [sosId]
  );
  check('sos_responders mantém 1 linha por usuário após upsert', Number(respondersCount.rows[0].cnt) === 1);

  await expectOk(
    db,
    'inscrição de Web Push criada com sucesso',
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, 'https://push.services.mozilla.com/123', 'p256key', 'authkey', 'Firefox Mobile')
     RETURNING id`,
    [riderB]
  );

  await expectFail(
    db,
    'push_subscriptions: endpoint UNIQUE rejeita duplicata direta',
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
     VALUES ($1, 'https://push.services.mozilla.com/123', 'k', 'a')`,
    [riderB]
  );

  await expectOk(
    db,
    'push_subscriptions: UPSERT por endpoint atualiza sem erro',
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_used_at, failure_count)
     VALUES ($1, 'https://push.services.mozilla.com/123', 'p256_new', 'auth_new', 'Chrome', NOW(), 0)
     ON CONFLICT (endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, last_used_at = NOW(), failure_count = 0`,
    [riderB]
  );

  await expectOk(
    db,
    'atualização de contato de emergência no perfil',
    `UPDATE users
     SET emergency_contact_name = 'Maria Velejadora', emergency_contact_phone = '84999998888'
     WHERE id = $1 RETURNING emergency_contact_name, emergency_contact_phone`,
    [riderA]
  );

  console.log('\nCascata:');
  await db.query(`INSERT INTO post_comments (post_id, user_id, text) VALUES ($1, $2, 'oi')`, [
    postId,
    riderB,
  ]);
  await db.query(`DELETE FROM users WHERE id = $1`, [riderA]);

  const orphanPosts = await db.query(`SELECT id FROM posts WHERE id = $1`, [postId]);
  check('post morre com o autor', orphanPosts.rows.length === 0);

  const orphanComments = await db.query(`SELECT id FROM post_comments WHERE post_id = $1`, [postId]);
  check('comentários morrem com o post', orphanComments.rows.length === 0);

  const orphanSessions = await db.query(`SELECT id FROM sessions_log WHERE user_id = $1`, [riderA]);
  check('sessões morrem com o autor', orphanSessions.rows.length === 0);

  const orphanSos = await db.query(`SELECT id FROM sos_alerts WHERE user_id = $1`, [riderA]);
  check('sos_alerts morre com o autor', orphanSos.rows.length === 0);

  const orphanPush = await db.query(`SELECT id FROM push_subscriptions WHERE user_id = $1`, [riderA]);
  check('push_subscriptions morrem com o usuário', orphanPush.rows.length === 0);

  await db.close();
}

main()
  .then(() => {
    console.log('\n' + '='.repeat(52));
    console.log(`Resultado: ${passed} passaram, ${failed} falharam`);
    console.log('='.repeat(52));
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error('\nERRO:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
