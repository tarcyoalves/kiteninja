/**
 * Matemática da animação de vento do mapa. Vive fora do componente para ser
 * testável: um erro de sinal aqui inverteria a direção mostrada ao velejador, e
 * isso não aparece olhando a tela — as partículas se movem de qualquer jeito.
 */

/**
 * Converte a direção meteorológica no vetor de deslocamento em TELA.
 *
 * Convenção: o grau diz de ONDE o vento vem (0° = norte, logo sopra do norte
 * para o sul). Em tela o eixo y cresce para baixo, e "ir para o sul" é descer,
 * então y fica positivo para 0°.
 *
 * O vetor é unitário: a velocidade vem da intensidade em nós, separadamente.
 */
export function vetorVento(grauDeOndeVem: number): { vx: number; vy: number } {
  const rad = (grauDeOndeVem * Math.PI) / 180;
  /*
   * O vento sopra para o rumo OPOSTO ao que informa: de θ ele vai para θ+180.
   * Componente leste do rumo de destino = sin(θ+180) = -sin(θ), e leste é a
   * direita da tela, daí `vx = -sin`.
   * Componente norte = cos(θ+180) = -cos(θ); como y da tela cresce para baixo,
   * a segunda inversão cancela a primeira e sobra `vy = +cos`.
   *
   * Conferindo: de leste (90°) dá vx = -1, ou seja, sopra para a esquerda /
   * oeste. Escrevi `+sin` na primeira versão e o teste de 115° pegou.
   */
  return { vx: -Math.sin(rad), vy: Math.cos(rad) };
}

/**
 * Cor da partícula pela intensidade, na mesma escala usada no resto do app
 * (ver getWindColorClass): ciano fraco, esmeralda ideal, âmbar forte, rosa
 * perigoso. rgba direto porque o canvas não entende classe do Tailwind.
 */
export function corPorForca(knots: number): string {
  if (knots < 12) return 'rgba(34,211,238,0.55)';
  if (knots < 20) return 'rgba(52,211,153,0.62)';
  if (knots < 28) return 'rgba(251,191,36,0.66)';
  return 'rgba(244,114,182,0.7)';
}

/**
 * Campo de vento num ponto da tela: média dos spots ponderada por 1/distância².
 * Não é modelo meteorológico — é a tendência entre os pontos que medimos, que é
 * o que o velejador precisa ("de onde vem e quão forte").
 */
export function campoDeVento(
  x: number,
  y: number,
  spots: { x: number; y: number; vx: number; vy: number; forca: number }[]
): { vx: number; vy: number; forca: number } {
  if (spots.length === 0) return { vx: 0, vy: 0, forca: 0 };

  let sx = 0;
  let sy = 0;
  let sf = 0;
  let peso = 0;

  for (const s of spots) {
    const dx = x - s.x;
    const dy = y - s.y;
    // O +1 evita divisão por zero exatamente sobre o pino do spot.
    const w = 1 / (dx * dx + dy * dy + 1);
    sx += s.vx * w;
    sy += s.vy * w;
    sf += s.forca * w;
    peso += w;
  }

  return { vx: sx / peso, vy: sy / peso, forca: sf / peso };
}
