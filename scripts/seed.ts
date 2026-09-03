/**
 * Popula o banco: spots (das coordenadas reais já catalogadas), o usuário admin
 * e os eventos iniciais.
 *
 *   npx tsx scripts/seed.ts --admin-email=voce@exemplo.com
 *
 * A senha do admin é gerada aleatoriamente e impressa UMA vez. Se o usuário já
 * existir, nada é sobrescrito (rodar de novo é seguro).
 */
import { randomBytes } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import { loadEnv } from './load-env';
import { INITIAL_SPOTS } from '../data/mockSpots';
import { INITIAL_EVENTS } from '../data/mockFeed';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ERRO: DATABASE_URL não definida. Preencha .env.local.');
  process.exit(1);
}
const sql = neon(url);

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=').slice(1).join('=');
}

function generatePassword(): string {
  // Sem caracteres ambíguos (0/O, 1/l/I): vai ser digitado no celular.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (const byte of randomBytes(16)) out += alphabet[byte % alphabet.length];
  return out;
}

async function seedSpots() {
  console.log(`\nSpots (${INITIAL_SPOTS.length})...`);

  for (const spot of INITIAL_SPOTS) {
    await sql`
      INSERT INTO spots (
        id, name, location, state, country, country_flag, lat, lng,
        wind_safety, water_condition, bottom_type, difficulty,
        ideal_wind_directions, hazards, amenities,
        webcam_url, webcam_live_stream, cover_image
      ) VALUES (
        ${spot.id}, ${spot.name}, ${spot.location}, ${spot.state},
        ${spot.country}, ${spot.countryFlag}, ${spot.lat}, ${spot.lng},
        ${spot.windSafety}, ${spot.waterCondition}, ${spot.bottomType},
        ${spot.difficulty}, ${spot.idealWindDirections}, ${spot.hazards},
        ${spot.amenities}, ${spot.webcamUrl ?? null},
        ${spot.webcamLiveStream ?? false}, ${spot.coverImage}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        location = EXCLUDED.location,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        wind_safety = EXCLUDED.wind_safety
    `;
    console.log(`  ${spot.id} — ${spot.name} (${spot.lat}, ${spot.lng})`);
  }
}

async function seedAdmin(email: string, requestedPassword?: string, nome?: string) {
  const existing = await sql`SELECT id, role FROM users WHERE LOWER(email) = ${email} LIMIT 1`;

  if (existing.length > 0) {
    const row = existing[0] as Record<string, unknown>;
    if (row.role !== 'admin') {
      await sql`UPDATE users SET role = 'admin' WHERE id = ${String(row.id)}`;
      console.log(`\nAdmin: ${email} promovido a admin (conta já existia).`);
    } else {
      console.log(`\nAdmin: ${email} já existe. Senha inalterada.`);
    }
    return null;
  }

  // must_change_password=TRUE abaixo obriga a troca no primeiro login, então
  // uma senha temporária curta e memorável (ex.: pedida pelo usuário) é
  // aceitável aqui — ela nunca fica valendo por mais que um acesso.
  const password = requestedPassword ?? generatePassword();
  const hash = await bcrypt.hash(password, 12);

  // O nome do admin aparece assinando comentários, posts e avisos no app. Sem
  // `--admin-name` ele nascia como o literal 'Administrador', e a pessoa dona
  // da conta via um cargo no lugar do próprio nome em tudo que escrevia. O
  // padrão continua existindo só para não quebrar um seed sem argumento.
  const nomeAdmin = nome?.trim() || 'Administrador';

  await sql`
    INSERT INTO users (
      email, password_hash, name, role, must_change_password,
      rider_id, avatar_url, weight_kg, rider_level, home_spot, disciplines, bio
    ) VALUES (
      ${email}, ${hash}, ${nomeAdmin}, 'admin', TRUE,
      '0001', ${`https://api.dicebear.com/7.x/bottts/svg?seed=admin`},
      78, 'Avançado', 'Praia Ponta do Mel',
      ${['Kitesurf Twintip']}, ${`Perfil de ${nomeAdmin}`}
    )
  `;

  return password;
}

async function seedEvents() {
  const count = await sql`SELECT COUNT(*)::int AS n FROM events`;
  if (Number((count[0] as Record<string, unknown>).n) > 0) {
    console.log('\nEventos: já existem, nada a fazer.');
    return;
  }

  console.log(`\nEventos (${INITIAL_EVENTS.length})...`);
  for (const ev of INITIAL_EVENTS) {
    await sql`
      INSERT INTO events (title, event_date, location, spot_name, type, description, organizer, image_url)
      VALUES (${ev.title}, ${ev.date}, ${ev.location}, ${ev.spotName ?? null},
              ${ev.type}, ${ev.description}, ${ev.organizer}, ${ev.imageUrl ?? null})
    `;
    console.log(`  ${ev.title}`);
  }
}

async function main() {
  const email = (arg('admin-email') ?? '').toLowerCase().trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    console.error('ERRO: informe --admin-email=seu@email.com');
    process.exit(1);
  }
  const requestedPassword = arg('admin-password');

  await seedSpots();
  await seedEvents();
  const password = await seedAdmin(email, requestedPassword, arg('admin-name'));

  console.log('\n' + '='.repeat(62));
  if (password) {
    console.log('CONTA ADMIN CRIADA');
    console.log(`  email: ${email}`);
    console.log(`  senha: ${password}`);
    console.log('  Troque a senha no primeiro login (must_change_password = true).');
  }
  console.log('='.repeat(62));
  console.log('Seed concluído.');
}

main();
