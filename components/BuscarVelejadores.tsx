'use client';

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Search, User, Users, X } from 'lucide-react';
import { BotaoSeguir } from './BotaoSeguir';
import { DEBOUNCE_BUSCA_MS, deveBuscarVelejadores, MIN_CHARS_BUSCA } from '@/lib/buscaVelejadores';
import type { RelacaoRider, RiderSearchResult } from '@/types';

interface BuscarVelejadoresProps {
  onClose: () => void;
  /** Abre o perfil público do rider tocado (components/RiderProfileModal.tsx). */
  onAbrirPerfil: (riderId: string) => void;
}

interface RespostaBusca {
  riders: RiderSearchResult[];
}

interface LinhaResultadoProps {
  rider: RiderSearchResult;
  onAbrir: (riderId: string) => void;
  onChangeRelacao: (riderId: string, relacao: RelacaoRider) => void;
}

/**
 * Uma linha de resultado — `React.memo` (seção "Fluidez" da Fase 4): a lista
 * pode ter até 20 linhas (LIMIT da rota) re-render juntas a cada tecla nova
 * digitada no campo de busca; sem memo, cada tecla re-renderizaria as 20 à
 * toa mesmo quando só a lista de cima muda de conteúdo, não de identidade.
 *
 * Mesmo idioma visual do painel "Online" de views/ChatView.tsx (avatar em
 * anel colorido + nome + bandeira + linha secundária + ação à direita).
 */
const LinhaResultado: React.FC<LinhaResultadoProps> = memo(function LinhaResultado({
  rider,
  onAbrir,
  onChangeRelacao,
}) {
  return (
    <div className="p-3 rounded-2xl border border-slate-700/80 bg-[#1E293B] flex items-center gap-3 transition-all hover:border-slate-600">
      <button
        type="button"
        onClick={() => onAbrir(rider.id)}
        className="flex items-center gap-3 min-w-0 flex-1 text-left"
      >
        <div className="w-11 h-11 shrink-0 rounded-full bg-slate-800 ring-2 ring-cyan-400/70 overflow-hidden flex items-center justify-center shadow-xs">
          {rider.avatarUrl ? (
            <img src={rider.avatarUrl} alt={rider.name} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <User size={20} className="text-slate-300" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-black text-sm text-white truncate">{rider.name}</span>
            <span className="text-sm shrink-0">{rider.countryFlag}</span>
            <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-800/80 px-1.5 py-0.2 rounded-md shrink-0">
              #{rider.riderId}
            </span>
          </div>
          <p className="text-[11px] text-slate-400 truncate">
            {rider.riderLevel}
            {rider.homeSpot ? ` • ${rider.homeSpot}` : ''}
          </p>
        </div>
      </button>

      <BotaoSeguir
        riderId={rider.id}
        relacao={rider.relacao}
        onChangeRelacao={(relacao) => onChangeRelacao(rider.id, relacao)}
      />
    </div>
  );
});

/**
 * Folha de busca de velejadores (seção 4.3 do plano de rede social) — o
 * ponto de entrada que faltava para o ciclo achar → seguir → ver o velejo
 * fechar: sem esta tela, a busca e o seguir da Fase 2 eram só API.
 *
 * Full-screen, mesmo idioma de ListingDetailModal/SpotDetailModal (o app usa
 * muito modal de tela cheia — ver justificativa no relatório da fase).
 */
export const BuscarVelejadores: React.FC<BuscarVelejadoresProps> = ({ onClose, onAbrirPerfil }) => {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<RiderSearchResult[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [jaBuscouUmaVez, setJaBuscouUmaVez] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  // Incrementado a cada busca disparada; a resposta só é aplicada se ainda
  // for a mais recente — sem isto, digitar rápido ("jo" -> "joa" -> "joao")
  // poderia deixar a resposta de "jo" chegar DEPOIS da de "joao" (nunca
  // garantido pela rede) e sobrescrever o resultado certo com um obsoleto.
  const buscaIdRef = useRef(0);

  const buscar = useCallback(async (termo: string) => {
    const minhaBuscaId = ++buscaIdRef.current;
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/riders/search?q=${encodeURIComponent(termo)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Falha ao buscar velejadores.');
      const body = (await res.json()) as RespostaBusca;
      if (buscaIdRef.current !== minhaBuscaId) return; // resposta obsoleta, ignora
      setResultados(body.riders);
    } catch {
      if (buscaIdRef.current !== minhaBuscaId) return;
      setErro('Não deu para buscar agora. Tente de novo.');
    } finally {
      if (buscaIdRef.current === minhaBuscaId) {
        setCarregando(false);
        setJaBuscouUmaVez(true);
      }
    }
  }, []);

  // Debounce (~300ms, seção 4.3 do plano): espera o velejador parar de digitar
  // antes de gastar uma ida ao servidor por tecla. Menos de MIN_CHARS_BUSCA
  // nem chega a agendar — a rota já devolveria vazio, mas a viagem é inútil.
  useEffect(() => {
    if (!deveBuscarVelejadores(query)) {
      buscaIdRef.current++; // invalida qualquer resposta em voo do termo anterior
      // Limpa resultados de forma controlada via state inicial
      return;
    }
    const termo = query.trim();
    const timer = setTimeout(() => buscar(termo), DEBOUNCE_BUSCA_MS);
    return () => clearTimeout(timer);
  }, [query, buscar]);

  // Estado computado a partir de query e estados - evita chamada de setState no effect
  const deveMostrarResultados = deveBuscarVelejadores(query);
  const resultadosExibidos = deveMostrarResultados ? resultados : [];
  const carregandoExibido = deveMostrarResultados && carregando;
  const erroExibido = deveMostrarResultados ? erro : null;

  /**
   * Fecha a busca — mas primeiro tira o foco do campo de texto, se ele
   * estiver focado. Sem isto, o menu flutuante desaparecia para sempre
   * depois de abrir e fechar a busca de Riders: o campo de texto tem foco
   * automático ao abrir (linha abaixo), `lib/useKeyboardVisible.ts` (usado
   * por `BottomNav`) rastreia teclado via `focusin`/`focusout` no
   * `document`, e desmontar um elemento que AINDA está focado nem sempre
   * dispara `focusout` a tempo em todo navegador — o hook (que vive em
   * `BottomNav`, um componente à parte que nunca desmonta) ficava travado
   * achando que o teclado continuava aberto. Tirar o foco explicitamente
   * AQUI, com o campo ainda montado, garante o evento antes da remoção.
   */
  const fechar = useCallback(() => {
    inputRef.current?.blur();
    onClose();
  }, [onClose]);

  // Foco automático no campo ao abrir + Esc fecha, mesmo padrão de
  // ListingDetailModal.
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
    };
    window.addEventListener('keydown', onKey);
    const anterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = anterior;
    };
  }, [fechar]);

  const handleAbrir = useCallback((riderId: string) => onAbrirPerfil(riderId), [onAbrirPerfil]);

  const handleChangeRelacao = useCallback((riderId: string, relacao: RiderSearchResult['relacao']) => {
    setResultados((prev) => prev.map((r) => (r.id === riderId ? { ...r, relacao } : r)));
  }, []);

  const tentarDeNovo = () => buscar(query.trim());

  return (
    <div
      className="fixed inset-0 z-modal flex flex-col bg-[#0B1220]"
      role="dialog"
      aria-modal="true"
      aria-label="Buscar velejadores"
    >
      {/* Cabeçalho com campo de busca — sticky, overlay-safe-top como os
          outros modais full-screen do app. */}
      <div className="shrink-0 overlay-safe-top bg-[#0F172A] border-b border-slate-800 px-3 pt-2 pb-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nome ou #rider ID..."
              className="w-full h-11 pl-9 pr-9 rounded-xl bg-[#1E293B] border border-slate-700 text-[15px] text-white placeholder-slate-400 focus:outline-hidden focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/50 transition-all"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 p-1.5"
                aria-label="Limpar busca"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={fechar}
            className="min-w-11 min-h-11 shrink-0 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
            aria-label="Fechar busca"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Corpo: os 5 estados explícitos (mesmo padrão de views/ChatView.tsx —
          carregando / erro com retry / vazio inicial / sem resultado / lista). */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2 pb-above-nav">
        {!deveBuscarVelejadores(query) && (
          <div className="mt-10 text-center text-slate-400">
            <Search size={30} className="mx-auto text-cyan-400/70" />
            <p className="mt-3 font-black text-slate-100 text-sm">Busque por nome ou ID</p>
            <p className="mt-1.5 text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
              Digite pelo menos {MIN_CHARS_BUSCA} letras do nome ou o #rider ID de quem você quer seguir.
            </p>
          </div>
        )}

        {deveBuscarVelejadores(query) && carregando && !jaBuscouUmaVez && (
          <div className="flex justify-center py-10 text-cyan-400">
            <Loader2 size={26} className="animate-spin" />
          </div>
        )}

        {deveBuscarVelejadores(query) && erro && (
          <div className="mt-6 p-6 rounded-2xl border border-rose-500/40 bg-rose-500/10 text-center">
            <AlertTriangle size={26} className="mx-auto text-rose-400" />
            <p className="mt-2.5 font-black text-slate-100 text-sm">Não foi possível buscar</p>
            <p className="mt-1 text-xs text-slate-300">{erro}</p>
            <button
              type="button"
              onClick={tentarDeNovo}
              className="mt-3.5 px-5 h-10 rounded-xl bg-cyan-500 text-slate-950 font-black text-xs active:scale-95 transition-transform"
            >
              Tentar de novo
            </button>
          </div>
        )}

        {deveBuscarVelejadores(query) && !erro && jaBuscouUmaVez && resultados.length === 0 && (
          <div className="mt-8 p-6 rounded-2xl border border-slate-800 bg-[#1E293B]/50 text-center">
            <Users size={26} className="mx-auto text-slate-500" />
            <p className="mt-3 font-black text-slate-100 text-sm">Nenhum velejador encontrado</p>
            <p className="mt-1.5 text-xs text-slate-400">Confira o nome ou o #rider ID e tente de novo.</p>
          </div>
        )}

        {resultados.map((rider) => (
          <LinhaResultado
            key={rider.id}
            rider={rider}
            onAbrir={handleAbrir}
            onChangeRelacao={handleChangeRelacao}
          />
        ))}
      </div>
    </div>
  );
};
