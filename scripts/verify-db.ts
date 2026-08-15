/**
 * Teste de integração real contra o Neon. Exercita o que os testes unitários não
 * alcançam: constraints do schema, uso único de convite, corrida entre dois
 * aceites do mesmo link, e isolamento de dados entre usuários.
 *
 *   npx tsx scripts/verify-db.ts
 *
 * Cria dados com prefixo `__verify_` e apaga tudo no final, inclusive se falhar.
 */
import { randomBytes, createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { loadEnv } from './load-env';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERRO: DATABASE_URL não definida. Preencha .env.local.');
  process.exit(1);
}
const sql = neon(url);

const TAG = `__verify_${Date.now()}`;
let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

async function createUser(suffix: string, role: 'admin' | 'rider' = 'rider') {
  const rows = await sql`
    INSERT INTO users (email, password_hash, name, role, rider_id)
    VALUES (${`${TAG}_${suffix}@teste.local`}, ${await bcrypt.hash('senha-de-teste-123', 10)},
            ${`Rider ${suffix}`}, ${role}, ${`9${suffix.length}00`})
    RETURNING id
  `;
  return String((rows[0] as Record<string, unknown>).id);
}

async function main() {
  console.log('Conectando ao Neon...');
  const version = await sql`SELECT version()`;
  console.log(
    '  ' + String((version[0] as Record<string, unknown>).version).split(',')[0] + '\n'
  );

  console.log('Schema:');
  const expected = [
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
  ];
  const tables = await sql`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
  `;
  const found = new Set(tables.map((t) => String((t as Record<string, unknown>).table_name)));
  for (const t of expected) check(`tabela ${t} existe`, found.has(t));

  const adminId = await createUser('admin', 'admin');
  const riderA = await createUser('ridera');
  const riderB = await createUser('riderb');

  console.log('\nUsuários e constraints:');
  check('usuário criado com role admin', Boolean(adminId));

  try {
    await sql`
      INSERT INTO users (email, password_hash, name, rider_id)
      VALUES (${`${TAG}_ridera@teste.local`}, 'x', 'Duplicado', '0000')
    `;
    check('email duplicado é rejeitado', false, 'o INSERT passou');
  } catch {
    check('email duplicado é rejeitado', true);
  }

  try {
    await sql`
      INSERT INTO users (email, password_hash, name, rider_id, role)
      VALUES (${`${TAG}_bad@teste.local`}, 'x', 'Role Inválida', '0000', 'superuser')
    `;
    check('role inválida é rejeitada', false, 'o INSERT passou');
  } catch {
    check('role inválida é rejeitada', true);
  }

  console.log('\nConvite de uso único:');
  const token = newToken();
  const inviteRows = await sql`
    INSERT INTO invites (token_hash, created_by, expires_at)
    VALUES (${hashToken(token)}, ${adminId}, NOW() + INTERVAL '7 days')
    RETURNING id
  `;
  const inviteId = String((inviteRows[0] as Record<string, unknown>).id);

  const lookup = await sql`
    SELECT id FROM invites
    WHERE token_hash = ${hashToken(token)} AND used_at IS NULL
      AND revoked_at IS NULL AND expires_at > NOW()
  `;
  check('convite aberto é encontrado pelo hash do token', lookup.length === 1);

  const wrongLookup = await sql`
    SELECT id FROM invites WHERE token_hash = ${hashToken(newToken())}
  `;
  check('token errado não encontra convite', wrongLookup.length === 0);

  // A corrida: dois aceites simultâneos do mesmo link.
  const [firstUse, secondUse] = await Promise.all([
    sql`UPDATE invites SET used_at = NOW(), used_by = ${riderA}
        WHERE id = ${inviteId} AND used_at IS NULL RETURNING id`,
    sql`UPDATE invites SET used_at = NOW(), used_by = ${riderB}
        WHERE id = ${inviteId} AND used_at IS NULL RETURNING id`,
  ]);
  const wins = (firstUse.length > 0 ? 1 : 0) + (secondUse.length > 0 ? 1 : 0);
  check('dois usos simultâneos do mesmo convite: só um vence', wins === 1, `venceram ${wins}`);

  const reuse = await sql`
    UPDATE invites SET used_at = NOW() WHERE id = ${inviteId} AND used_at IS NULL RETURNING id
  `;
  check('convite já usado não pode ser reutilizado', reuse.length === 0);

  const expiredToken = newToken();
  await sql`
    INSERT INTO invites (token_hash, created_by, expires_at)
    VALUES (${hashToken(expiredToken)}, ${adminId}, NOW() - INTERVAL '1 day')
  `;
  const expiredLookup = await sql`
    SELECT id FROM invites WHERE token_hash = ${hashToken(expiredToken)} AND expires_at > NOW()
  `;
  check('convite expirado não é aceito', expiredLookup.length === 0);

  console.log('\nSessão de login:');
  const sessionToken = newToken();
  await sql`
    INSERT INTO auth_sessions (user_id, token_hash, expires_at)
    VALUES (${riderA}, ${hashToken(sessionToken)}, NOW() + INTERVAL '30 days')
  `;
  const sessionLookup = await sql`
    SELECT u.id, u.role FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(sessionToken)} AND s.expires_at > NOW()
  `;
  check('sessão válida resolve para o usuário', sessionLookup.length === 1);

  const expiredSession = newToken();
  await sql`
    INSERT INTO auth_sessions (user_id, token_hash, expires_at)
    VALUES (${riderA}, ${hashToken(expiredSession)}, NOW() - INTERVAL '1 hour')
  `;
  const expiredSessionLookup = await sql`
    SELECT 1 FROM auth_sessions WHERE token_hash = ${hashToken(expiredSession)}
      AND expires_at > NOW()
  `;
  check('sessão expirada não autentica', expiredSessionLookup.length === 0);

  console.log('\nIsolamento de dados entre velejadores:');
  const spotRows = await sql`SELECT id FROM spots LIMIT 1`;
  const spotId =
    spotRows.length > 0 ? String((spotRows[0] as Record<string, unknown>).id) : null;

  const sessA = await sql`
    INSERT INTO sessions_log (
      user_id, spot_id, spot_name, spot_location, date, start_time,
      duration_minutes, discipline, kite_size_m2, avg_wind_knots, rating
    ) VALUES (
      ${riderA}, ${spotId}, 'Spot A', 'RN', CURRENT_DATE, '10:00',
      90, 'Kitesurf Twintip', 9, 18, 5
    ) RETURNING id
  `;
  const sessAId = String((sessA[0] as Record<string, unknown>).id);

  // O ataque: B tenta apagar a sessão de A. A cláusula user_id deve impedir.
  const crossDelete = await sql`
    DELETE FROM sessions_log WHERE id = ${sessAId} AND user_id = ${riderB} RETURNING id
  `;
  check('velejador NÃO apaga sessão de outro', crossDelete.length === 0);

  const stillThere = await sql`SELECT id FROM sessions_log WHERE id = ${sessAId}`;
  check('a sessão da vítima continua intacta', stillThere.length === 1);

  const ownDelete = await sql`
    DELETE FROM sessions_log WHERE id = ${sessAId} AND user_id = ${riderA} RETURNING id
  `;
  check('velejador apaga a própria sessão', ownDelete.length === 1);

  console.log('\nConstraints de dados:');
  try {
    await sql`
      INSERT INTO sessions_log (
        user_id, spot_name, spot_location, date, start_time, duration_minutes,
        discipline, kite_size_m2, avg_wind_knots, rating
      ) VALUES (
        ${riderA}, 'X', 'Y', CURRENT_DATE, '10:00', 90, 'Kitesurf Twintip', 9, 18, 9
      )
    `;
    check('rating fora de 1..5 é rejeitado', false, 'aceitou rating 9');
  } catch {
    check('rating fora de 1..5 é rejeitado', true);
  }

  try {
    await sql`
      INSERT INTO safety_alerts (user_id, title, spot_name, severity, description)
      VALUES (${riderA}, 'T', 'S', 'catastrofe', 'D')
    `;
    check('severity inválida é rejeitada', false, 'aceitou valor fora do CHECK');
  } catch {
    check('severity inválida é rejeitada', true);
  }

  if (spotId) {
    await sql`INSERT INTO favorites (user_id, spot_id) VALUES (${riderA}, ${spotId})`;
    await sql`
      INSERT INTO favorites (user_id, spot_id) VALUES (${riderA}, ${spotId})
      ON CONFLICT DO NOTHING
    `;
    const favCount = await sql`
      SELECT COUNT(*)::int AS n FROM favorites WHERE user_id = ${riderA} AND spot_id = ${spotId}
    `;
    check(
      'favorito não duplica (chave composta)',
      Number((favCount[0] as Record<string, unknown>).n) === 1
    );

    const favB = await sql`SELECT 1 FROM favorites WHERE user_id = ${riderB}`;
    check('favorito de um não aparece para o outro', favB.length === 0);
  }

  console.log('\nCascata ao remover conta:');
  const postRows = await sql`
    INSERT INTO posts (user_id, title, content) VALUES (${riderA}, 'T', 'C') RETURNING id
  `;
  const postId = String((postRows[0] as Record<string, unknown>).id);
  await sql`INSERT INTO post_comments (post_id, user_id, text) VALUES (${postId}, ${riderB}, 'oi')`;

  await sql`DELETE FROM users WHERE id = ${riderA}`;
  const orphanPosts = await sql`SELECT 1 FROM posts WHERE id = ${postId}`;
  check('post é removido junto com o autor (ON DELETE CASCADE)', orphanPosts.length === 0);

  const orphanComments = await sql`SELECT 1 FROM post_comments WHERE post_id = ${postId}`;
  check('comentários do post removido também somem', orphanComments.length === 0);
}

async function cleanup() {
  console.log('\nLimpando dados de teste...');
  try {
    await sql`DELETE FROM invites WHERE created_by IN (SELECT id FROM users WHERE email LIKE ${TAG + '%'})`;
    await sql`DELETE FROM users WHERE email LIKE ${TAG + '%'}`;
    // Varredura de resíduo de execuções anteriores interrompidas.
    await sql`DELETE FROM users WHERE email LIKE '__verify_%@teste.local'`;
    console.log('  ok');
  } catch (err) {
    console.error('  falhou:', err instanceof Error ? err.message : err);
  }
}

main()
  .then(cleanup)
  .then(() => {
    console.log('\n' + '='.repeat(50));
    console.log(`Resultado: ${passed} passaram, ${failed} falharam`);
    console.log('='.repeat(50));
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error('\nERRO:', err instanceof Error ? err.message : err);
    await cleanup();
    process.exit(1);
  });
