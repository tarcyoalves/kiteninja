import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { num, oneOf, str } from '@/lib/validation';
import type { Discipline, RiderLevel } from '@/types';

const LEVELS = ['Iniciante', 'Intermediário', 'Avançado', 'Profissional'] as const;
const DISCIPLINES = [
  'Kitesurf Twintip',
  'Kitesurf Strapless Wave',
  'Hydrofoil',
  'Wingfoil',
  'Big Air',
] as const;

/** Atualiza o próprio perfil. Não permite trocar email, role nem senha. */
export async function PATCH(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const name = str(body, 'name', { min: 2, max: 120, optional: true });
    const weightKg = num(body, 'weightKg', { min: 30, max: 200, optional: true });
    const homeSpot = str(body, 'homeSpot', { optional: true, max: 120 });
    const bio = str(body, 'bio', { optional: true, max: 500 });
    const highestJumpM = num(body, 'highestJumpM', { min: 0, max: 40, optional: true });

    const hasLevel = (body as Record<string, unknown>)?.riderLevel !== undefined;
    const riderLevel = hasLevel
      ? oneOf<RiderLevel>(body, 'riderLevel', LEVELS)
      : null;

    const rawDisciplines = (body as Record<string, unknown>)?.disciplines;
    const disciplines = Array.isArray(rawDisciplines)
      ? (rawDisciplines.filter((d): d is Discipline =>
          DISCIPLINES.includes(d as (typeof DISCIPLINES)[number])
        ) as Discipline[])
      : null;

    // COALESCE mantém o valor atual quando o campo não foi enviado.
    await sql`
      UPDATE users SET
        name           = COALESCE(${name || null}, name),
        weight_kg      = COALESCE(${weightKg}, weight_kg),
        home_spot      = COALESCE(${homeSpot || null}, home_spot),
        bio            = COALESCE(${bio || null}, bio),
        highest_jump_m = COALESCE(${highestJumpM}, highest_jump_m),
        rider_level    = COALESCE(${riderLevel}, rider_level),
        disciplines    = COALESCE(${disciplines && disciplines.length > 0 ? disciplines : null}, disciplines),
        updated_at     = NOW()
      WHERE id = ${user.id}
    `;

    return { ok: true };
  });
}
