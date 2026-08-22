/**
 * Projeção pura de uma trilha GPS num `viewBox` de SVG — o miolo de
 * `components/TrilhaMiniatura.tsx` (Fase 3 do plano de rede social, seção 3
 * "Fluidez").
 *
 * POR QUE ISTO EXISTE, E POR QUE É SVG E NÃO LEAFLET: rolar o feed com um
 * `<MapContainer>` do Leaflet por card destrói o celular — cada mapa é uma
 * instância viva com listeners, canvas e dezenas de tiles. Vinte cards
 * visíveis de uma vez seriam vinte mapas. A miniatura SVG não pede rede
 * nenhuma, não monta `useEffect`, e desenha no mesmo frame que o resto do
 * card — é o que o velejador vê ao rolar rápido, e é por isso que a função
 * de projeção precisa ser barata e pura (testável sem DOM, sem canvas, sem
 * mapa de verdade), para o componente poder chamá-la direto do corpo do
 * render.
 *
 * "Mercator simples" (ver seção 3 do plano): compensamos a longitude pelo
 * cosseno da latitude média da própria trilha, não uma projeção Mercator de
 * mapa-múndi completa — na escala de UMA sessão de kitesurf (poucos
 * quilômetros), isso já corrige o achatamento de longitude o bastante para a
 * trilha não parecer torta.
 */

export interface PontoTrilhaSvg {
  x: number;
  y: number;
}

/** viewBox padrão do componente — aproxima o aspecto 4:3 usado no card
 * (mesmo aspecto de `aspect-4/3` do antigo post do feed), para o SVG
 * preencher o retângulo sem sobra/corte quando `preserveAspectRatio="xMidYMid
 * meet"` (o padrão do próprio SVG) encaixa o viewBox no container. */
export const TRILHA_SVG_LARGURA = 400;
export const TRILHA_SVG_ALTURA = 300;

/** Margem interna, como fração da largura/altura do viewBox, para a trilha
 * nunca encostar na borda do card (ficaria cortada visualmente pela borda
 * arredondada do card por cima). */
const MARGEM_FRACAO = 0.12;

/**
 * Projeta uma trilha `[lat, lng, tsMs]` em pontos `{x, y}` dentro de um
 * `viewBox` de `largura` × `altura`.
 *
 * - Trilha vazia -> `[]` (o componente não desenha `<polyline>` nenhuma).
 * - 1 ponto -> um único ponto centralizado (não dá para desenhar uma linha
 *   com 1 ponto só, mas ainda faz sentido marcar "aqui foi a sessão").
 * - N pontos -> UMA escala (não uma por eixo) aplicada aos dois eixos, para
 *   preservar a proporção real da trilha: uma trilha maioritariamente
 *   norte-sul não pode virar um retângulo gordo só porque o viewBox é mais
 *   largo que alto. `y` é invertido (lat maior = mais ao norte = mais para
 *   CIMA na tela = `y` MENOR), porque SVG cresce `y` para baixo e latitude
 *   cresce para cima.
 */
export function projetarTrilhaSvg(
  trilha: Array<[number, number, number]>,
  largura: number = TRILHA_SVG_LARGURA,
  altura: number = TRILHA_SVG_ALTURA
): PontoTrilhaSvg[] {
  if (trilha.length === 0) return [];

  if (trilha.length === 1) {
    return [{ x: largura / 2, y: altura / 2 }];
  }

  const latMedia = trilha.reduce((soma, [lat]) => soma + lat, 0) / trilha.length;
  const cosLatMedia = Math.cos((latMedia * Math.PI) / 180);

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLngProj = Infinity;
  let maxLngProj = -Infinity;
  const lngsProjetadas: number[] = new Array(trilha.length);

  for (let i = 0; i < trilha.length; i++) {
    const [lat, lng] = trilha[i];
    const lngProj = lng * cosLatMedia;
    lngsProjetadas[i] = lngProj;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lngProj < minLngProj) minLngProj = lngProj;
    if (lngProj > maxLngProj) maxLngProj = lngProj;
  }

  // Amplitude mínima diferente de zero: uma trilha parada num único ponto
  // (ou quase) não pode gerar divisão por zero na escala abaixo.
  const amplitudeLat = Math.max(maxLat - minLat, 1e-9);
  const amplitudeLng = Math.max(maxLngProj - minLngProj, 1e-9);

  const margemX = largura * MARGEM_FRACAO;
  const margemY = altura * MARGEM_FRACAO;
  const larguraUtil = largura - 2 * margemX;
  const alturaUtil = altura - 2 * margemY;

  // A MESMA escala nos dois eixos — o menor dos dois candidatos, para a
  // trilha inteira caber sem distorcer proporção nem estourar a margem.
  const escala = Math.min(larguraUtil / amplitudeLng, alturaUtil / amplitudeLat);

  const larguraTrilhaPx = amplitudeLng * escala;
  const alturaTrilhaPx = amplitudeLat * escala;
  // Centraliza o que sobrou de espaço útil no eixo que "folgou" (a trilha
  // raramente tem a mesma proporção do viewBox).
  const offsetX = margemX + (larguraUtil - larguraTrilhaPx) / 2;
  const offsetY = margemY + (alturaUtil - alturaTrilhaPx) / 2;

  return trilha.map(([lat], i) => ({
    x: offsetX + (lngsProjetadas[i] - minLngProj) * escala,
    y: offsetY + (maxLat - lat) * escala,
  }));
}

/** Converte pontos projetados no formato que o atributo `points` de um SVG
 * `<polyline>` espera (`"x1,y1 x2,y2 ..."`). Extraída à parte da projeção
 * para o componente não precisar montar essa string à mão nem repeti-la para
 * as camadas de "casing" (halo por baixo + traço colorido por cima). */
export function pontosParaAtributoSvg(pontos: PontoTrilhaSvg[]): string {
  return pontos.map((p) => `${p.x},${p.y}`).join(' ');
}
