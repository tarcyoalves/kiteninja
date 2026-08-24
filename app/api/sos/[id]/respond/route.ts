import { sql } from '@/lib/db';
import { handle, readOptionalJson } from '@/lib/api';
import { requireUser, HttpError } from '@/lib/auth';
import { num, oneOf, uuid } from '@/lib/validation';
import { podeResponderSos } from '@/lib/authz';
import { haversineKm } from '@/lib/geo';
import { JANELA_PRESENCA_MS } from '@/lib/sos';
import { logSos } from '@/lib/sosLog';

export const dynamic = 'force-dynamic';

/**
 * Um socorrista declara o que vai fazer sobre um SOS.
 *
 * ANTES (P0-2 de docs/AUDITORIA-2026-08-23.md): esta rota não tinha nenhuma
 * verificação. Qualquer conta autenticada inseria a própria linha em
 * `sos_responders`, o que dava dois poderes indevidos:
 *   (a) ver a coordenada exata do acidentado, porque `canSeePos` em
 *       /api/sos/active libera a posição para quem está nessa tabela;
 *   (b) congelar a escalada para sempre mandando 'a_caminho'.
 *
 * A regra de negócio de quem pode responder está em `podeResponderSos`
 * (lib/authz.ts) e documentada em docs/MAQUINA-ESTADOS-SOS.md.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const body = await readOptionalJson(request);
    const { id } = await context.params;

    // Sem isto, um id malformado vira erro 500 de cast do Postgres.
    const sosId = uuid({ id }, 'id');

    const state = oneOf(body, 'state', ['a_caminho', 'no_local', 'nao_posso'] as const);

    // Faixa validada: uma coordenada absurda aqui manda socorro para o lugar
    // errado. Ver P0-4/item 7 — `num` sem min/max aceitava lat: 999.
    const lat = num(body, 'lat', { optional: true, min: -90, max: 90 });
    const lng = num(body, 'lng', { optional: true, min: -180, max: 180 });

    // --- O SOS existe? Em que estado está? ---
    const alertRows = await sql`
      SELECT user_id, status, lat, lng, radius_km
      FROM sos_alerts
      WHERE id = ${sosId}
      LIMIT 1
    `;
    if (alertRows.length === 0) {
      throw new HttpError(404, 'SOS não encontrado.');
    }
    const alerta = alertRows[0] as Record<string, unknown>;
    const sosAuthorId = String(alerta.user_id);
    const statusSos = String(alerta.status) as 'ativo' | 'em_atendimento' | 'resolvido' | 'cancelado' | 'falso_alarme';

    // --- Já foi notificado? (caminho normal de elegibilidade) ---
    const jaNotificado = await sql`
      SELECT 1 FROM sos_responders
      WHERE sos_id = ${sosId} AND user_id = ${user.id}
      LIMIT 1
    `;
    const foiNotificado = jaNotificado.length > 0;

    // --- Está dentro do raio? ---
    // A posição usada é a que o SERVIDOR gravou em user_presence, nunca a que
    // veio no corpo: senão bastaria mentir `lat`/`lng` no próprio pedido para
    // se declarar por perto e furar a autorização.
    let dentroDoRaio = false;
    const sosLat = alerta.lat === null ? null : Number(alerta.lat);
    const sosLng = alerta.lng === null ? null : Number(alerta.lng);
    if (!foiNotificado && sosLat !== null && sosLng !== null) {
      const cutoff = new Date(Date.now() - JANELA_PRESENCA_MS).toISOString();
      const presenca = await sql`
        SELECT lat, lng FROM user_presence
        WHERE user_id = ${user.id}
          AND lat IS NOT NULL AND lng IS NOT NULL
          AND pos_updated_at >= ${cutoff}
        LIMIT 1
      `;
      if (presenca.length > 0) {
        const p = presenca[0] as Record<string, unknown>;
        const dist = haversineKm(
          { lat: Number(p.lat), lng: Number(p.lng) },
          { lat: sosLat, lng: sosLng }
        );
        dentroDoRaio = dist <= Number(alerta.radius_km);
      }
    }

    const permissao = podeResponderSos({
      user,
      sosAuthorId,
      statusSos,
      foiNotificado,
      dentroDoRaio,
    });

    if (!permissao.ok) {
      logSos({
        etapa: 'respond.negado',
        sosId,
        userId: user.id,
        detalhe: { motivo: permissao.motivo, statusSos },
      });
      if (permissao.motivo === 'sos_terminal') {
        throw new HttpError(409, 'Este SOS já foi encerrado.');
      }
      if (permissao.motivo === 'autor_do_sos') {
        throw new HttpError(400, 'Você é quem pediu socorro neste alerta.');
      }
      // Mensagem deliberadamente pobre: não confirma nem nega proximidade,
      // para não virar um oráculo de "o SOS está perto de mim?".
      throw new HttpError(403, 'Você não foi acionado para este socorro.');
    }

    await sql`
      INSERT INTO sos_responders (sos_id, user_id, state, lat, lng, responded_at)
      VALUES (${sosId}, ${user.id}, ${state}, ${lat ?? null}, ${lng ?? null}, NOW())
      ON CONFLICT (sos_id, user_id) DO UPDATE
        SET state = EXCLUDED.state,
            lat = COALESCE(EXCLUDED.lat, sos_responders.lat),
            lng = COALESCE(EXCLUDED.lng, sos_responders.lng),
            responded_at = NOW()
        -- Redundante com o alvo do conflito, mas mantido de propósito: garante
        -- que este upsert só toca a linha do próprio chamador, e mantém a
        -- checagem de lib/authz.test.ts ("mutação filtra por user_id") com
        -- valor real em vez de virar exceção declarada.
        WHERE sos_responders.user_id = ${user.id}
    `;

    // --- Máquina de estados (docs/MAQUINA-ESTADOS-SOS.md) ---
    // Quem manda é a existência de responsável VIVO (a_caminho/no_local),
    // recontada no banco depois do upsert. Não dá para confiar no `state` que
    // acabou de chegar: outro socorrista pode ter assumido no meio.
    const vivos = await sql`
      SELECT COUNT(*)::int AS n FROM sos_responders
      WHERE sos_id = ${sosId} AND state IN ('a_caminho', 'no_local')
    `;
    const temResponsavelVivo = Number((vivos[0] as Record<string, unknown>).n) > 0;

    let novoStatus: 'ativo' | 'em_atendimento' | null = null;

    if (temResponsavelVivo) {
      // Só sai de 'ativo'. Um SOS terminal não é reaberto por resposta de
      // socorrista — quem reabre é o autor/moderação, por outra rota.
      const r = await sql`
        UPDATE sos_alerts
        SET status = 'em_atendimento', updated_at = NOW()
        WHERE id = ${sosId} AND status = 'ativo'
        RETURNING id
      `;
      if (r.length > 0) novoStatus = 'em_atendimento';
    } else {
      // ABANDONO: o último responsável vivo desistiu. O SOS volta a procurar
      // socorro — antes ficava congelado em 'em_atendimento' para sempre.
      //
      // `escalated_at = NOW()` é o antiflapping: reinicia o relógio do estágio
      // para que a volta não dispare uma escalada instantânea, e para que
      // alguém alternando a_caminho/nao_posso não gere rajada de push.
      const r = await sql`
        UPDATE sos_alerts
        SET status = 'ativo', escalated_at = NOW(), updated_at = NOW()
        WHERE id = ${sosId} AND status = 'em_atendimento'
        RETURNING id
      `;
      if (r.length > 0) novoStatus = 'ativo';
    }

    logSos({
      etapa: 'respond.ok',
      sosId,
      userId: user.id,
      detalhe: {
        state,
        porNotificacao: foiNotificado,
        porProximidade: dentroDoRaio,
        temResponsavelVivo,
        transicao: novoStatus,
      },
    });

    return { ok: true, status: novoStatus ?? statusSos };
  });
}
