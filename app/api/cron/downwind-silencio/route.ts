import { handle } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { varrerSilencos, limparAlertasAntigos, encerrarAbandonados } from '@/lib/downwindSilencio';

/**
 * Varredura periódica de silêncios em downwinds.
 *
 * Detecta velejadores que param de reportar posição num downwind em andamento
 * e notifica organizadores e apoio designado.
 *
 * SEGURANÇA — esta rota é exposta na internet e dispara notificações push.
 * Sem autenticação, qualquer um poderia chamá-la em loop para gerar rajada de
 * push (abuso). Por isso:
 *
 *  - exige `Authorization: Bearer $CRON_SECRET`;
 *  - se `CRON_SECRET` não estiver configurada, a rota RECUSA tudo (503) em vez
 *    de liberar acesso. Falhar fechado é obrigatório aqui: uma variável
 *    esquecida no deploy não pode virar endpoint aberto.
 *
 * A Vercel envia esse header automaticamente para Cron Jobs quando
 * CRON_SECRET existe no projeto.
 *
 * AGENDAMENTO: ver docs/RASTREIO-BACKGROUND-ANDROID-LIMITACOES.md.
 * O plano Hobby da Vercel só aceita cron DIÁRIO (`vercel.json` agenda esta
 * rota em `0 4 * * *`, só como manutenção/fallback). A varredura frequente
 * de verdade roda via `.github/workflows/cron-varredura.yml` (GitHub
 * Actions, a cada 5 minutos), batendo neste mesmo endpoint com o header
 * Authorization abaixo.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return handle(async () => {
    const segredo = process.env.CRON_SECRET;

    if (!segredo) {
      console.warn('[cron/downwind-silencio] CRON_SECRET não configurado, recusando acesso');
      throw new HttpError(503, 'Varredura não configurada.');
    }

    const header = request.headers.get('authorization') ?? '';
    if (header !== `Bearer ${segredo}`) {
      throw new HttpError(401, 'Não autorizado.');
    }

    const inicio = Date.now();

    // 1. Varre silêncios
    const resumo = await varrerSilencos();

    // 2. Limpa alertas antigos (resolvedos há mais de 7 dias)
    /*
     * Encerra as travessias que ninguém encerrou e grava o resumo delas.
     * Sem isto, `resumirEPurgar` nunca roda para um downwind abandonado e a
     * distância/velocidade/trilha do velejador ficam NULL para sempre — a
     * travessia não fica registrada. Ver lib/downwindAbandono.ts.
     */
    const abandonados = await encerrarAbandonados();

    const limpos = await limparAlertasAntigos(7);

    const duracaoMs = Date.now() - inicio;

    console.log(`[cron/downwind-silencio] ${resumo.examinados} participantes verificados, ${resumo.silencios.length} alertas detectados, ${resumo.erros} erros, ${abandonados.encerrados.length} abandonados encerrados, ${limpos} alertas antigos limpos (${duracaoMs}ms)`);

    return {
      ok: true,
      examinados: resumo.examinados,
      silencios: resumo.silencios.length,
      erros: resumo.erros,
      abandonadosEncerrados: abandonados.encerrados.length,
      limpos,
      duracaoMs,
    };
  });
}
