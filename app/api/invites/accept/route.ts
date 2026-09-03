import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import {
  HttpError,
  consumeInvite,
  createSession,
  findUsableInvite,
  hashPassword,
} from '@/lib/auth';
import { rateLimiters } from '@/lib/rateLimit';
import { bool, email as parseEmail, num, oneOf, password, str } from '@/lib/validation';
import type { Discipline, RiderLevel } from '@/types';

const LEVELS = ['Iniciante', 'Intermediário', 'Avançado', 'Profissional'] as const;
const DISCIPLINES = [
  'Kitesurf Twintip',
  'Kitesurf Strapless Wave',
  'Hydrofoil',
  'Wingfoil',
  'Big Air',
] as const;

/**
 * Cria a conta a partir de um link de convite. O token é consumido antes do
 * INSERT falhar poder deixar o convite queimado sem conta — a ordem é:
 * valida -> cria usuário -> consome. Se o consumo falhar (corrida), desfazemos
 * o usuário criado.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const ip = request.headers.get('x-forwarded-for') || 'unknown-ip';
    await rateLimiters.invite(ip);

    const body = await readJson(request);
    const token = str(body, 'token', { max: 200 });


    const invite = await findUsableInvite(token);
    if (!invite) {
      throw new HttpError(400, 'Convite inválido, expirado ou já utilizado.');
    }

    const email = parseEmail(body);
    // Convite emitido para um email específico só serve para aquele email.
    if (invite.email && invite.email !== email) {
      throw new HttpError(403, 'Este convite foi emitido para outro endereço de email.');
    }

    const plain = password(body);
    const name = str(body, 'name', { min: 2, max: 120 });
    const weightKg = num(body, 'weightKg', { min: 30, max: 200, optional: true }) ?? 75;
    const riderLevel = oneOf<RiderLevel>(body, 'riderLevel', LEVELS, 'Intermediário');
    const homeSpot = str(body, 'homeSpot', { optional: true, max: 120 });

    /**
     * Contato de emergência já no cadastro — quem avisar se algo der errado na
     * água. Coletar aqui, e não só depois nas configurações, porque quem entra
     * no app não volta para preencher campo de segurança: o SOS pode ser
     * acionado na primeira sessão, e sem contato o painel do acidentado não tem
     * para quem mandar a posição.
     *
     * `optional` de propósito: bloquear a criação da conta por causa deste
     * campo empurraria o velejador a inventar um número qualquer para passar da
     * tela — pior que o campo vazio, porque um número falso parece cobertura.
     * Mesmos limites de PATCH /api/profile, para os dois caminhos aceitarem
     * exatamente o mesmo dado.
     */
    const emergencyContactName = str(body, 'emergencyContactName', { optional: true, max: 120 });
    const emergencyContactPhone = str(body, 'emergencyContactPhone', { optional: true, max: 30 });

    const rawDisciplines = (body as Record<string, unknown>)?.disciplines;
    const disciplines: Discipline[] = Array.isArray(rawDisciplines)
      ? (rawDisciplines.filter((d): d is Discipline =>
          DISCIPLINES.includes(d as (typeof DISCIPLINES)[number])
        ) as Discipline[])
      : [];
    if (disciplines.length === 0) disciplines.push('Kitesurf Twintip');

    const existing = await sql`SELECT 1 FROM users WHERE LOWER(email) = ${email} LIMIT 1`;
    if (existing.length > 0) {
      throw new HttpError(409, 'Já existe uma conta com este email.');
    }

    const passwordHash = await hashPassword(plain);
    const riderId = `${Math.floor(1000 + Math.random() * 9000)}`;
    const avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`;

    const inserted = await sql`
      INSERT INTO users (
        email, password_hash, name, role, avatar_url, rider_id,
        weight_kg, rider_level, home_spot, disciplines, bio,
        emergency_contact_name, emergency_contact_phone
      ) VALUES (
        ${email}, ${passwordHash}, ${name}, 'rider', ${avatarUrl}, ${riderId},
        ${weightKg}, ${riderLevel}, ${homeSpot || null}, ${disciplines},
        ${`Velejador no ${homeSpot || 'Litoral'}!`},
        ${emergencyContactName || null}, ${emergencyContactPhone || null}
      )
      RETURNING id
    `;
    const userId = String((inserted[0] as Record<string, unknown>).id);

    const consumed = await consumeInvite(invite.id, userId);
    if (!consumed) {
      // Outra requisição usou o mesmo link primeiro. Removemos a conta órfã.
      await sql`DELETE FROM users WHERE id = ${userId}`;
      throw new HttpError(409, 'Este convite acabou de ser utilizado.');
    }

    if (bool(body, 'signIn', true)) {
      await createSession(userId, request.headers.get('user-agent') ?? undefined);
    }

    return { user: { id: userId, email, name, role: 'rider' as const } };
  });
}
