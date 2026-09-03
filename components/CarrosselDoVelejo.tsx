'use client';

import React, { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ImageIcon, Map as MapIcon } from 'lucide-react';
import { TrilhaMiniatura } from './TrilhaMiniatura';

/**
 * O Leaflet real só entra quando o card está (perto de) visível — mesmo
 * arranjo do card antes de existir carrossel: `dynamic` cuida do bundle, o
 * portão `emViewport` cuida do ciclo de vida.
 */
const CardSessaoFeedMapa = dynamic(
  () => import('./CardSessaoFeedMapa').then((m) => m.CardSessaoFeedMapa),
  { ssr: false }
);

interface Props {
  sessaoId: string;
  trilha?: Array<[number, number, number]>;
  /** Quantas fotos (a listagem manda só o número, nunca as imagens). */
  totalFotos: number;
  /** O card está na tela, ou perto: libera montar o mapa e buscar a foto. */
  emViewport: boolean;
}

/**
 * Trilha e foto do velejo, lado a lado, deslizando na horizontal.
 *
 * POR QUE ASSIM
 *
 * O card mostrava só a trilha, e a foto do velejo — gravada em
 * `sessions_log.photo_url` desde sempre — **não aparecia em lugar nenhum do
 * feed**: `app/api/feed/route.ts` sequer selecionava a coluna. Mais um caso da
 * família recorrente desta base: o dado é registrado direito e não chega a
 * lugar nenhum.
 *
 * A trilha vem PRIMEIRO de propósito. É o que diferencia um velejo de uma foto
 * qualquer — é o registro do que aconteceu, e é o que a pessoa não consegue
 * postar em outro app. A foto é o complemento.
 *
 * AS FOTOS SÃO BUSCADAS AQUI, não recebidas por prop. As novas são URLs
 * curtas do Vercel Blob e caberiam na listagem; as antigas são data URL de até
 * 1,5 MB cada (ver `session_photos` em lib/schema.sql), e vinte delas numa
 * página seriam dezenas de MB no 4G da praia. Um caminho só para os dois
 * formatos é melhor que dois caminhos condicionais. A busca acontece quando
 * `emViewport` — o mesmo portão que monta o mapa, reaproveitado em vez de um
 * segundo observer.
 *
 * Rolagem nativa com `scroll-snap`, sem biblioteca: é um punhado de slides
 * numa direção só, e o gesto de arrastar do próprio navegador já é melhor que
 * qualquer reimplementação em JS — inclusive para quem usa leitor de tela ou
 * teclado.
 */
export const CarrosselDoVelejo: React.FC<Props> = ({
  sessaoId,
  trilha,
  totalFotos,
  emViewport,
}) => {
  const [fotos, setFotos] = useState<string[] | null>(null);
  const [indice, setIndice] = useState(0);
  const trilhoRef = useRef<HTMLDivElement>(null);

  const temTrilha = Array.isArray(trilha) && trilha.length > 1;

  useEffect(() => {
    // Uma vez só: `fotos` deixar de ser null é o próprio sinal de "já busquei".
    if (!emViewport || totalFotos === 0 || fotos !== null) return;
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessaoId}/fotos`);
        if (!res.ok) return;
        const body = await res.json().catch(() => null);
        if (cancelado || !Array.isArray(body?.fotos)) return;
        setFotos(body.fotos.map(String));
      } catch {
        // Sem rede: o card fica só com a trilha. Uma foto que não carregou não
        // pode derrubar o registro do velejo, que é o conteúdo principal.
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [emViewport, totalFotos, fotos, sessaoId]);

  const slides: Array<{ chave: string; tipo: 'mapa' | 'foto'; conteudo: React.ReactNode }> = [];

  if (temTrilha) {
    slides.push({
      chave: 'mapa',
      tipo: 'mapa',
      conteudo: (
        <>
          <TrilhaMiniatura trilha={trilha!} className="absolute inset-0 w-full h-full" />
          {emViewport && (
            <div className="absolute inset-0 animate-[fadeInMapa_0.4s_ease-out]">
              <CardSessaoFeedMapa trilha={trilha!} />
            </div>
          )}
        </>
      ),
    });
  }

  /*
   * Os slides de foto nascem do NÚMERO, não da lista carregada.
   *
   * Assim o carrossel já tem o tamanho final antes de qualquer imagem chegar:
   * as bolinhas não mudam de quantidade no meio da leitura, e o card não pula
   * quando a resposta volta. A lista só preenche o conteúdo de cada slide que
   * já estava lá.
   */
  for (let i = 0; i < totalFotos; i++) {
    const url = fotos?.[i];
    slides.push({
      chave: `foto-${i}`,
      tipo: 'foto',
      conteudo: url ? (
        <img
          src={url}
          alt={totalFotos > 1 ? `Foto ${i + 1} de ${totalFotos} do velejo` : 'Foto do velejo'}
          className="absolute inset-0 w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
          <ImageIcon size={22} className="text-slate-700 animate-pulse" />
        </div>
      ),
    });
  }

  // Sessão digitada à mão, sem trilha nem foto: nada a mostrar. Nunca inventa
  // um mapa — era assim antes do carrossel e continua sendo.
  if (slides.length === 0) return null;

  /**
   * Índice pela posição de rolagem, não por estado que o gesto teria de
   * avisar: arrastar com o dedo é o próprio navegador rolando, e qualquer
   * controle nosso por cima disso brigaria com ele.
   */
  const aoRolar = () => {
    const el = trilhoRef.current;
    if (!el || el.clientWidth === 0) return;
    const novo = Math.round(el.scrollLeft / el.clientWidth);
    setIndice((atual) => (atual === novo ? atual : novo));
  };

  const irPara = (i: number) => {
    const el = trilhoRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="relative">
      <div
        ref={trilhoRef}
        onScroll={aoRolar}
        className="flex overflow-x-auto snap-x snap-mandatory no-scrollbar"
        // Um slide só não vira carrossel: sem mais nada para onde ir, o rótulo
        // de "carrossel" e o gesto sugerido seriam mentira.
        {...(slides.length > 1
          ? { role: 'group', 'aria-roledescription': 'carrossel', 'aria-label': 'Trilha e foto do velejo' }
          : {})}
      >
        {slides.map((s, i) => (
          <div
            key={s.chave}
            className="relative shrink-0 w-full aspect-4/3 sm:aspect-16/10 bg-black overflow-hidden snap-center"
            aria-label={slides.length > 1 ? `${i + 1} de ${slides.length}` : undefined}
          >
            {s.conteudo}
          </div>
        ))}
      </div>

      {slides.length > 1 && (
        <>
          {/* Bolinhas: posição E atalho. Alvo de 24px mesmo com 6px de ponto
              visível — o ponto pequeno é estética, o alvo grande é o dedo. */}
          <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-1 pointer-events-none">
            {slides.map((s, i) => (
              <button
                key={s.chave}
                type="button"
                onClick={() => irPara(i)}
                aria-label={
                  s.tipo === 'mapa'
                    ? 'Ver a trilha'
                    : totalFotos > 1
                      ? `Ver a foto ${slides.slice(0, i + 1).filter((x) => x.tipo === 'foto').length}`
                      : 'Ver a foto'
                }
                aria-current={indice === i}
                className="pointer-events-auto w-6 h-6 flex items-center justify-center"
              >
                <span
                  className={`block rounded-full transition-all ${
                    indice === i ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/50'
                  }`}
                />
              </button>
            ))}
          </div>

          {/* Selo do slide atual: sem ele, uma foto de praia e um mapa de
              satélite se confundem numa olhada rápida. */}
          <div className="absolute top-2 right-2 px-2 py-1 rounded-full bg-black/55 backdrop-blur-xs text-white text-[10px] font-black flex items-center gap-1 pointer-events-none">
            {slides[indice]?.tipo === 'foto' ? (
              <>
                <ImageIcon size={11} />
                <span>
                  {totalFotos > 1
                    ? `Foto ${slides.slice(0, indice + 1).filter((x) => x.tipo === 'foto').length}/${totalFotos}`
                    : 'Foto'}
                </span>
              </>
            ) : (
              <>
                <MapIcon size={11} />
                <span>Trilha</span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
};
