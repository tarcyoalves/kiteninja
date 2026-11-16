import { handle } from '@/lib/api';
import {
  HttpError,
  generatePassword,
  hashPassword,
  invalidateAllUserSessions,
  requireAdmin,
} from '@/lib/auth';
import { sql } from '@/lib/db';
import { registrarAcaoAdmin } from '@/lib/auditoriaAdmin';
import { limparFalhasLogin } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

/**
 * O administrador define uma SENHA PROVISÓRIA para o velejador.
 *
 * O PROBLEMA QUE ISTO RESOLVE (relato do dono, 16/11/2026)
 *
 * O painel tinha o botão "Exigir troca", e o dono o usava para redefinir a
 * senha de quem esqueceu: o painel dizia "Foi exigida a troca de senha", e o
 * velejador continuava recebendo "senha errada". O botão só ligava
 * `must_change_password` — a troca é cobrada DEPOIS de entrar com a senha
 * atual, que é justamente o que a pessoa não sabe. Não redefinia nada.
 *
 * Agora: o servidor sorteia uma senha provisória, grava o hash e liga
 * `must_change_password`. O admin manda a senha ao velejador, ele entra com
 * ela e o app o obriga a criar a dele na hora — e desde 13/11 essa obrigação
 * é cobrada no servidor (`requireUser` recusa tudo menos trocar a senha), não
 * só na tela. A provisória vale até esse primeiro acesso.
 *
 * Convive com o "Nova senha" (link de uso único, 2h): o link é melhor quando
 * dá para mandar; a provisória é o caminho que o dono já espera e que funciona
 * mesmo que o velejador abra o link num aparelho e o app em outro.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new HttpError(400, 'ID de usuário inválido.');
    }
    // A própria conta: a provisória derrubaria a sessão do admin no meio do
    // painel. Para si mesmo, o caminho é trocar a senha pelo perfil.
    if (id === admin.id) {
      throw new HttpError(400, 'Para a sua própria conta, troque a senha pelo seu perfil.');
    }

    const rows = await sql`SELECT email, name, is_active FROM users WHERE id = ${id} LIMIT 1`;
    if (rows.length === 0) throw new HttpError(404, 'Usuário não encontrado.');
    const u = rows[0] as Record<string, unknown>;
    if (!u.is_active) {
      throw new HttpError(
        409,
        'Esta conta está suspensa. Reative o velejador antes de redefinir a senha.'
      );
    }

    const provisoria = generatePassword();
    await sql`
      UPDATE users
      SET password_hash = ${await hashPassword(provisoria)},
          must_change_password = TRUE,
          updated_at = NOW()
      WHERE id = ${id}
    `;
    // Links de redefinição pendentes deixam de valer: senão um link antigo
    // trocaria a senha por cima da provisória que o admin acabou de mandar.
    await sql`
      UPDATE password_reset_tokens SET used_at = NOW()
      WHERE user_id = ${id} AND used_at IS NULL
    `;
    // Sessões abertas caem (a senha mudou) e as tentativas erradas de quem
    // estava chutando a senha antiga deixam de bloquear o login.
    await invalidateAllUserSessions(id);
    await limparFalhasLogin(String(u.email));

    // Auditoria registra QUE foi feito, nunca a senha.
    await registrarAcaoAdmin(admin.id, 'admin.usuario.senha_provisoria', id, {
      trocaObrigatoria: true,
      sessoesEncerradas: true,
    }, request);

    return {
      nome: String(u.name),
      email: String(u.email),
      senhaProvisoria: provisoria,
    };
  });
}
