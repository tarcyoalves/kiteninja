import { sql } from '@/lib/db';
import { handle } from '@/lib/api';
import { HttpError } from '@/lib/auth';
import { ehUuid } from '@/lib/downwindDb';
import { corDoUsuario } from '@/lib/downwindCores';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, ctx: Params) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!ehUuid(id)) throw new HttpError(404, 'Downwind não encontrado.');

    // 1. Busca dados do downwind e spots de origem/destino
    const dwRows = await sql`
      SELECT 
        d.id, d.nome, d.status, d.visibilidade, d.iniciado_em, d.encerrado_em,
        d.distancia_estimada_km,
        s_origem.name AS origem_spot_nome, s_origem.lat AS origem_lat, s_origem.lng AS origem_lng,
        s_destino.name AS destino_spot_nome, s_destino.lat AS destino_lat, s_destino.lng AS destino_lng
      FROM downwinds d
      LEFT JOIN spots s_origem ON s_origem.id = d.origem_spot_id
      LEFT JOIN spots s_destino ON s_destino.id = d.destino_spot_id
      WHERE d.id = ${id}
      LIMIT 1
    `;

    if (dwRows.length === 0) {
      throw new HttpError(404, 'Downwind não encontrado.');
    }

    const dw = dwRows[0] as Record<string, unknown>;

    // 2. Busca participantes
    const partRows = await sql`
      SELECT 
        dp.user_id, dp.papel, dp.estado, dp.distancia_km, dp.velocidade_max_nos,
        u.name AS user_name, u.avatar_url AS user_avatar_url
      FROM downwind_participantes dp
      JOIN users u ON u.id = dp.user_id
      WHERE dp.downwind_id = ${id}
      ORDER BY dp.criado_em ASC
    `;

    // 3. Busca todas as posições da travessia para alimentar replay e trilhas
    const posRows = await sql`
      SELECT 
        user_id, lat, lng, velocidade_nos, direcao_graus, bateria_pct,
        EXTRACT(EPOCH FROM registrado_em) * 1000 AS ts_ms,
        registrado_em
      FROM downwind_posicoes
      WHERE downwind_id = ${id}
      ORDER BY registrado_em ASC
    `;

    // Agrupa trilhas e calcula última posição por usuário
    const trilhas: Record<string, [lat: number, lng: number, speedKnots: number, tsMs: number][]> = {};
    const ultimasPosicoes: Record<
      string,
      {
        lat: number;
        lng: number;
        speedKnots: number;
        heading: number | null;
        registradoEm: string;
        bateriaPct?: number;
      }
    > = {};

    for (const p of posRows as Record<string, unknown>[]) {
      const uId = String(p.user_id);
      const lat = Number(p.lat);
      const lng = Number(p.lng);
      const speed = Number(p.velocidade_nos || 0);
      const ts = Number(p.ts_ms);

      if (!trilhas[uId]) trilhas[uId] = [];
      trilhas[uId].push([lat, lng, speed, ts]);

      ultimasPosicoes[uId] = {
        lat,
        lng,
        speedKnots: speed,
        heading: p.direcao_graus !== null ? Number(p.direcao_graus) : null,
        registradoEm: String(p.registrado_em),
        bateriaPct: p.bateria_pct !== null ? Number(p.bateria_pct) : undefined,
      };
    }

    const participantes = (partRows as Record<string, unknown>[]).map((p, idx) => {
      const uId = String(p.user_id);
      return {
        userId: uId,
        name: String(p.user_name),
        avatarUrl: p.user_avatar_url ? String(p.user_avatar_url) : null,
        papel: String(p.papel),
        estado: String(p.estado),
        corHex: corDoUsuario(uId),
        distanciaKm: Number(p.distancia_km || 0),
        velocidadeMaxNos: Number(p.velocidade_max_nos || 0),
        ultimaPosicao: ultimasPosicoes[uId] || null,
      };
    });

    return {
      downwind: {
        id: String(dw.id),
        nome: String(dw.nome || 'Downwind'),
        status: String(dw.status),
        visibilidade: String(dw.visibilidade || 'privado'),
        iniciadoEm: dw.iniciado_em ? String(dw.iniciado_em) : null,
        encerradoEm: dw.encerrado_em ? String(dw.encerrado_em) : null,
        origemSpotNome: dw.origem_spot_nome ? String(dw.origem_spot_nome) : null,
        destinoSpotNome: dw.destino_spot_nome ? String(dw.destino_spot_nome) : null,
        origemLat: dw.origem_lat !== null ? Number(dw.origem_lat) : null,
        origemLng: dw.origem_lng !== null ? Number(dw.origem_lng) : null,
        destinoLat: dw.destino_lat !== null ? Number(dw.destino_lat) : null,
        destinoLng: dw.destino_lng !== null ? Number(dw.destino_lng) : null,
        distanciaEstimadaKm: dw.distancia_estimada_km !== null ? Number(dw.distancia_estimada_km) : null,
      },
      participantes,
      trilhas,
    };
  });
}