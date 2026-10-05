/**
 * Expurgos preguiçosos: apagam dado que já cumpriu o papel, sem cron.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 *
 * Duas tabelas só cresciam, porque nada no código as apagava:
 *
 *  - `velejo_apoio_posicoes` (T04): uma posição de GPS a cada 45 s de quem
 *    ligou o link de apoio em terra. O link vale 12 h, mas o rastro de por onde
 *    a pessoa andou ficava para sempre. É dado de localização de gente real, e
 *    o Neon gratuito tem 0,5 GB.
 *  - `auth_sessions` (T12): a sessão que vence sozinha (30 dias, ou 12 h na do
 *    convidado) deixa de valer em `getSessionUser`, mas a linha continuava lá.
 *    Só logout, troca de senha e invalidação explícita apagavam.
 *
 * COMO: o mesmo padrão do "Expurgo preguiçoso" de `enforceRateLimitCompartilhado`
 * (lib/rateLimit.ts). A Vercel Hobby só tem cron diário e o plano do Neon é
 * gratuito, então a limpeza pega carona numa requisição que JÁ vai ao banco,
 * no máximo uma vez por hora por instância. Custo no Neon: no pior caso, um
 * DELETE por hora por instância serverless, e só quando alguém usa a rota
 * escolhida. A checagem de "já passou uma hora?" é uma comparação em memória:
 * as demais requisições não pagam nada.
 *
 * NÃO BLOQUEIA A RESPOSTA, e roda em `after()` (Next) e não numa Promise solta:
 * na Vercel o processo pode ser congelado assim que a resposta sai, e uma
 * Promise sem await arriscaria nunca terminar — é o raciocínio de
 * app/api/chat/messages/route.ts. Fora de uma requisição (testes), `after()`
 * lança, e então a promessa roda solta, rastreada para o teste poder esperá-la.
 *
 * FALHA NUNCA ESTOURA NA CARA DE QUEM PEDIU: o erro vai para
 * `lib/observabilidade.ts` (agrupado por impressão digital, então um banco
 * fora do ar não vira uma enxurrada de linhas) e a resposta segue normal.
 */
import { after } from 'next/server';
import { sql } from './db';
import { registrarErro } from './observabilidade';

/** No máximo uma execução por hora, por instância e por expurgo. */
export const INTERVALO_EXPURGO_MS = 60 * 60 * 1000;

/**
 * Quanto tempo as posições do link de apoio sobrevivem DEPOIS de a validade do
 * link terminar. 24 h dão folga para o amigo que estava no carro rever o
 * trajeto e para um suporte olhar uma queixa do dia anterior; passado isso o
 * rastro não serve a ninguém e só pesa na privacidade.
 */
export const RETENCAO_POSICOES_APOIO_HORAS = 24;

const ultimaExecucao = new Map<string, number>();
const emAndamento = new Set<Promise<void>>();

/** Só para testes: volta ao estado de instância recém-iniciada. */
export function reiniciarExpurgos(): void {
  ultimaExecucao.clear();
}

/** Só para testes: espera os expurgos disparados em segundo plano. */
export async function aguardarExpurgos(): Promise<void> {
  await Promise.all([...emAndamento]);
}

/**
 * Apaga as posições do link de apoio cuja sessão teve a validade encerrada há
 * mais de RETENCAO_POSICOES_APOIO_HORAS.
 *
 * "Validade encerrada" é o que vier primeiro entre `expira_em` (as 12 h
 * vencendo) e `encerrado_em` (o velejador saiu da água e o link morreu junto).
 * Olhar só `expira_em` guardaria por até 12 h a mais o rastro de quem encerrou
 * cedo; olhar só `encerrado_em` nunca apagaria a sessão que venceu com o
 * velejo ainda aberto. Por isso o LEAST, com o COALESCE para quem ainda não
 * encerrou: sobra `expira_em`.
 *
 * Só as posições são apagadas. A linha da sessão não tem localização (token em
 * hash e datas) e fica para o histórico de quem a abriu.
 */
export async function apagarPosicoesApoioVencidas(): Promise<void> {
  await sql`
    DELETE FROM velejo_apoio_posicoes
    WHERE sessao_id IN (
      SELECT id
      FROM velejo_apoio_sessoes
      WHERE LEAST(expira_em, COALESCE(encerrado_em, expira_em))
            < NOW() - ${RETENCAO_POSICOES_APOIO_HORAS}::int * INTERVAL '1 hour'
    )
  `;
}

/**
 * Apaga as sessões de login que já venceram. `getSessionUser` já as recusa
 * (`expires_at > NOW()`), então apagar não muda comportamento nenhum: só devolve
 * espaço e tira da lista de aparelhos conectados o que já não conecta.
 */
export async function apagarSessoesExpiradas(): Promise<void> {
  await sql`DELETE FROM auth_sessions WHERE expires_at < NOW()`;
}

function agendar(nome: string, executar: () => Promise<void>): void {
  const agora = Date.now();
  if (agora - (ultimaExecucao.get(nome) ?? 0) < INTERVALO_EXPURGO_MS) return;
  // Marca já, antes de rodar: duas requisições simultâneas não disparam dois.
  // Se a consulta falhar, a próxima tentativa fica para daqui a uma hora, igual
  // ao expurgo de rate_limit_tentativas — não vale martelar um banco com defeito.
  ultimaExecucao.set(nome, agora);

  const rodar = (): Promise<void> => {
    const p: Promise<void> = executar()
      .catch((erro) => registrarErro({ origem: 'servidor', rota: `expurgo:${nome}`, erro }))
      .finally(() => {
        emAndamento.delete(p);
      });
    emAndamento.add(p);
    return p;
  };

  try {
    after(rodar);
  } catch {
    // Fora de uma requisição do Next (testes, scripts): sem `after`, roda solto.
    void rodar();
  }
}

/** Pega carona numa requisição de posição/abertura do link de apoio (T04). */
export function expurgarPosicoesApoioSePreciso(): void {
  agendar('posicoes_apoio', apagarPosicoesApoioVencidas);
}

/**
 * Pega carona num login (T12). Escolhido de propósito: login é onde a tabela
 * GANHA linhas, então a limpeza anda na mesma proporção do crescimento, e é uma
 * rota esporádica que já faz várias idas ao banco (usuário, hash, sessão). Não
 * vai em getSessionUser, que roda a cada requisição de cada usuário: mesmo com
 * a trava de uma hora seria código no caminho mais quente do app só para uma
 * limpeza que acontece de qualquer jeito no próximo login.
 */
export function expurgarSessoesExpiradasSePreciso(): void {
  agendar('auth_sessions', apagarSessoesExpiradas);
}
