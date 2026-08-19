import { haversineKm, LatLng } from './geo';

/** Estágios da escalada: raio em km e quanto esperar antes de subir. */
export const ESTAGIOS_RAIO = [
  { raioKm: 5,  esperaMs: 2 * 60 * 1000 },
  { raioKm: 15, esperaMs: 2 * 60 * 1000 },
  { raioKm: 50, esperaMs: Infinity },
] as const;

/** Presença mais velha que isso não conta como "está por perto agora". */
export const JANELA_PRESENCA_MS = 15 * 60 * 1000;

/**
 * Retorna o próximo raio da escalada, ou null se já estiver no máximo.
 */
export function proximoRaio(raioAtual: number): number | null {
  const index = ESTAGIOS_RAIO.findIndex(e => e.raioKm === raioAtual);
  if (index === -1 || index === ESTAGIOS_RAIO.length - 1) {
    return null;
  }
  return ESTAGIOS_RAIO[index + 1].raioKm;
}

/**
 * Decide se o alerta deve escalar (aumentar raio de notificação).
 * Só escala se ninguém assumiu a responsabilidade e o tempo de espera do estágio
 * (desde o escaladoEm, ou criadoEm) tiver passado.
 */
export function deveEscalar(args: {
  raioKm: number;
  criadoEm: Date;
  escaladoEm: Date | null;
  agora: Date;
  temResponsavel: boolean;
}): boolean {
  if (args.temResponsavel) return false;

  const estagio = ESTAGIOS_RAIO.find(e => e.raioKm === args.raioKm);
  if (!estagio || estagio.esperaMs === Infinity) return false;

  const inicio = args.escaladoEm ? args.escaladoEm.getTime() : args.criadoEm.getTime();
  return (args.agora.getTime() - inicio) >= estagio.esperaMs;
}

/**
 * Ordena candidatos: os mais próximos primeiro; em caso de empate,
 * presença mais recente primeiro. Ignora quem tem presença muito antiga.
 */
export function ordenarCandidatos<T extends { distanciaKm: number; ultimaPresenca: Date }>(
  candidatos: T[],
  agora: Date
): T[] {
  return candidatos
    .filter(c => (agora.getTime() - c.ultimaPresenca.getTime()) <= JANELA_PRESENCA_MS)
    .sort((a, b) => {
      if (a.distanciaKm !== b.distanciaKm) return a.distanciaKm - b.distanciaKm;
      return b.ultimaPresenca.getTime() - a.ultimaPresenca.getTime();
    });
}

/**
 * Gera texto curto para notificação push.
 */
export function textoDoAlerta(args: {
  nome: string;
  distanciaKm: number;
  spotNome: string | null;
  temCoordenada: boolean;
}): { titulo: string; corpo: string } {
  const titulo = `🆘 SOS — ${args.nome}`;
  if (!args.temCoordenada) {
    return { titulo, corpo: 'Posição não confirmada. Verifique os detalhes no app.' };
  }
  
  const distStr = args.distanciaKm < 1 ? '< 1km' : `${Math.round(args.distanciaKm)}km`;
  let corpo = `Aproximadamente a ${distStr} de distância`;
  if (args.spotNome) {
    corpo += ` (perto de ${args.spotNome})`;
  }
  corpo += `. Ajuda necessária!`;
  
  return { titulo, corpo };
}

/**
 * Retorna uma bounding box (min/max latitude e longitude) ao redor de um ponto.
 * Serve como um pré-filtro rápido no SQL para Haversine.
 *
 * OBS: Isso cruza o antimeridiano se lng ±180, mas o Brasil (lng entre -75 e -30)
 * torna isso impossível, então não lidamos com esse edge case para não pesar a query.
 */
export function boundingBox(lat: number, lng: number, raioKm: number): {
  minLat: number; maxLat: number; minLng: number; maxLng: number
} {
  // 1 grau de latitude = ~111 km
  const deltaLat = raioKm / 111;
  // 1 grau de longitude varia de acordo com a latitude
  const deltaLng = Math.abs(raioKm / (111 * Math.cos((lat * Math.PI) / 180)));
  
  return {
    minLat: lat - deltaLat,
    maxLat: lat + deltaLat,
    minLng: lng - deltaLng,
    maxLng: lng + deltaLng,
  };
}
