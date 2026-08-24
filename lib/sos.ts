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
  /**
   * Status atual do alerta.
   *
   * Estados terminais ('resolvido', 'cancelado', 'falso_alarme') nunca
   * escalam: um humano autorizado já encerrou o pedido.
   *
   * 'em_atendimento' PODE voltar a escalar — mudança de 2026-08-23, ver
   * docs/MAQUINA-ESTADOS-SOS.md. Antes bastava um socorrista marcar
   * 'a_caminho' e depois desistir para o SOS ficar congelado em 5 km para
   * sempre; no cenário de abandono (aceita, marca a caminho, some) o
   * velejador ficava sem socorro e sem escalada. Quem decide agora é
   * `temResponsavel`: se não há mais ninguém a caminho, a busca continua,
   * independente do status.
   *
   * O motivo original daquele congelamento era real — evitar rajada de push
   * quando alguém alterna a_caminho/nao_posso. Isso é resolvido gravando
   * `escalated_at = NOW()` na volta para 'ativo': o relógio reinicia e o SOS
   * espera um estágio inteiro antes de ampliar o raio, em vez de escalar na
   * hora. Recuperação sem tempestade de notificações.
   *
   * Opcional e default 'ativo' para não quebrar quem já chama sem esse campo.
   */
  statusAtual?: 'ativo' | 'em_atendimento' | 'resolvido' | 'cancelado' | 'falso_alarme';
}): boolean {
  if (args.statusAtual === 'resolvido' || args.statusAtual === 'cancelado' || args.statusAtual === 'falso_alarme') {
    return false;
  }
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
 *
 * O corpo diz POR QUE esta pessoa foi chamada, porque isso muda a decisão dela.
 * "a 2km de você" e "no seu downwind" pedem reações diferentes: no segundo caso
 * o socorrista está na água, na mesma rota, e provavelmente é o mais rápido
 * mesmo estando longe. O apoio em terra recebe um texto próprio: ele não vai
 * remar até lá, o papel dele é acionar socorro e ir de carro.
 *
 * `distanciaKm` é null quando não há como medir (SOS sem GPS, ou companheiro de
 * downwind sem posição recente). Nesse caso NÃO inventamos número: em resgate,
 * uma distância errada é pior que distância nenhuma.
 */
export function textoDoAlerta(args: {
  nome: string;
  distanciaKm: number | null;
  spotNome: string | null;
  temCoordenada: boolean;
  motivo?: 'proximidade' | 'downwind' | 'downwind_apoio';
}): { titulo: string; corpo: string } {
  const titulo = `🆘 SOS — ${args.nome}`;
  const motivo = args.motivo ?? 'proximidade';
  const ondeStr = args.spotNome ? ` (perto de ${args.spotNome})` : '';
  const distStr =
    args.distanciaKm === null
      ? null
      : args.distanciaKm < 1
      ? '< 1km'
      : `${Math.round(args.distanciaKm)}km`;

  if (motivo === 'downwind_apoio') {
    const corpo = distStr
      ? `Está no downwind que você apoia, a ${distStr}${ondeStr}. Acione socorro (193/185).`
      : `Está no downwind que você apoia${ondeStr}. Acione socorro (193/185).`;
    return { titulo, corpo };
  }

  if (motivo === 'downwind') {
    const corpo = distStr
      ? `Está no SEU downwind, a ${distStr}${ondeStr}. Ajuda necessária!`
      : `Está no SEU downwind${ondeStr}. Posição ainda não confirmada.`;
    return { titulo, corpo };
  }

  if (!args.temCoordenada || distStr === null) {
    return { titulo, corpo: 'Posição não confirmada. Verifique os detalhes no app.' };
  }

  return {
    titulo,
    corpo: `Aproximadamente a ${distStr} de distância${ondeStr}. Ajuda necessária!`,
  };
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
