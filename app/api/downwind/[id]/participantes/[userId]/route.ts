import { sql } from '@/lib/db';
import { handle, readOptionalJson } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { num, oneOf } from '@/lib/validation';
import { amostrarTrilha } from '@/lib/trilhaDownwind';
import type { PontoTrilha } from '@/lib/trilhaDownwind';
import {
  apoioValido,
  podeDefinirApoio,
  podeMudarEstadoDeParticipante,
} from '@/lib/downwindAcesso';
import { buscarParticipacao, ehUuid, listarParticipantes, resumirEPurgar } from '@/lib/downwindDb';
import { podeEncerrarDownwind } from '@/lib/downwind';

export const dynamic = 'force-dynamic';

const ESTADOS = ['confirmado', 'navegando', 'encerrado', 'desistiu'] as const;
const LIMITE_TRILHA_RESUMO = 200;

interface Params {
  params: Promise<{ id: string; userId: string }>;
}

/**
 * Muda o estado de um participante e/ou o carro de apoio designado.
 *
 * Os dois campos são opcionais e podem vir juntos ou separados — a UI usa
 * isso em momentos diferentes (o próprio velejador muda seu estado; o
 * organizador designa apoio por todos), mas a rota não exige um sem o outro.
 */
export async function PATCH(request: Request, ctx: Params) {
  return handle(async () => {
    const user = await requireUser();
    const { id, userId: alvoUserId } = await ctx.params;
    if (!ehUuid(id) || !ehUuid(alvoUserId)) throw new HttpError(404, 'Downwind não encontrado.');

    const minhaParticipacao = await buscarParticipacao(id, user.id);
    if (!minhaParticipacao) throw new HttpError(404, 'Downwind não encontrado.');

    const alvoParticipacao =
      alvoUserId === user.id ? minhaParticipacao : await buscarParticipacao(id, alvoUserId);
    if (!alvoParticipacao) throw new HttpError(404, 'Participante não encontrado.');

    const body = await readOptionalJson(request);
    const raw = body as Record<string, unknown> | null;

    let novoEstado: (typeof ESTADOS)[number] | undefined;
    let distanciaKm: number | null | undefined;
    let velocidadeMaxNos: number | null | undefined;
    let trilhaReduzida: PontoTrilha[] | undefined;

    if (raw?.estado !== undefined) {
      novoEstado = oneOf(body, 'estado', ESTADOS);

      const veredito = podeMudarEstadoDeParticipante({
        solicitanteId: user.id,
        solicitanteEhOrganizador: minhaParticipacao.ehOrganizador,
        alvoUserId,
        estadoAtual: alvoParticipacao.estado,
        novoEstado,
      });
      if (!veredito.permitido) throw new HttpError(veredito.status, veredito.mensagem);

      // O resumo (distanciaKm/velocidadeMaxNos, medidos pelo próprio aparelho
      // via lib/useTrilhaSessao.ts) só é aceito ao ENCERRAR a própria
      // travessia — vindo de terceiro não tem como confiar na medição de
      // outro celular, e o organizador marcando alguém como encerrado não
      // tem esses números para mandar.
      if (
        (novoEstado === 'encerrado' || novoEstado === 'desistiu') &&
        alvoUserId === user.id
      ) {
        distanciaKm = num(body, 'distanciaKm', { optional: true, min: 0, max: 1000 });
        velocidadeMaxNos = num(body, 'velocidadeMaxNos', { optional: true, min: 0, max: 90 });
        if (Array.isArray(raw?.trilhaReduzida)) {
          // Excedente é descartado, não rejeita a requisição — mesmo espírito
          // de clampQuiverKites em lib/validation.ts.
          const bruta = (raw.trilhaReduzida as unknown[])
            .filter(
              (p): p is PontoTrilha =>
                Array.isArray(p) &&
                p.length === 3 &&
                p.every((n) => typeof n === 'number' && Number.isFinite(n))
            );
          trilhaReduzida = amostrarTrilha(bruta, LIMITE_TRILHA_RESUMO);
        }
      }
    }

    let novoApoioUserId: string | null | undefined;
    if (raw && 'apoioUserId' in raw) {
      const veredito = podeDefinirApoio({
        solicitanteId: user.id,
        solicitanteEhOrganizador: minhaParticipacao.ehOrganizador,
        alvoUserId,
      });
      if (!veredito.permitido) throw new HttpError(veredito.status, veredito.mensagem);

      const bruto = raw.apoioUserId;
      novoApoioUserId = bruto === null ? null : String(bruto);

      if (novoApoioUserId !== null) {
        const linhas = await sql`
          SELECT user_id, papel FROM downwind_participantes WHERE downwind_id = ${id}
        `;
        const participantes = linhas.map((r) => {
          const row = r as Record<string, unknown>;
          return { userId: String(row.user_id), papel: row.papel as 'velejador' | 'apoio_terra' };
        });
        const validado = apoioValido({
          alvoUserId,
          alvoPapel: alvoParticipacao.papel,
          apoioUserId: novoApoioUserId,
          participantes,
        });
        if (!validado.permitido) throw new HttpError(validado.status, validado.mensagem);
      }
    }

    if (novoEstado === undefined && novoApoioUserId === undefined) {
      throw new HttpError(400, 'Nada para atualizar: informe estado e/ou apoioUserId.');
    }

    // Duas UPDATEs condicionais, não uma só com CASE sobre um parâmetro
    // booleano: o driver HTTP do Neon manda cada `${}` como valor tipado
    // separado, e usar um booleano do JS como condição de WHEN é o tipo de
    // SQL "esperto" que este projeto evita (ver HANDOFF.md — SQL dinâmico já
    // gerou bug real aqui). `apoio_user_id` em especial PRECISA aceitar NULL
    // explícito (desvincular o apoio é uma ação válida, não "campo ausente"),
    // então não dá para usar um COALESCE simples nela como as outras colunas.
    if (novoEstado !== undefined) {
      await sql`
        UPDATE downwind_participantes
        SET estado = ${novoEstado},
            encerrou_em = ${novoEstado === 'encerrado' || novoEstado === 'desistiu' ? new Date().toISOString() : null},
            distancia_km = COALESCE(${distanciaKm ?? null}, distancia_km),
            velocidade_max_nos = COALESCE(${velocidadeMaxNos ?? null}, velocidade_max_nos),
            trilha_reduzida = COALESCE(${trilhaReduzida ? JSON.stringify(trilhaReduzida) : null}::jsonb, trilha_reduzida)
        WHERE downwind_id = ${id} AND user_id = ${alvoUserId}
      `;
    }

    if (novoApoioUserId !== undefined) {
      await sql`
        UPDATE downwind_participantes
        SET apoio_user_id = ${novoApoioUserId}
        WHERE downwind_id = ${id} AND user_id = ${alvoUserId}
      `;
    }

    // BUG REAL, achado em produção: encerrar/desistir aqui só move o
    // PARTICIPANTE — nada nesta rota olhava de volta para o `downwinds.status`.
    // Um downwind com um único velejador (o caso mais comum: dono testando,
    // ou grupo pequeno) ficava travado para sempre em 'em_andamento' assim
    // que essa pessoa encerrava a própria participação: `GET
    // /api/downwind/ativo` já não devolvia mais o downwind pra ela (o filtro
    // ali exige `estado IN ('confirmado','navegando')`), então o clique pra
    // "entrar" parava de levar a lugar nenhum — e o downwind não podia ser
    // apagado porque seu evento vinculado bloqueia exclusão com downwind
    // 'em_andamento'. Ninguém tinha como fechar o ciclo.
    //
    // Reaproveita a MESMA `podeEncerrarDownwind` (lib/downwind.ts) que
    // decide se o encerramento manual via POST .../status é permitido — não
    // uma segunda regra divergente. Só dispara quando este pedido moveu
    // ALGUÉM para fora da água (`novoEstado` é 'encerrado'/'desistiu'):
    // mudar só o apoio (`novoApoioUserId`) nunca deveria fechar o downwind.
    if (novoEstado === 'encerrado' || novoEstado === 'desistiu') {
      const [participantesAtuais, statusAtual] = await Promise.all([
        listarParticipantes(id),
        sql`SELECT status FROM downwinds WHERE id = ${id}`,
      ]);
      const emAndamento =
        statusAtual.length > 0 &&
        String((statusAtual[0] as Record<string, unknown>).status) === 'em_andamento';

      if (emAndamento && podeEncerrarDownwind(participantesAtuais)) {
        // `RETURNING id` só pra saber se ESTA chamada foi quem fechou —
        // `WHERE status = 'em_andamento'` já é a proteção contra duas
        // requisições concorrentes fecharem/resumirem em dobro (mesmo padrão
        // de app/api/downwind/[id]/status/route.ts).
        const fechado = await sql`
          UPDATE downwinds
          SET status = 'encerrado', encerrado_em = COALESCE(encerrado_em, NOW())
          WHERE id = ${id} AND status = 'em_andamento'
          RETURNING id
        `;
        if (fechado.length > 0) await resumirEPurgar(id);
      }
    }

    return { ok: true };
  });
}
