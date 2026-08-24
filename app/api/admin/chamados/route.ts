import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import type { ChamadoAdmin, StatusChamado } from '@/types';

const STATUS_VALIDOS: readonly StatusChamado[] = [
  'novo',
  'em_analise',
  'aprovado',
  'rejeitado',
  'implementado',
];

interface ChamadoAdminRow {
  id: unknown;
  tipo: unknown;
  titulo: unknown;
  descricao: unknown;
  tela: unknown;
  status: unknown;
  parecer: unknown;
  created_at: unknown;
  autor_id: unknown;
  autor_nome: unknown;
  autor_avatar_url: unknown;
}

/**
 * Lista TODOS os chamados para o dono revisar — nunca disponível para quem
 * não é admin (chamado é decisão de produto/roadmap, não moderação de
 * conteúdo comum, por isso requireAdmin e não canModerate).
 *
 * `?status=` filtra por status; um valor fora dos 5 válidos é IGNORADO (não
 * vira 400) — mesmo espírito tolerante de parseCursor em app/api/feed/route.ts.
 */
export async function GET(request: Request) {
  return handle(async () => {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const statusBruto = searchParams.get('status');
    const status =
      statusBruto && (STATUS_VALIDOS as readonly string[]).includes(statusBruto)
        ? (statusBruto as StatusChamado)
        : null;

    const rows = status
      ? await sql`
          SELECT c.id, c.tipo, c.titulo, c.descricao, c.tela, c.status, c.parecer, c.created_at,
                 u.id AS autor_id, u.name AS autor_nome, u.avatar_url AS autor_avatar_url
          FROM chamados c
          JOIN users u ON u.id = c.user_id
          WHERE c.status = ${status}
          ORDER BY c.created_at DESC
        `
      : await sql`
          SELECT c.id, c.tipo, c.titulo, c.descricao, c.tela, c.status, c.parecer, c.created_at,
                 u.id AS autor_id, u.name AS autor_nome, u.avatar_url AS autor_avatar_url
          FROM chamados c
          JOIN users u ON u.id = c.user_id
          ORDER BY c.created_at DESC
        `;

    const chamados: ChamadoAdmin[] = (rows as ChamadoAdminRow[]).map((r) => ({
      id: String(r.id),
      tipo: r.tipo as ChamadoAdmin['tipo'],
      titulo: String(r.titulo),
      descricao: String(r.descricao),
      tela: r.tela ? String(r.tela) : undefined,
      status: r.status as ChamadoAdmin['status'],
      parecer: r.parecer ? String(r.parecer) : undefined,
      createdAt: String(r.created_at),
      autorId: String(r.autor_id),
      autorNome: String(r.autor_nome),
      autorAvatarUrl: r.autor_avatar_url ? String(r.autor_avatar_url) : undefined,
    }));

    return { chamados };
  });
}
