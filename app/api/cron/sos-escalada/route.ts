import { handle } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { varrerEscaladas } from '@/lib/sosEscalada';
import { registrarVarreduraDoCron } from '@/lib/sosVarredura';
import { logSos } from '@/lib/sosLog';

export const dynamic = 'force-dynamic';

/**
 * Varredura periódica de escaladas de SOS.
 *
 * Existe porque a escalada estava acoplada a `GET /api/sos/active`, que só roda
 * quando alguém tem o app aberto E só enxerga os SOS daquele usuário. Um
 * pedido de socorro sem vizinhos online ficava travado em 5 km indefinidamente
 * (item 6 da revisão). Ver lib/sosEscalada.ts para o raciocínio completo.
 *
 * SEGURANÇA — esta rota é exposta na internet e dispara notificações push.
 * Sem autenticação, qualquer um poderia chamá-la em loop para gerar rajada de
 * push (abuso) ou forçar ampliação de raio antes da hora. Por isso:
 *
 *  - exige `Authorization: Bearer $CRON_SECRET`;
 *  - se `CRON_SECRET` não estiver configurada, a rota RECUSA tudo (503) em vez
 *    de liberar acesso. Falhar fechado é obrigatório aqui: uma variável
 *    esquecida no deploy não pode virar endpoint aberto.
 *
 * A Vercel envia esse header automaticamente para Cron Jobs quando
 * CRON_SECRET existe no projeto.
 *
 * IMPORTANTE (limite de plano): no plano Hobby os Cron Jobs da Vercel rodam no
 * máximo UMA VEZ POR DIA, o que é inútil para uma emergência de minutos. A
 * escalada preguiçosa em /api/sos/active foi mantida justamente por isso — as
 * duas chamam o mesmo motor idempotente, então rodar as duas não escala em
 * dobro. Para escalada confiável em minutos é preciso plano Pro (cron por
 * minuto) ou um acionador externo batendo nesta rota. Está registrado em
 * docs/OPERACAO-SOS.md.
 *
 * Desde a T01 (plano de 05/10/2026) o polling de /api/sos/active também puxa a
 * varredura GLOBAL, no máximo uma vez por minuto (lib/sosVarredura.ts), e esta
 * rota anota o último sinal de vida na mesma linha que o polling. O passo a
 * passo do agendador externo está em docs/CRON-EXTERNO-SOS.md.
 */
export async function GET(request: Request) {
  return handle(async () => {
    const segredo = process.env.CRON_SECRET;

    if (!segredo) {
      // Fail-closed: sem segredo configurado, ninguém entra.
      logSos({ etapa: 'erro', detalhe: { onde: 'cron', motivo: 'CRON_SECRET ausente' } });
      throw new HttpError(503, 'Varredura não configurada.');
    }

    const header = request.headers.get('authorization') ?? '';
    if (header !== `Bearer ${segredo}`) {
      // Mensagem genérica: não confirma se o segredo existe nem seu formato.
      throw new HttpError(401, 'Não autorizado.');
    }

    const inicio = Date.now();
    const resumo = await varrerEscaladas();

    // Anota o "último sinal de vida" no mesmo lugar em que a varredura do
    // polling anota (lib/sosVarredura.ts): o painel admin mostra há quantos
    // minutos o SOS foi varrido por QUALQUER das duas fontes. Não lança.
    await registrarVarreduraDoCron(resumo);

    logSos({
      etapa: resumo.erros > 0 ? 'erro' : 'escalada',
      detalhe: {
        onde: 'cron',
        examinados: resumo.examinados,
        escalados: resumo.escalados.length,
        erros: resumo.erros,
        duracaoMs: Date.now() - inicio,
      },
    });

    return {
      ok: true,
      examinados: resumo.examinados,
      escalados: resumo.escalados.length,
      erros: resumo.erros,
    };
  });
}
