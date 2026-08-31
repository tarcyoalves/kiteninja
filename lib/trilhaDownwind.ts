/**
 * Regras puras do transporte da trilha do downwind — o rastro que cada
 * velejador deixa no mapa ao vivo.
 *
 * O PROBLEMA QUE ESTE ARQUIVO RESOLVE: uma travessia de 3h com 20 pessoas
 * gera ~4.800 pontos. Mandar tudo isso a cada poll de 30s multiplicaria o
 * payload por centenas — inviável no 4G da praia e na cota do plano gratuito
 * (Neon free + Vercel Hobby). A solução é carga inicial AMOSTRADA + delta por
 * cursor, e é aqui que mora a aritmética disso, fora do componente, para poder
 * ser testada sem mapa, sem rede e sem banco.
 *
 * Tudo aqui é função pura. O hook que faz as requisições é
 * lib/useDownwindBeacon.ts; o desenho é components/DownwindMapa.tsx.
 */

/**
 * Ponto de trilha como tupla `[lat, lng, tsMs]`, não objeto.
 *
 * Não é micro-otimização gratuita: com 20 participantes × 120 pontos, as
 * chaves JSON repetidas (`"lat":`, `"lng":`, `"registradoEm":`) seriam a maior
 * parte do payload — mais que os próprios números. A tupla corta isso, e o
 * custo é um comentário como este explicando a ordem dos campos.
 */
export type PontoTrilha = [lat: number, lng: number, tsMs: number];

/**
 * Sua própria trilha na carga inicial. 120 pontos numa travessia de 3h é um
 * ponto a cada ~90s — na escala de zoom de um mapa costeiro a polilinha já sai
 * visualmente lisa, e é a sua trilha que fica em destaque na tela.
 */
export const MAX_PONTOS_TRILHA_PROPRIA = 120;

/**
 * A trilha dos OUTROS na carga inicial vem só com a cauda recente. O resto se
 * preenche sozinho pelos deltas conforme a travessia corre — ninguém abre o
 * mapa precisando do histórico completo de 19 pessoas de uma vez, mas todo
 * mundo precisa que a primeira tela carregue rápido num 4G ruim.
 */
export const MAX_PONTOS_TRILHA_OUTROS = 30;

/**
 * Teto do delta por participante. Protege o caso do velejador que ficou 45 min
 * sem sinal e volta pedindo uma hora de trilha de todo mundo de uma vez — sem
 * o teto, é exatamente aí que a função serverless estoura o tempo do Hobby.
 */
export const MAX_PONTOS_DELTA_POR_PARTICIPANTE = 60;

/**
 * Teto acumulado por participante na memória do cliente. Uma travessia longa
 * com polling de 30s chegaria a centenas de pontos por pessoa; acima disso a
 * polilinha não fica mais detalhada, só pesa no celular.
 */
export const MAX_PONTOS_ACUMULADOS = 600;

/**
 * Quantos pontos recentes formam a "cauda viva" — a parte da trilha desenhada
 * grossa e opaca, contra o corpo antigo, fino e translúcido. Duas polilinhas
 * por pessoa em vez de gradiente: o Leaflet não faz traço com gradiente, e uma
 * polilinha por segmento criaria centenas de camadas e mataria o desempenho no
 * celular.
 */
export const PONTOS_CAUDA_VIVA = 20;

/**
 * Passo de amostragem para reduzir `total` pontos a no máximo `limite`.
 *
 * NUNCA devolve 0: um passo zero faria `rn % passo` dividir por zero no SQL e
 * `i % passo` devolver NaN no cliente. `GREATEST(1, ...)` no SQL e este
 * `Math.max(1, ...)` são a mesma guarda dos dois lados.
 *
 * `ceil` e não `floor`: com `floor`, 500 pontos para um limite de 120 dariam
 * passo 4 e devolveriam 126 — estourando justamente o teto que existe para
 * segurar o payload. Arredondar para cima entrega um pouco menos de resolução
 * e nunca ultrapassa o orçamento, que é a troca certa aqui.
 */
export function passoAmostragem(total: number, limite: number): number {
  if (limite <= 0) return 1;
  if (total <= limite) return 1;
  return Math.max(1, Math.ceil(total / limite));
}

/**
 * Reduz uma trilha a no máximo `limite` pontos, SEMPRE preservando o mais
 * recente.
 *
 * Preservar o último não é detalhe estético: é o ponto que encosta no marcador
 * da pessoa. Se a amostragem o descartasse, a trilha terminaria a alguns
 * quilômetros da bolinha e a tela sugeriria que o velejador saltou.
 */
export function amostrarTrilha(pontos: PontoTrilha[], limite: number): PontoTrilha[] {
  return amostrarPontos(pontos, limite, (p) => p[2]);
}

/**
 * Versão genérica de `amostrarTrilha`, parametrizada por como se lê o
 * timestamp do ponto.
 *
 * Existe porque o mapa ao vivo/replay (`/api/downwind/[id]/live`) carrega
 * `[lat, lng, velocidade, ts]` — quatro elementos, timestamp no índice 3 —
 * enquanto `PontoTrilha` tem três. Sem esta generalização, aquela rota
 * precisaria de uma cópia da amostragem, e a regra sutil de "preservar SEMPRE
 * o mais recente" passaria a existir em dois lugares para divergir num deles.
 */
export function amostrarPontos<T>(pontos: T[], limite: number, ts: (p: T) => number): T[] {
  if (pontos.length <= limite) return pontos;
  const passo = passoAmostragem(pontos.length, limite);
  const saida: T[] = [];
  for (let i = 0; i < pontos.length; i += passo) saida.push(pontos[i]);
  const ultimo = pontos[pontos.length - 1];
  const ultimoDaSaida = saida[saida.length - 1];
  if (ultimoDaSaida === undefined || ts(ultimoDaSaida) !== ts(ultimo)) saida.push(ultimo);
  return saida;
}

/**
 * Junta o que já está na tela com o que acabou de chegar no delta.
 *
 * Dedup por timestamp e não por identidade: o mesmo ponto pode voltar quando o
 * cursor não avança (ver `proximoCursor`), e sem dedup a trilha ganharia
 * vértices repetidos que o Leaflet desenha como um nó.
 *
 * Descarta os MAIS ANTIGOS ao estourar o teto, nunca os recentes — o passado
 * distante da travessia é o que menos importa para "cadê o pessoal agora".
 */
export function mesclarTrilha(
  atual: PontoTrilha[],
  novos: PontoTrilha[],
  maxPontos = MAX_PONTOS_ACUMULADOS
): PontoTrilha[] {
  return mesclarPontos(atual, novos, (p) => p[2], maxPontos);
}

/** Versão genérica de `mesclarTrilha` — ver `amostrarPontos` para o porquê. */
export function mesclarPontos<T>(
  atual: T[],
  novos: T[],
  ts: (p: T) => number,
  maxPontos = MAX_PONTOS_ACUMULADOS
): T[] {
  if (novos.length === 0) return atual;

  const porTs = new Map<number, T>();
  for (const p of atual) porTs.set(ts(p), p);
  for (const p of novos) porTs.set(ts(p), p);

  const juntos = Array.from(porTs.values()).sort((a, b) => ts(a) - ts(b));
  return juntos.length > maxPontos ? juntos.slice(juntos.length - maxPontos) : juntos;
}

/**
 * Decide o cursor que o cliente devolve no próximo `?desde=`.
 *
 * A REGRA QUE EVITA BURACO NA TRILHA: quando o servidor bate no teto de linhas
 * e marca a resposta como `parcial`, o cursor NÃO pode saltar para "agora" —
 * ficaram pontos por entregar entre o último recebido e o instante atual, e
 * pular esse intervalo abriria um vão permanente no rastro, que a tela
 * desenharia como uma reta atravessando a praia. Nesse caso o cursor avança
 * só até o último ponto de fato recebido, e o próximo poll continua de lá.
 *
 * Delta vazio mantém o cursor anterior: sem pontos novos não há o que avançar,
 * e adiantar o cursor pularia o que ainda vai chegar com atraso de rede.
 */
export function proximoCursor(
  cursorAtual: string | null,
  ultimoTsRecebido: number | null
): string | null {
  if (ultimoTsRecebido === null) return cursorAtual;
  const candidato = new Date(ultimoTsRecebido).toISOString();
  if (cursorAtual === null) return candidato;
  // Nunca retroceder: um lote fora de ordem não pode fazer o cliente repedir
  // trilha que ele já tem.
  return candidato > cursorAtual ? candidato : cursorAtual;
}

/**
 * Maior timestamp de um lote de pontos, ou null se o lote veio vazio.
 * Extraída porque é o insumo de `proximoCursor` e merece o mesmo teste.
 */
export function ultimoTimestamp(pontos: PontoTrilha[]): number | null {
  let maior: number | null = null;
  for (const p of pontos) {
    if (maior === null || p[2] > maior) maior = p[2];
  }
  return maior;
}

/**
 * Divide a trilha nas duas camadas que o mapa desenha: o corpo antigo (fino e
 * translúcido) e a cauda viva (grossa e opaca).
 *
 * As duas compartilham o ponto de junção de propósito — sem isso apareceria um
 * vão de um segmento entre as camadas, exatamente no meio da linha.
 */
export function dividirCauda(
  pontos: PontoTrilha[],
  tamanhoCauda = PONTOS_CAUDA_VIVA
): { corpo: PontoTrilha[]; cauda: PontoTrilha[] } {
  if (pontos.length <= tamanhoCauda) return { corpo: [], cauda: pontos };
  const corte = pontos.length - tamanhoCauda;
  // `corte - 1` faz o corpo terminar no mesmo ponto em que a cauda começa.
  return { corpo: pontos.slice(0, corte), cauda: pontos.slice(corte - 1) };
}
