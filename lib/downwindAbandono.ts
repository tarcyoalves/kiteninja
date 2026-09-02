/**
 * Quando um downwind foi ABANDONADO em vez de encerrado.
 *
 * POR QUE ISTO EXISTE
 *
 * O resumo da travessia — distância, velocidade máxima, trilha reduzida — só
 * é calculado por `resumirEPurgar`, e `resumirEPurgar` só roda quando alguém
 * ENCERRA o downwind (pelo botão, ou quando o último participante sai).
 *
 * Ninguém encerra. O velejador chega na praia, guarda o equipamento e fecha o
 * app. Caso real, verificado em produção: o downwind "Pernambuquinho x
 * fortaleza" foi iniciado em 31/08 às 12:10 UTC e continuava `em_andamento`
 * 36 horas depois. Ninguém velejou 36 horas.
 *
 * Enquanto ele fica preso em `em_andamento`:
 *
 *  - `distancia_km`, `velocidade_max_nos` e `trilha_reduzida` seguem NULL —
 *    **a travessia não fica registrada em lugar nenhum**;
 *  - as posições nunca são purgadas (a purga só olha downwind encerrado);
 *  - a lista mostra "Na água agora" indefinidamente, e o app diz que há gente
 *    velejando quando não há.
 *
 * O primeiro item é o que dói: o velejador fez 30 km e não tem o registro.
 */

/**
 * Silêncio total que caracteriza abandono.
 *
 * Seis horas, e não menos, por uma razão específica: o rastreio em segundo
 * plano no Android é justamente a parte frágil deste app (ver
 * `docs/INVESTIGACAO-RASTREIO-BACKGROUND.md`). Um limiar curto encerraria a
 * travessia de quem está na água de verdade e só perdeu o beacon — que é o
 * erro mais caro possível aqui, porque apagaria do mapa alguém que talvez
 * precise de socorro.
 *
 * Nenhuma travessia de kite dura seis horas sem um único ponto de GPS de
 * nenhum participante. Errar para o lado de esperar demais custa um resumo
 * atrasado; errar para o outro lado custa a vigilância de quem está na água.
 */
export const HORAS_SILENCIO_PARA_ABANDONO = 6;

const MS_POR_HORA = 3_600_000;

export interface EstadoDownwindAberto {
  iniciadoEm: Date;
  /**
   * Última posição de QUALQUER participante. `null` quando o rastreio nunca
   * chegou a reportar — que também é abandono depois do prazo, e não uma
   * exceção: um downwind iniciado que nunca recebeu um ponto sequer não tem
   * travessia para registrar.
   */
  ultimaPosicaoEm: Date | null;
}

/**
 * O instante a partir do qual se conta o silêncio: a última posição, ou o
 * início quando nunca houve posição nenhuma.
 */
function ultimoSinal(estado: EstadoDownwindAberto): Date {
  if (!estado.ultimaPosicaoEm) return estado.iniciadoEm;
  // Posição anterior ao início (relógio do aparelho errado) não pode fazer o
  // silêncio parecer maior do que é.
  return estado.ultimaPosicaoEm > estado.iniciadoEm ? estado.ultimaPosicaoEm : estado.iniciadoEm;
}

export function ehDownwindAbandonado(estado: EstadoDownwindAberto, agora: Date): boolean {
  const silencioMs = agora.getTime() - ultimoSinal(estado).getTime();
  return silencioMs >= HORAS_SILENCIO_PARA_ABANDONO * MS_POR_HORA;
}

/**
 * Que horas gravar em `encerrado_em`.
 *
 * A ÚLTIMA POSIÇÃO, nunca `NOW()`. Isto não é detalhe: o cron pode só passar
 * por ali horas depois, e carimbar o horário da varredura faria a travessia
 * do velejador parecer ter durado 36 horas no resumo e no histórico. O
 * instante em que ele parou de reportar é a melhor aproximação que existe do
 * instante em que ele saiu da água.
 *
 * Sem posição nenhuma, cai no início — a travessia tem duração zero, que é
 * honesto: não há nada registrado dela.
 */
export function instanteDeEncerramento(estado: EstadoDownwindAberto): Date {
  return ultimoSinal(estado);
}
