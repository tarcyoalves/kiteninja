import { handle } from '@/lib/api';
import { requireAdmin } from '@/lib/auth';
import { lerUltimaVarredura } from '@/lib/sosVarredura';

export const dynamic = 'force-dynamic';

/**
 * Saúde do que roda sozinho, para o painel admin.
 *
 * Hoje só traz a última varredura da escalada do SOS (T01c). A escalada
 * depende de alguém chamar a varredura — o cron externo ou o polling dos
 * clientes — e até aqui o dono não tinha como saber que ela estava parada
 * (o GitHub Actions rodava a cada 3 a 6 horas e nada avisava). A linha lida
 * é a mesma que as duas fontes atualizam.
 *
 * Uma consulta por PK, e o painel só chama ao abrir e no botão "atualizar":
 * nada de polling aqui, para não manter o Neon gratuito acordado.
 */
export async function GET() {
  return handle(async () => {
    await requireAdmin();
    return { sosVarredura: await lerUltimaVarredura() };
  });
}
