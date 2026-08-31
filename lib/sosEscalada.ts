import { sql } from './db';
import { deveEscalar, proximoRaio, textoDoAlerta } from './sos';
import { selectSosCandidates } from './sosCandidates';
import { sendPushToUsers } from './push';
import { logSos } from './sosLog';

/**
 * Motor de escalada do SOS — o mecanismo que amplia o raio de busca por
 * socorro quando ninguém assume o atendimento.
 *
 * POR QUE ISTO EXISTE (item 6 da revisão, P0-1 da auditoria):
 * a escalada morava dentro de `GET /api/sos/active`, e o comentário no código
 * assumia que "quem está online consulta a cada poucos segundos, a escalada
 * acontece naturalmente". Duas falhas nisso:
 *
 *  1. A consulta lista APENAS os SOS que o usuário que está fazendo o poll pode
 *     ver (`WHERE sa.user_id = eu OR sr.user_id = eu`). Um SOS cujos vizinhos
 *     notificados estão todos com o app fechado nunca é varrido por ninguém —
 *     e é justamente o caso em que ampliar o raio é vital.
 *  2. Quem mais precisa da escalada é o velejador em apuros, cujo celular
 *     provavelmente está no bolso, molhado ou na areia. Depender do próprio
 *     acidentado manter o app aberto para que o socorro se amplie inverte a
 *     lógica do sistema.
 *
 * O resultado prático era: **SOS sem ninguém por perto ficava parado em 5 km
 * para sempre.** Silenciosamente.
 *
 * A função é IDEMPOTENTE por construção: o UPDATE é condicionado ao raio lido
 * (`AND radius_km = ${raioAtual}`), então duas execuções concorrentes — cron e
 * poll ao mesmo tempo — resultam em uma única ampliação. Isso está provado em
 * scripts/verify-sos.ts, seção 3.
 */

export interface ResultadoEscalada {
  sosId: string;
  raioAnterior: number;
  raioNovo: number;
  notificados: number;
}

export interface ResumoVarredura {
  examinados: number;
  escalados: ResultadoEscalada[];
  erros: number;
}

/**
 * Tenta escalar UM SOS. Devolve null se não era hora de escalar (ou se outra
 * execução escalou primeiro).
 *
 * Não lança por falha de push: o alerta já ampliado vale mais que a
 * notificação perdida.
 */
export async function escalarUmSos(alerta: {
  id: string;
  userId: string;
  authorName: string;
  lat: number | null;
  lng: number | null;
  /**
   * Spot declarado no SOS. Vai para o seletor de candidatos: sem ele, as
   * camadas de fallback por spot e por estado ficavam inalcançáveis na
   * escalada, e um SOS sem GPS ampliava o raio no banco sem chamar ninguém.
   */
  spotId: string | null;
  spotName: string | null;
  status: string;
  radiusKm: number;
  createdAt: Date;
  escalatedAt: Date | null;
  temResponsavel: boolean;
  jaNotificados: Set<string>;
}, agora: Date = new Date()): Promise<ResultadoEscalada | null> {
  const precisa = deveEscalar({
    raioKm: alerta.radiusKm,
    criadoEm: alerta.createdAt,
    escaladoEm: alerta.escalatedAt,
    agora,
    temResponsavel: alerta.temResponsavel,
    statusAtual: alerta.status as 'ativo' | 'em_atendimento',
  });

  if (!precisa) return null;

  const novoRaio = proximoRaio(alerta.radiusKm);
  if (novoRaio === null) {
    // Já está no raio máximo: nada a ampliar. Não é erro.
    return null;
  }

  // Guarda de concorrência: se outra execução já subiu o raio, este UPDATE
  // não encontra a linha e devolve 0 linhas — sem push duplicado.
  const aplicado = await sql`
    UPDATE sos_alerts
    SET radius_km = ${novoRaio}, escalated_at = NOW(), updated_at = NOW()
    WHERE id = ${alerta.id}
      AND radius_km = ${alerta.radiusKm}
      AND status IN ('ativo', 'em_atendimento')
    RETURNING id
  `;

  if (aplicado.length === 0) {
    logSos({
      etapa: 'escalada.sem_gatilho',
      sosId: alerta.id,
      detalhe: { motivo: 'outra_execucao_venceu', raioLido: alerta.radiusKm },
    });
    return null;
  }

  let notificados = 0;

  // Roda mesmo sem coordenada: o seletor avisa o grupo do downwind, que não
  // depende de GPS. Antes tudo isto estava dentro de um
  // `if (lat !== null && lng !== null)` e a escalada de um SOS sem GPS
  // ampliava o raio no banco sem notificar ninguém — trabalho invisível.
  const candidatos = await selectSosCandidates({
    excludeUserId: alerta.userId,
    origin: alerta.lat !== null && alerta.lng !== null
      ? { lat: alerta.lat, lng: alerta.lng }
      : null,
    radiusKm: novoRaio,
    alreadyNotified: alerta.jaNotificados,
    spotId: alerta.spotId,
  });

  if (candidatos.length > 0) {
    const ids = candidatos.map(c => c.userId);
    const dists = candidatos.map(c => c.dist);
    const motivos = candidatos.map(c => c.motivo);
    // Lote único: um INSERT por candidato somava round-trips à Neon dentro
    // do caminho crítico do socorro.
    await sql`
      INSERT INTO sos_responders (sos_id, user_id, state, distance_km, motivo)
      SELECT ${alerta.id}, u.id, 'notificado', d.dist, d.motivo
      FROM UNNEST(${ids}::uuid[], ${dists}::numeric[], ${motivos}::text[]) AS d(uid, dist, motivo)
      JOIN users u ON u.id = d.uid
      ON CONFLICT (sos_id, user_id) DO NOTHING
    `;

    const envios = await Promise.allSettled(
      candidatos.map(c => {
        const txt = textoDoAlerta({
          nome: alerta.authorName,
          distanciaKm: c.dist,
          spotNome: alerta.spotName,
          temCoordenada: alerta.lat !== null && alerta.lng !== null,
          motivo: c.motivo,
        });
        return sendPushToUsers([c.userId], {
          title: txt.titulo,
          body: txt.corpo,
          requireInteraction: true,
          url: `/?tab=mapa&sos=${alerta.id}`,
        });
      })
    );

    notificados = candidatos.length;
    const falhas = envios.filter(e => e.status === 'rejected').length;
    if (falhas > 0) {
      logSos({
        etapa: 'push.falhou',
        sosId: alerta.id,
        detalhe: { tentados: envios.length, falhas, contexto: 'escalada' },
      });
    }
  }

  logSos({
    etapa: 'escalada',
    sosId: alerta.id,
    detalhe: {
      de: alerta.radiusKm,
      para: novoRaio,
      notificados,
      temGps: alerta.lat !== null && alerta.lng !== null,
    },
  });

  return {
    sosId: alerta.id,
    raioAnterior: alerta.radiusKm,
    raioNovo: novoRaio,
    notificados,
  };
}

/**
 * Varre TODOS os SOS abertos do sistema e escala os que precisam.
 *
 * Diferente do caminho antigo, aqui não há filtro por usuário: é a varredura
 * global que o cron executa. Um SOS cujos vizinhos estão todos offline é
 * encontrado por esta consulta.
 *
 * Um SOS que falha não interrompe os outros — cada um é independente, e no
 * caminho de vida é inaceitável que um alerta problemático impeça a escalada
 * dos demais.
 */
export async function varrerEscaladas(agora: Date = new Date()): Promise<ResumoVarredura> {
  const abertos = await sql`
    SELECT sa.id, sa.user_id, sa.lat, sa.lng, sa.status, sa.radius_km,
           sa.spot_id, sa.created_at, sa.escalated_at,
           u.name AS author_name,
           sp.name AS spot_name,
           EXISTS (
             SELECT 1 FROM sos_responders sr
             WHERE sr.sos_id = sa.id AND sr.state IN ('a_caminho', 'no_local')
           ) AS tem_responsavel
    FROM sos_alerts sa
    JOIN users u ON u.id = sa.user_id
    LEFT JOIN spots sp ON sp.id = sa.spot_id
    WHERE sa.status IN ('ativo', 'em_atendimento')
      AND sa.radius_km < 50
    ORDER BY COALESCE(sa.escalated_at, sa.created_at) ASC
    LIMIT 200
  `;

  const escalados: ResultadoEscalada[] = [];
  let erros = 0;

  for (const r of abertos) {
    const row = r as Record<string, unknown>;
    const sosId = String(row.id);
    try {
      const jaRows = await sql`
        SELECT user_id FROM sos_responders WHERE sos_id = ${sosId}
      `;
      const jaNotificados = new Set(jaRows.map(x => String((x as Record<string, unknown>).user_id)));

      const resultado = await escalarUmSos(
        {
          id: sosId,
          userId: String(row.user_id),
          authorName: String(row.author_name),
          lat: row.lat === null ? null : Number(row.lat),
          lng: row.lng === null ? null : Number(row.lng),
          spotId: row.spot_id === null || row.spot_id === undefined ? null : String(row.spot_id),
          spotName: row.spot_name === null || row.spot_name === undefined ? null : String(row.spot_name),
          status: String(row.status),
          radiusKm: Number(row.radius_km),
          createdAt: new Date(String(row.created_at)),
          escalatedAt: row.escalated_at ? new Date(String(row.escalated_at)) : null,
          temResponsavel: row.tem_responsavel === true,
          jaNotificados,
        },
        agora
      );

      if (resultado) escalados.push(resultado);
    } catch (err) {
      erros += 1;
      logSos({
        etapa: 'erro',
        sosId,
        detalhe: { onde: 'varrerEscaladas', erro: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return { examinados: abertos.length, escalados, erros };
}
