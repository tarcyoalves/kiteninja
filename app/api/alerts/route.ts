import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { HttpError } from '@/lib/auth';
import { str } from '@/lib/validation';

export async function GET() {
  return handle(async () => {
    await requireUser();

    const rows = await sql`
      SELECT
        sa.id,
        sa.title,
        sa.spot_name,
        sa.severity,
        sa.description,
        sa.status,
        sa.created_at,
        u.name AS reported_by
      FROM safety_alerts sa
      JOIN users u ON u.id = sa.user_id
      WHERE sa.status = 'Ativo'
      ORDER BY sa.created_at DESC
    `;

    const alerts = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        title: String(r.title),
        spotName: String(r.spot_name),
        severity: r.severity as 'alerta' | 'perigo' | 'informativo',
        description: String(r.description),
        reportedBy: String(r.reported_by),
        timestamp: String(r.created_at),
        status: r.status as 'Ativo' | 'Resolvido',
      };
    });

    return { alerts };
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const title = str(body, 'title', { max: 200 });
    const spotName = str(body, 'spotName', { max: 200 });
    const severity = str(body, 'severity', { max: 20 });
    const description = str(body, 'description', { max: 2000 });

    // Validate severity
    if (!['alerta', 'perigo', 'informativo'].includes(severity)) {
      throw new HttpError(400, 'Severity inválido. Valores aceitos: alerta, perigo, informativo.');
    }

    const inserted = await sql`
      INSERT INTO safety_alerts (user_id, title, spot_name, severity, description, status)
      VALUES (${user.id}, ${title}, ${spotName}, ${severity}, ${description}, 'Ativo')
      RETURNING id
    `;

    return { id: String((inserted[0] as Record<string, unknown>).id) };
  });
}
