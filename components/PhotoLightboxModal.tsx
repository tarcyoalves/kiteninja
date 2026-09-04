'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, MapPin, Calendar, Wind, Download, Share2, ChevronLeft, ChevronRight } from 'lucide-react';

interface PhotoLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Foto a mostrar — ou a capa, quando `imageUrls` traz o conjunto inteiro. */
  imageUrl: string;
  /**
   * Todas as fotos do velejo. Quando vem com mais de uma, o visualizador
   * percorre o conjunto; quando falta, o comportamento é o de sempre (uma foto
   * só), que é o que o anúncio do mercado usa — ele já pagina por fora.
   */
  imageUrls?: string[];
  title?: string;
  authorName?: string;
  spotName?: string;
  windKnots?: number;
  date?: string;
}

/**
 * Foto de sessão em tela cheia.
 *
 * O velejador abre isso para ver a condição na foto (tamanho da onda, se tinha
 * gente na água), então a imagem ganha o palco e os metadados ficam em barras
 * discretas por cima e por baixo.
 *
 * POR QUE O CONTEÚDO É UM COMPONENTE SEPARADO
 *
 * O índice da foto atual precisa voltar a zero toda vez que o visualizador
 * abre com outro velejo. Zerar isso dentro de um efeito seria `setState` no
 * corpo do efeito — o que o lint do React Compiler reprova, e com razão: é uma
 * renderização a mais e um quadro com o índice errado. Montar e desmontar pela
 * `key` resolve na origem, sem estado a sincronizar.
 */
export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = (props) => {
  const fotos = props.imageUrls?.length ? props.imageUrls : props.imageUrl ? [props.imageUrl] : [];
  if (!props.isOpen || fotos.length === 0) return null;
  // Chave curta: o conjunto pode ser data URL de 1,5 MB cada (fotos antigas),
  // e comparar isso inteiro a cada render seria desperdício puro.
  const chave = `${fotos.length}:${fotos[0].slice(0, 64)}`;
  return <LightboxAberto key={chave} {...props} fotos={fotos} />;
};

const LightboxAberto: React.FC<PhotoLightboxModalProps & { fotos: string[] }> = ({
  onClose,
  fotos,
  title,
  authorName,
  spotName,
  windKnots,
  date,
}) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const trilhoRef = useRef<HTMLDivElement>(null);
  // Para devolver o foco a quem abriu o modal ao fechar.
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [indice, setIndice] = useState(0);

  const total = fotos.length;
  const imagemAtual = fotos[Math.min(indice, total - 1)];

  /**
   * Rolagem nativa com `scroll-snap`, igual ao carrossel do feed: arrastar com
   * o dedo é o próprio navegador rolando. Os botões só empurram o mesmo
   * trilho, então gesto e clique nunca discordam sobre onde a lista está.
   */
  const irPara = useCallback(
    (i: number) => {
      const el = trilhoRef.current;
      const alvo = Math.max(0, Math.min(i, total - 1));
      if (!el) {
        setIndice(alvo);
        return;
      }
      el.scrollTo({ left: alvo * el.clientWidth, behavior: 'smooth' });
    },
    [total]
  );

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // Setas percorrem as fotos. Só quando há para onde ir: senão o teclado
      // roubaria a seta de quem está rolando a página atrás por engano.
      if (total > 1 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const el = trilhoRef.current;
        const atual = el && el.clientWidth > 0 ? Math.round(el.scrollLeft / el.clientWidth) : 0;
        irPara(atual + (e.key === 'ArrowRight' ? 1 : -1));
        return;
      }

      // Prende o Tab dentro do modal: sem isso o foco escapa para a página
      // atrás, que está visualmente coberta mas continua alcançável.
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      // Restaura o valor anterior em vez de assumir 'unset': outro modal
      // aberto por baixo pode depender do overflow travado.
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [onClose, total, irPara]);

  const aoRolar = () => {
    const el = trilhoRef.current;
    if (!el || el.clientWidth === 0) return;
    const novo = Math.round(el.scrollLeft / el.clientWidth);
    setIndice((atual) => (atual === novo ? atual : novo));
  };

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: title || 'Foto de velejo no KiteNinja',
          text: spotName ? `Velejo em ${spotName}` : 'Velejo no KiteNinja',
          url: imagemAtual,
        });
      } catch {
        // Usuário cancelou o compartilhamento: não é erro.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(imagemAtual);
    } catch {
      // Clipboard bloqueado (contexto não seguro): o link "Abrir original"
      // abaixo continua sendo a saída manual.
    }
  }, [imagemAtual, title, spotName]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-lightbox bg-black/90 backdrop-blur-md flex items-center justify-center p-3 sm:p-6"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Foto de velejo'}
        onClick={(e) => e.stopPropagation()}
        className="relative max-w-4xl w-full max-h-[92vh] flex flex-col rounded-3xl bg-[#0F172A] border border-slate-800 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3.5 overlay-safe-top bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 right-0 z-20 text-white">
          <div className="flex items-center gap-2 min-w-0">
            {spotName && (
              <span className="flex items-center gap-1 text-xs font-black text-cyan-300 bg-cyan-500/20 px-3 py-1 rounded-full border border-cyan-500/30 backdrop-blur-md">
                <MapPin size={12} aria-hidden="true" />
                <span className="truncate">{spotName}</span>
              </span>
            )}
            {/* `!= null`: 0 nós é informação válida, não ausência de dado. */}
            {windKnots != null && (
              <span className="flex items-center gap-1 text-xs font-black text-emerald-300 bg-emerald-500/20 px-2.5 py-1 rounded-full border border-emerald-500/30 backdrop-blur-md">
                <Wind size={12} aria-hidden="true" />
                <span>{windKnots} nós</span>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {total > 1 && (
              <span
                className="px-2.5 py-1 rounded-full bg-black/50 border border-white/10 text-[11px] font-black text-slate-200 backdrop-blur-md"
                aria-live="polite"
              >
                {Math.min(indice, total - 1) + 1}/{total}
              </span>
            )}
            <button
              type="button"
              onClick={handleShare}
              className="p-2 rounded-full bg-black/40 hover:bg-black/70 text-slate-200 hover:text-white transition-all backdrop-blur-md border border-white/10"
              aria-label="Compartilhar foto"
            >
              <Share2 size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              ref={closeButtonRef}
              onClick={onClose}
              className="p-2 rounded-full bg-black/40 hover:bg-rose-600 text-white transition-all backdrop-blur-md border border-white/10"
              aria-label="Fechar foto"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="relative flex-1 bg-black min-h-[300px] sm:min-h-[480px] overflow-hidden">
          <div
            ref={trilhoRef}
            onScroll={total > 1 ? aoRolar : undefined}
            className="flex h-full overflow-x-auto snap-x snap-mandatory no-scrollbar"
            {...(total > 1
              ? {
                  role: 'group',
                  'aria-roledescription': 'carrossel',
                  'aria-label': 'Fotos do velejo',
                }
              : {})}
          >
            {fotos.map((url, i) => (
              <div
                key={`${i}-${url.slice(0, 48)}`}
                className="shrink-0 w-full h-full flex items-center justify-center snap-center"
                aria-label={total > 1 ? `${i + 1} de ${total}` : undefined}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- as fotos vêm
                    de domínios arbitrários informados pelo velejador; next/image
                    exigiria allowlist de hosts e quebraria com URL nova. */}
                <img
                  src={url}
                  alt={
                    total > 1
                      ? `Foto ${i + 1} de ${total}${title ? ` — ${title}` : ''}`
                      : title
                        ? `Foto: ${title}`
                        : 'Foto de velejo'
                  }
                  className="w-full h-full max-h-[70vh] object-contain select-none"
                  // Só a primeira é buscada de imediato: as antigas são data URL
                  // de até 1,5 MB, e quatro delas no 4G da praia custam caro para
                  // quem talvez nem deslize.
                  loading={i === 0 ? 'eager' : 'lazy'}
                />
              </div>
            ))}
          </div>

          {total > 1 && (
            <>
              {/* Alvo de 44px de cada lado; some no primeiro/último para não
                  oferecer um caminho que não existe. */}
              {indice > 0 && (
                <button
                  type="button"
                  onClick={() => irPara(indice - 1)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full bg-black/55 hover:bg-black/80 text-white border border-white/10 backdrop-blur-md transition-colors"
                  aria-label="Foto anterior"
                >
                  <ChevronLeft size={20} aria-hidden="true" />
                </button>
              )}
              {indice < total - 1 && (
                <button
                  type="button"
                  onClick={() => irPara(indice + 1)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full bg-black/55 hover:bg-black/80 text-white border border-white/10 backdrop-blur-md transition-colors"
                  aria-label="Próxima foto"
                >
                  <ChevronRight size={20} aria-hidden="true" />
                </button>
              )}

              <div className="absolute bottom-2 left-0 right-0 flex items-center justify-center gap-1 pointer-events-none">
                {fotos.map((url, i) => (
                  <button
                    key={`ponto-${i}-${url.slice(0, 24)}`}
                    type="button"
                    onClick={() => irPara(i)}
                    aria-label={`Ver a foto ${i + 1}`}
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
            </>
          )}
        </div>

        {(title || authorName || date) && (
          <div className="p-4 sm:p-5 bg-[#0F172A] border-t border-slate-800/80 flex items-center justify-between gap-3 text-xs text-slate-300">
            <div className="space-y-1 min-w-0">
              {title && <h3 className="font-black text-sm text-white truncate">{title}</h3>}
              <div className="flex items-center gap-2 text-slate-400 font-medium text-[11px]">
                {authorName && (
                  <span>
                    Por <strong className="text-cyan-400 font-bold">{authorName}</strong>
                  </span>
                )}
                {date && (
                  <>
                    <span aria-hidden="true">&bull;</span>
                    <span className="flex items-center gap-1">
                      <Calendar size={11} aria-hidden="true" /> {date}
                    </span>
                  </>
                )}
              </div>
            </div>

            <a
              href={imagemAtual}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs border border-slate-700 transition-colors shrink-0"
            >
              <Download size={13} aria-hidden="true" />
              <span>Abrir original</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
