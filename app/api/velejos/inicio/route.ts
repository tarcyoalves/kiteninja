import { handle, readOptionalJson } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { str } from '@/lib/validation';
import { rateLimiters } from '@/lib/rateLimit';
import { avisarSeguidoresDeInicio } from '@/lib/notificacoes';

/**
 * "Entrei na água agora" — avisa quem segue o velejador.
 *
 * POR QUE ESTA ROTA EXISTE: até aqui, tocar em "Iniciar velejo" só trocava de
 * aba no cliente. Nada chegava ao servidor, então não havia evento nenhum em
 * que pendurar o aviso aos amigos.
 *
 * ESCOPO DELIBERADO — só avisa, não cria estado. Não existe tabela de "velejo
 * ao vivo", nem sessão aberta a encerrar, nem ciclo de vida a manter. O
 * logbook continua sendo registrado DEPOIS, como sempre foi
 * (POST /api/sessions). Se um dia o produto quiser "quem está velejando
 * agora" no mapa, aí sim entra estado — e essa é uma decisão diferente, não
 * um detalhe desta.
 *
 * Consequência aceita: o servidor não sabe quando o velejo termina. Para o
 * que a funcionalidade promete ("avise meus amigos que entrei na água"), não
 * precisa saber.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireUser();

    // Teto por usuário além da janela anti-repetição de avisoVelejo.ts: aquela
    // protege os SEGUIDORES de aviso repetido, esta protege o SERVIDOR de um
    // cliente em laço de erro. São problemas diferentes e os dois existem.
    rateLimiters.velejoInicio(user.id);

    const body = await readOptionalJson(request);
    const spotNome = str(body, 'spotNome', { optional: true, max: 120 });

    const resultado = await avisarSeguidoresDeInicio({
      actorId: user.id,
      tipo: 'velejo_iniciado',
      spotNome,
    });

    // Devolve o resultado honesto (inclusive `motivo`) em vez de um `ok: true`
    // genérico: sem isso, "não recebi aviso nenhum" seria indistinguível de
    // "ninguém te segue" ou "você já tinha avisado há pouco", e o suporte
    // viraria adivinhação — o mesmo problema que o rastreio nativo teve.
    return resultado;
  });
}
