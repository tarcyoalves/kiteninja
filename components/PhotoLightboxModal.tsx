'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { X, MapPin, Calendar, Wind, Download, Share2 } from 'lucide-react';

interface PhotoLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
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
 */
export const PhotoLightboxModal: React.FC<PhotoLightboxModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  title,
  authorName,
  spotName,
  windKnots,
  date,
}) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Para devolver o foco a quem abriu o modal ao fechar.
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
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
  }, [isOpen, onClose]);

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: title || 'Foto de velejo no KiteNinja',
          text: spotName ? `Velejo em ${spotName}` : 'Velejo no KiteNinja',
          url: imageUrl,
        });
      } catch {
        // Usuário cancelou o compartilhamento: não é erro.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(imageUrl);
    } catch {
      // Clipboard bloqueado (contexto não seguro): o link "Abrir original"
      // abaixo continua sendo a saída manual.
    }
  }, [imageUrl, title, spotName]);

  if (!isOpen || !imageUrl) return null;

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
        <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-b from-black/80 to-transparent absolute top-0 left-0 right-0 z-20 text-white">
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

        <div className="relative flex-1 bg-black flex items-center justify-center min-h-[300px] sm:min-h-[480px] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element -- as fotos vêm
              de domínios arbitrários informados pelo velejador; next/image
              exigiria allowlist de hosts e quebraria com URL nova. */}
          <img
            src={imageUrl}
            alt={title ? `Foto: ${title}` : 'Foto de velejo'}
            className="w-full h-full max-h-[70vh] object-contain select-none"
          />
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
              href={imageUrl}
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
