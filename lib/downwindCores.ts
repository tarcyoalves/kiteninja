/**
 * Cor determinística por participante do downwind.
 *
 * A cor é a ÚNICA legenda do mapa ao vivo: o marcador de alguém sem foto e a
 * trilha dessa mesma pessoa usam a mesma cor, então dá para seguir o rastro
 * até a bolinha sem tocar em nada. Isso só funciona se a cor for estável — a
 * mesma pessoa não pode trocar de cor entre um poll e outro, nem entre o
 * aparelho de um velejador e o de outro. Daí ser derivada do `userId` por
 * hash, e não sorteada nem distribuída por índice na lista (a lista muda de
 * ordem quando alguém entra ou sai).
 */

/**
 * Paleta escolhida para contraste sobre o tile CARTO escuro que o app já usa.
 * Sem azul-escuro e sem cinza de propósito: o primeiro some no mar do mapa, o
 * segundo se confunde com os marcadores de apoio em terra, que são cinza por
 * definição. 12 matizes é o suficiente para um downwind (dezenas de pessoas no
 * limite) sem que dois vizinhos fiquem indistinguíveis.
 */
export const PALETA_DOWNWIND = [
  '#f97316', // laranja
  '#22d3ee', // ciano
  '#a3e635', // lima
  '#f472b6', // rosa
  '#fbbf24', // âmbar
  '#4ade80', // verde
  '#c084fc', // violeta
  '#fb7185', // coral
  '#2dd4bf', // turquesa
  '#facc15', // amarelo
  '#e879f9', // magenta
  '#38bdf8', // azul-claro
] as const;

/**
 * Hash FNV-1a de 32 bits. Escolhido por ser curto, sem dependência e bem
 * distribuído para strings — o objetivo aqui não é criptografia, é dois UUIDs
 * diferentes caírem em índices diferentes com boa probabilidade.
 *
 * `>>> 0` mantém o resultado como inteiro sem sinal: sem ele, o `%` no fim
 * poderia devolver índice negativo e estourar a paleta.
 */
function hash32(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function corDoUsuario(userId: string): string {
  return PALETA_DOWNWIND[hash32(userId) % PALETA_DOWNWIND.length];
}

/**
 * Cores do anel de estado de sinal, derivadas de `estadoSinal()` em
 * lib/downwind.ts. Ficam aqui, e não espalhadas no componente, para o marcador
 * e o painel de detalhe nunca divergirem sobre o que é "atrasado".
 */
export const COR_SINAL: Record<'ok' | 'atrasado' | 'sem_sinal', string> = {
  ok: '#34d399',
  atrasado: '#fbbf24',
  sem_sinal: '#fb7185',
};
