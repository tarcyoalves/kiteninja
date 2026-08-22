import React from 'react';
import {
  pontosParaAtributoSvg,
  projetarTrilhaSvg,
  TRILHA_SVG_ALTURA,
  TRILHA_SVG_LARGURA,
} from '@/lib/trilhaMiniatura';

/**
 * A CAMADA DE BAIXO da fluidez do feed (seção 3 do plano de rede social).
 *
 * SVG puro: zero Leaflet, zero tile, zero requisição de rede, zero
 * `useEffect`. Renderiza no MESMO frame que o resto do card, porque
 * `projetarTrilhaSvg` é uma função pura chamada direto no corpo do
 * componente — não há nada para "carregar" depois. É o que o velejador vê ao
 * rolar rápido; o mapa de satélite de verdade (Leaflet, em
 * `components/CardSessaoFeedMapa.tsx`) só monta por cima quando o card para
 * na tela, com fade-in — e como esta miniatura já está desenhada por baixo
 * desde o primeiro render, aquele fade nunca "pisca" para branco.
 *
 * Não é `React.memo` aqui: quem já é memoizado é `CardSessaoFeed`, o pai —
 * memoizar este componente também seria redundante (mesma regra de
 * `rerender-simple-expression-in-memo` da skill vercel-react-best-practices:
 * memo custa uma comparação de props toda vez, e só compensa quando o
 * cálculo evitado é caro; aqui é sempre recalculado ou não, o pai já decide).
 */
interface TrilhaMiniaturaProps {
  trilha: Array<[number, number, number]>;
  /** Cor do traço principal — combina com a cor do avatar/tema do card,
   * mesmo espírito de `cor` em `DownwindResumoMapa`. */
  corTraco?: string;
  className?: string;
}

export const TrilhaMiniatura: React.FC<TrilhaMiniaturaProps> = ({
  trilha,
  corTraco = '#22d3ee', // cyan-400 — mesma cor de destaque do resto do app
  className,
}) => {
  const pontos = projetarTrilhaSvg(trilha);
  const atributoPoints = pontosParaAtributoSvg(pontos);
  const inicio = pontos[0];
  const fim = pontos[pontos.length - 1];

  return (
    <svg
      viewBox={`0 0 ${TRILHA_SVG_LARGURA} ${TRILHA_SVG_ALTURA}`}
      className={className}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Trilha da sessão de velejo"
    >
      {/* Fundo sólido escuro, igual ao `style={{background:'#090e1a'}}` do
          MapContainer real — garante que, quando o Leaflet montar por cima,
          o fade-in não passe por um instante de branco entre os dois. */}
      <rect x={0} y={0} width={TRILHA_SVG_LARGURA} height={TRILHA_SVG_ALTURA} fill="#090e1a" />

      {pontos.length > 1 && (
        <>
          {/* Casing em duas cores, mesma ideia de DownwindResumoMapa: satélite
              real varia muito de brilho por baixo (mar escuro, areia clara),
              então um halo de UMA cor só falharia contra metade dos casos. */}
          <polyline
            points={atributoPoints}
            fill="none"
            stroke="#000000"
            strokeWidth={7}
            strokeOpacity={0.35}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={atributoPoints}
            fill="none"
            stroke="#ffffff"
            strokeWidth={4.5}
            strokeOpacity={0.55}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={atributoPoints}
            fill="none"
            stroke={corTraco}
            strokeWidth={2.5}
            strokeOpacity={0.95}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}

      {/* Marcadores de início (A) e fim (B) — só fazem sentido com trilha de
          verdade (2+ pontos); com 1 ponto só, `inicio === fim` e desenhar os
          dois duplicaria o mesmo círculo. */}
      {inicio && pontos.length > 1 && (
        <circle cx={inicio.x} cy={inicio.y} r={5} fill="#0ea5e9" stroke="#fff" strokeWidth={1.5} />
      )}
      {fim && (
        <circle
          cx={fim.x}
          cy={fim.y}
          r={5}
          fill={pontos.length > 1 ? '#10b981' : corTraco}
          stroke="#fff"
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
};
