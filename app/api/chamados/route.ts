import { sql } from '@/lib/db';
import { handle, readJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { oneOf, str } from '@/lib/validation';
import type { MeuChamado, TipoChamado } from '@/types';

interface ChamadoRow {
  id: unknown;
  tipo: unknown;
  titulo: unknown;
  descricao: unknown;
  tela: unknown;
  status: unknown;
  parecer: unknown;
  created_at: unknown;
}

function paraMeuChamado(r: ChamadoRow): MeuChamado {
  return {
    id: String(r.id),
    tipo: r.tipo as MeuChamado['tipo'],
    titulo: String(r.titulo),
    descricao: String(r.descricao),
    tela: r.tela ? String(r.tela) : undefined,
    status: r.status as MeuChamado['status'],
    parecer: r.parecer ? String(r.parecer) : undefined,
    createdAt: String(r.created_at),
  };
}

/**
 * Lista só os PRÓPRIOS chamados do usuário logado — nunca aceita um userId
 * vindo do cliente, sempre `user_id = user.id`.
 */
export async function GET() {
  return handle(async () => {
    const user = await requireUser();

    const rows = await sql`
      SELECT id, tipo, titulo, descricao, tela, status, parecer, created_at
      FROM chamados
      WHERE user_id = ${user.id}
      ORDER BY created_at DESC
    `;

    return { chamados: (rows as ChamadoRow[]).map(paraMeuChamado) };
  });
}

/**
 * Registra um novo chamado (bug/melhoria). Nasce sempre com status = 'novo'
 * e parecer nulo (padrões da coluna) — o cliente NUNCA pode se auto-aprovar
 * ou inventar um parecer; isso só existe nas rotas /admin/chamados/*.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readJson(request);

    const tipo = oneOf<TipoChamado>(body, 'tipo', ['bug', 'melhoria']);
    const titulo = str(body, 'titulo', { min: 3, max: 140 });
    const descricao = str(body, 'descricao', { min: 10, max: 2000 });
    const tela = str(body, 'tela', { optional: true, max: 60 });

    const rows = await sql`
      INSERT INTO chamados (user_id, tipo, titulo, descricao, tela)
      VALUES (${user.id}, ${tipo}, ${titulo}, ${descricao}, ${tela || null})
      RETURNING id, tipo, titulo, descricao, tela, status, parecer, created_at
    `;

    return paraMeuChamado(rows[0] as ChamadoRow);
  });
}
