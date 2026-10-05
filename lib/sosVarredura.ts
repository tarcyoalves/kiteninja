import { sql } from './db';
import { registrarErro } from './observabilidade';
import { varrerEscaladas, type ResumoVarredura } from './sosEscalada';

/**
 * Quando a varredura de escalada do SOS roda, e como o dono descobre se ela
 * parou.
 *
 * POR QUE ISTO EXISTE (T01 do plano de 05/10/2026)
 *
 * A escalada amplia o raio de um pedido de socorro sem resposta (5 -> 15 ->
 * 50 km a cada 2 min), mas só anda quando alguém chama `varrerEscaladas()`. O
 * cron da Vercel Hobby roda 1x por dia e o do GitHub Actions, medido, a cada
 * 3 a 6 horas. Um SOS disparado às 17h05 teria a primeira ampliação depois da
 * meia-noite — na água, o mesmo que não ter escalada.
 *
 * O caminho que sobra e que SEMPRE tem alguém por perto é o polling: todo
 * cliente com o app aberto chama `GET /api/sos/active` a cada 12 s. Esta
 * camada deixa essa rota puxar a varredura global, no máximo uma vez por
 * minuto no app inteiro.
 *
 * DUAS TRAVAS, CADA UMA COM UM MOTIVO
 *
 *  1. Memória da instância: se ESTA instância já tentou há menos de 60 s, nem
 *     consulta o banco. Sem isto, o polling de 12 s virava uma escrita no Neon
 *     a cada chamada de cada cliente — e o Neon gratuito hiberna quando
 *     ninguém escreve. É só economia: não garante nada entre instâncias.
 *  2. Linha em `app_settings` com UPSERT condicional: é a que garante "uma
 *     vez por minuto no app inteiro" entre instâncias, porque o banco decide
 *     quem ganhou. Quem não recebe a linha de volta não varre.
 *
 * Não reduza a janela abaixo de 60 s: cada varredura que escala manda push.
 *
 * A MESMA LINHA É O "ÚLTIMO SINAL DE VIDA" que o painel admin mostra (T01c).
 * A rota de cron também a atualiza, então o painel reflete as duas fontes: se
 * o cron-job.org parar e ninguém tiver o app aberto, a linha envelhece e o
 * indicador fica vermelho. Hoje o dono não tem como saber que a escalada
 * está parada.
 *
 * A linha usa a coluna `updated_at` (e não um valor em texto dentro do JSONB)
 * porque comparar `timestamptz` com `NOW()` no próprio UPSERT dispensa cast e
 * deixa a decisão inteira numa única instrução atômica.
 */

export const CHAVE_ULTIMA_VARREDURA = 'sos_ultima_varredura';

/** Janela mínima entre duas varreduras no app inteiro. Não reduza (push). */
export const JANELA_VARREDURA_S = 60;

/** Acima disto o painel mostra a varredura como parada (vermelho). */
export const LIMITE_VARREDURA_PARADA_S = 10 * 60;

export type OrigemVarredura = 'polling' | 'cron';

export type ResultadoTentativa =
  | 'pulou_memoria'
  | 'pulou_trava'
  | 'varreu'
  | 'erro';

/** Última tentativa desta instância (ms). 0 = nunca. */
let ultimaTentativaMs = 0;

/** Só para teste: simula uma instância nova (memória vazia). */
export function reiniciarMemoriaDaInstancia(): void {
  ultimaTentativaMs = 0;
}

function resumoParaJson(resumo: ResumoVarredura) {
  return {
    examinados: resumo.examinados,
    escalados: resumo.escalados.length,
    erros: resumo.erros,
  };
}

/**
 * Chamada por `GET /api/sos/active` (dentro de `after()`): varre se for a hora.
 *
 * NUNCA lança. A resposta do polling já saiu; um erro aqui só pode virar
 * registro em `erros_registrados`. Um SOS ativo não some da tela de ninguém
 * porque a varredura falhou.
 */
export async function varrerSeForHora(agoraMs: number = Date.now()): Promise<ResultadoTentativa> {
  if (agoraMs - ultimaTentativaMs < JANELA_VARREDURA_S * 1000) {
    return 'pulou_memoria';
  }
  // Marca ANTES de consultar o banco: com vários polls chegando juntos na
  // mesma instância, só o primeiro pergunta ao banco. Marca também quando a
  // trava é perdida — se outra instância varreu agora, esta não precisa
  // perguntar de novo antes de a janela passar.
  ultimaTentativaMs = agoraMs;

  try {
    const ganhou = await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${CHAVE_ULTIMA_VARREDURA}, ${JSON.stringify({ origem: 'polling', fase: 'em_andamento' })}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = NOW()
        WHERE app_settings.updated_at < NOW() - (${JANELA_VARREDURA_S}::int * INTERVAL '1 second')
      RETURNING key
    `;
    if (ganhou.length === 0) return 'pulou_trava';

    const resumo = await varrerEscaladas();

    // Fecha a anotação da varredura SEM mexer em `updated_at` (a janela da
    // trava continua contada desde o início). O filtro por fase evita
    // sobrescrever o que o cron gravou enquanto esta varredura rodava.
    await sql`
      UPDATE app_settings
      SET value = ${JSON.stringify({ origem: 'polling', fase: 'concluida', ...resumoParaJson(resumo) })}::jsonb
      WHERE key = ${CHAVE_ULTIMA_VARREDURA}
        AND value->>'fase' = 'em_andamento'
    `;
    return 'varreu';
  } catch (erro) {
    await registrarErro({ origem: 'servidor', erro, rota: '/api/sos/active (varredura da escalada)' });
    return 'erro';
  }
}

/**
 * A rota de cron chama isto depois de varrer: a linha de "última varredura"
 * passa a refletir também o agendador externo. Sem trava (o cron já foi
 * autenticado e é o caminho principal). Não lança: falhar ao anotar não pode
 * transformar uma varredura que deu certo em 500.
 */
export async function registrarVarreduraDoCron(resumo: ResumoVarredura): Promise<void> {
  try {
    await sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${CHAVE_ULTIMA_VARREDURA}, ${JSON.stringify({ origem: 'cron', fase: 'concluida', ...resumoParaJson(resumo) })}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = NOW()
    `;
  } catch (erro) {
    await registrarErro({ origem: 'servidor', erro, rota: '/api/cron/sos-escalada (anotar varredura)' });
  }
}

export interface UltimaVarredura {
  /** null = nenhuma varredura registrada ainda. */
  em: string | null;
  /** Idade medida pelo relógio do banco (não do celular do admin). */
  segundosAtras: number | null;
  origem: OrigemVarredura | null;
  /** 'em_andamento' = começou e não terminou (pode ter falhado). */
  fase: 'em_andamento' | 'concluida' | null;
  examinados: number | null;
  escalados: number | null;
  erros: number | null;
  /** Parada: nunca rodou ou passou do limite. */
  parada: boolean;
}

/** Lê a última varredura, para o painel de saúde. Uma consulta, por índice da PK. */
export async function lerUltimaVarredura(): Promise<UltimaVarredura> {
  const linhas = await sql`
    SELECT value, updated_at,
           EXTRACT(EPOCH FROM (NOW() - updated_at)) AS segundos_atras
    FROM app_settings
    WHERE key = ${CHAVE_ULTIMA_VARREDURA}
    LIMIT 1
  `;
  if (linhas.length === 0) {
    return { em: null, segundosAtras: null, origem: null, fase: null, examinados: null, escalados: null, erros: null, parada: true };
  }
  const r = linhas[0] as Record<string, unknown>;
  const v = (r.value && typeof r.value === 'object' ? r.value : {}) as Record<string, unknown>;
  const segundosAtras = Math.max(0, Math.round(Number(r.segundos_atras)));
  const numero = (x: unknown) => (typeof x === 'number' ? x : null);
  return {
    em: new Date(String(r.updated_at)).toISOString(),
    segundosAtras,
    origem: v.origem === 'cron' || v.origem === 'polling' ? v.origem : null,
    fase: v.fase === 'em_andamento' || v.fase === 'concluida' ? v.fase : null,
    examinados: numero(v.examinados),
    escalados: numero(v.escalados),
    erros: numero(v.erros),
    parada: segundosAtras > LIMITE_VARREDURA_PARADA_S,
  };
}
