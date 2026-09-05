/**
 * A unidade da velocidade DO VELEJADOR — km/h, não nós.
 *
 * O RELATO QUE ORIGINOU ISTO
 *
 * O dono gravou um velejo de teste, viu a velocidade passar de 43 km/h na
 * tela, e o card do feed depois mostrou "23.9nós". O número estava certo
 * (23,9 × 1,852 = 44,3 km/h — exatamente o que ele viu), mas **o app se
 * contradizia sobre a unidade**:
 *
 *  - `ModoNavegacao` (a tela que ele olhava velejando): km/h;
 *  - `DownwindResumoModal`: km/h;
 *  - card do feed e detalhe da sessão: nós, com o MESMO número.
 *
 * Duas telas diziam 44,3 e duas diziam 23,9 sobre a mesma medida. Do lado de
 * cá isso não se lê como "unidades diferentes", se lê como "o app errou a
 * conta" — e foi exatamente essa a conclusão.
 *
 * POR QUE km/h, E POR QUE O VENTO CONTINUA EM NÓS
 *
 * São duas grandezas diferentes por convenção do esporte, não a mesma coisa
 * em duas unidades. O velejador fala a própria velocidade em km/h (é o que os
 * apps de referência mostram) e o vento em nós. A decisão já existia no
 * código, escrita duas vezes em dois arquivos; o que faltava era ela valer em
 * TODA tela que mostra velocidade de velejo.
 *
 * O ARMAZENAMENTO CONTINUA EM NÓS. `lib/trilhaSessao.ts` calcula e filtra em
 * nós (os limiares de GPS ali — deslocamento mínimo, salto impossível — foram
 * calibrados nessa unidade, contra o recorde mundial de kitesurf em nós), a
 * coluna do banco é `max_speed_knots` e a validação da rota é em nós. A
 * conversão acontece só na borda: aqui.
 */

/** 1 nó = 1,852 km/h, por definição da milha náutica. */
export const NOS_PARA_KMH = 1.852;

/** O rótulo, num lugar só — para nenhuma tela escrever "nós" por engano. */
export const UNIDADE_VELOCIDADE_VELEJO = 'km/h';

export function nosParaKmh(nos: number): number {
  return nos * NOS_PARA_KMH;
}

/**
 * Volta para nós — usado ao ler o que a pessoa digitou no formulário, que
 * agora pergunta em km/h.
 */
export function kmhParaNos(kmh: number): number {
  return kmh / NOS_PARA_KMH;
}

/**
 * "44.3 km/h", ou o travessão quando não há medida.
 *
 * Uma casa decimal: é a diferença entre 44,3 e 44 numa velocidade de ponta,
 * e é a precisão que o resto do app já usa para velejo. Ausência é `—`, nunca
 * `0 km/h` — zero é uma medida, e dizer que alguém andou a zero é diferente
 * de não ter medido.
 */
export function formatarVelocidadeVelejo(nos: number | null | undefined): string {
  if (nos === null || nos === undefined || !Number.isFinite(nos)) return '—';
  return `${nosParaKmh(nos).toFixed(1)} ${UNIDADE_VELOCIDADE_VELEJO}`;
}
