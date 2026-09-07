import { handle } from '@/lib/api';
import {
  HttpError,
  createPasswordResetToken,
  invalidateAllUserSessions,
  requireAdmin,
} from '@/lib/auth';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * O administrador gera um link de redefinição de senha para um velejador.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *
 * O painel tinha um botão de chave que o dono usava como "redefinir senha" —
 * mas ele só ligava `must_change_password`, que EXIGE a troca no próximo
 * login. Para quem esqueceu a senha isso não serve para nada: a pessoa não
 * consegue chegar ao próximo login. Foi exatamente o relato — o velejador
 * continuava recebendo erro de credencial depois do "reset".
 *
 * E o caminho de autoatendimento ("esqueci minha senha") também não fecha
 * sozinho: `POST /api/auth/recover-password` cria o token, mas **não existe
 * envio de e-mail neste projeto** — em produção o token é gerado e nunca
 * chega a ninguém.
 *
 * POR QUE UM LINK, E NÃO UMA SENHA TEMPORÁRIA
 *
 * Uma senha temporária precisa ser dita à pessoa por WhatsApp, e aí ela mora
 * para sempre naquela conversa. Um link expira em 2h, serve UMA vez, e quem
 * escolhe a senha nova é o dono da conta — a senha nunca existe em texto puro
 * em lugar nenhum.
 *
 * Reaproveita `createPasswordResetToken`, a mesma máquina do fluxo de
 * autoatendimento (token guardado como hash, tokens anteriores invalidados).
 * Nada de mecanismo paralelo para divergir depois.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireAdmin();
    const { id } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'ID de usuário inválido.');

    const rows = await sql`SELECT email, name, is_active FROM users WHERE id = ${id} LIMIT 1`;
    if (rows.length === 0) throw new HttpError(404, 'Usuário não encontrado.');
    const u = rows[0] as Record<string, unknown>;

    /*
     * Conta suspensa não gera link: `createPasswordResetToken` filtra por
     * `is_active = TRUE` e devolveria null, e o admin ficaria olhando um erro
     * genérico sem saber que o problema é a suspensão. Dizer qual é o
     * problema é o que evita a segunda mensagem de "não funcionou".
     */
    if (!u.is_active) {
      throw new HttpError(
        409,
        'Esta conta está suspensa. Reative o velejador antes de redefinir a senha.'
      );
    }

    const token = await createPasswordResetToken(String(u.email));
    if (!token) throw new HttpError(409, 'Não foi possível gerar o link para esta conta.');

    /*
     * Derruba as sessões abertas: se a senha vai ser trocada porque a pessoa
     * perdeu o acesso, qualquer sessão ainda viva em outro aparelho é
     * justamente o que não deveria continuar de pé.
     */
    await invalidateAllUserSessions(id);

    return {
      nome: String(u.name),
      // Absoluto e montado a partir da requisição: o admin vai COLAR isto num
      // WhatsApp, e um caminho relativo não vira link clicável lá.
      url: new URL(`/recuperar-senha/${token}`, request.url).toString(),
      validoPorHoras: 2,
    };
  });
}
