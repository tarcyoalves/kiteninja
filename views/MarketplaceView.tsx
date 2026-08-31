'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  Heart,
  Plus,
  MapPin,
  Package,
  Loader2,
  X,
  AlertTriangle,
  RefreshCw,
  Handshake,
} from 'lucide-react';
import { useKiteData } from '../context/KiteDataContext';
import { ListingDetailModal } from '../components/ListingDetailModal';
import {
  DEFAULT_LISTING_FILTERS,
  LISTING_CATEGORIES,
  LISTING_CONDITIONS,
  LISTING_STATES,
  activeFilterChips,
  clearFilter,
  countActiveFilters,
  formatBRL,
  formatListingSize,
  listingFiltersToQuery,
  maskBRLInput,
  parseBRLToCents,
} from '../lib/marketplace';
import type { Listing, ListingFilters, ListingSort } from '../types';
import { useAoMudar } from '../lib/useAoMudar';

const PAGE_SIZE = 24;

const ORDENACOES: { value: ListingSort; label: string }[] = [
  { value: 'recent', label: 'Mais recentes' },
  { value: 'price_asc', label: 'Menor preço' },
  { value: 'price_desc', label: 'Maior preço' },
];

const CORES_CONDICAO: Record<string, string> = {
  Novo: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  'Semi-novo': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  Usado: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  'Bem usado': 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  'Para reparo': 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

const INPUT_SHEET =
  'w-full p-3 rounded-xl bg-[#0F172A] border border-slate-700 text-white text-base focus:outline-hidden focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400';

export const MarketplaceView: React.FC = () => {
  const { setIsNewListingOpen, listingsVersion, refreshListings, beachMode } = useKiteData();

  const [listings, setListings] = useState<Listing[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [carregandoMais, setCarregandoMais] = useState(false);

  const [filters, setFilters] = useState<ListingFilters>(DEFAULT_LISTING_FILTERS);
  const [sheetAberto, setSheetAberto] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);

  // O que está digitado na busca, separado do filtro aplicado: sem isso cada
  // letra dispararia uma requisição na rede instável da praia.
  const [buscaTexto, setBuscaTexto] = useState('');

  const chips = useMemo(() => activeFilterChips(filters), [filters]);
  const totalFiltros = countActiveFilters(filters);

  /** Assinatura estável dos filtros, para o efeito não rodar a cada render. */
  const queryFiltros = useMemo(() => listingFiltersToQuery(filters), [filters]);

  const carregar = useCallback(
    async (offset: number) => {
      const qs = new URLSearchParams(queryFiltros);
      qs.set('limit', String(PAGE_SIZE));
      if (offset > 0) qs.set('offset', String(offset));

      const res = await fetch(`/api/listings?${qs.toString()}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : null) || 'Não foi possível carregar os anúncios.'
        );
      }
      return body as { listings: Listing[]; hasMore: boolean };
    },
    [queryFiltros]
  );

  /*
   * "Começou a carregar" é ajuste síncrono e vai no render; a busca fica no
   * efeito — ver lib/useAoMudar.ts. Roda na montagem também, porque a
   * primeira carga é aqui.
   */
  useAoMudar(
    `${JSON.stringify(filters)}|${listingsVersion}`,
    () => {
      setCarregando(true);
      setErro(null);
    },
    { naMontagem: true }
  );

  useEffect(() => {
    let ativo = true;

    (async () => {
      try {
        const data = await carregar(0);
        if (!ativo) return;
        setListings(data.listings);
        setHasMore(data.hasMore);
      } catch (err) {
        if (!ativo) return;
        setErro(err instanceof Error ? err.message : 'Falha ao carregar os anúncios.');
        setListings([]);
        setHasMore(false);
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => {
      // Filtro trocado no meio da requisição: a resposta antiga é descartada em
      // vez de sobrescrever a lista do filtro novo.
      ativo = false;
    };
  }, [carregar, listingsVersion]);

  const carregarMais = async () => {
    setCarregandoMais(true);
    try {
      const data = await carregar(listings.length);
      setListings((prev) => [...prev, ...data.listings]);
      setHasMore(data.hasMore);
    } catch {
      setErro('Não foi possível carregar mais anúncios.');
    } finally {
      setCarregandoMais(false);
    }
  };

  /** Favorita direto do card, com atualização otimista. */
  const favoritar = async (listing: Listing) => {
    const antes = { isFavorite: listing.isFavorite, favoritesCount: listing.favoritesCount };
    setListings((prev) =>
      prev.map((l) =>
        l.id === listing.id
          ? {
              ...l,
              isFavorite: !l.isFavorite,
              favoritesCount: l.isFavorite
                ? Math.max(0, l.favoritesCount - 1)
                : l.favoritesCount + 1,
            }
          : l
      )
    );

    try {
      const res = await fetch(`/api/listings/${listing.id}/favorite`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error('falha');
      const { isFavorite, favoritesCount } = body as {
        isFavorite: boolean;
        favoritesCount: number;
      };
      setListings((prev) =>
        prev.map((l) => (l.id === listing.id ? { ...l, isFavorite, favoritesCount } : l))
      );
    } catch {
      // Servidor recusou: desfaz para a tela não mentir sobre o estado salvo.
      setListings((prev) => prev.map((l) => (l.id === listing.id ? { ...l, ...antes } : l)));
    }
  };

  const aplicarBusca = () => {
    setFilters((f) => ({ ...f, q: buscaTexto.trim() }));
  };

  return (
    <div className="flex flex-col min-h-full pb-24 relative">
      {/*
        Busca + filtros. `top-0` porque o elemento rolável é o <main> logo abaixo
        do header (ver .app-scroll em globals.css): a barra cola no topo da área
        de rolagem, sem descontar altura de header nenhuma.
      */}
      <div
        className={`sticky top-0 z-10 px-3 py-2.5 border-b shadow-md transition-colors ${
          beachMode
            ? 'bg-[#020617] border-slate-800 text-white'
            : 'bg-[#0F172A]/95 backdrop-blur border-slate-800/80 text-slate-200'
        }`}
      >
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-cyan-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={buscaTexto}
              onChange={(e) => setBuscaTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') aplicarBusca();
              }}
              onBlur={aplicarBusca}
              placeholder="Buscar kite, prancha, marca..."
              aria-label="Buscar anúncios"
              className="w-full pl-9 pr-9 py-3 rounded-xl text-base font-semibold focus:outline-hidden transition-all bg-[#1E293B] border border-slate-700 text-white placeholder-slate-400 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
            />
            {buscaTexto && (
              <button
                type="button"
                onClick={() => {
                  setBuscaTexto('');
                  setFilters((f) => ({ ...f, q: '' }));
                }}
                aria-label="Limpar busca"
                className="absolute right-1 top-1/2 -translate-y-1/2 min-w-11 min-h-11 flex items-center justify-center text-slate-400 hover:text-white"
              >
                <X size={16} aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setSheetAberto(true)}
            aria-label={`Abrir filtros${totalFiltros > 0 ? ` (${totalFiltros} ativos)` : ''}`}
            className={`relative min-w-11 min-h-11 px-3.5 flex items-center gap-1.5 rounded-xl font-black text-xs border transition-all shrink-0 ${
              totalFiltros > 0
                ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/25'
                : 'bg-[#1E293B] text-slate-300 border-slate-700 hover:border-slate-500'
            }`}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span className="hidden sm:inline">Filtros</span>
            {totalFiltros > 0 && (
              <span className="w-5 h-5 rounded-full bg-slate-950 text-cyan-400 text-[10px] font-black flex items-center justify-center">
                {totalFiltros}
              </span>
            )}
          </button>
        </div>

        {/* Chips dos filtros ativos */}
        {chips.length > 0 && (
          <ul className="flex items-center gap-1.5 overflow-x-auto mt-2.5 pb-0.5">
            {chips.map((chip) => (
              <li key={chip.key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setFilters((f) => clearFilter(f, chip.key))}
                  aria-label={`Remover filtro ${chip.label}`}
                  className="flex items-center gap-1.5 pl-3 pr-2 py-2 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[11px] font-black hover:bg-cyan-500/25 transition-colors"
                >
                  <span>{chip.label}</span>
                  <X size={12} aria-hidden="true" />
                </button>
              </li>
            ))}
            <li className="shrink-0">
              <button
                type="button"
                onClick={() => setFilters(DEFAULT_LISTING_FILTERS)}
                className="px-3 py-2 rounded-full text-[11px] font-black text-slate-400 hover:text-white underline"
              >
                Limpar tudo
              </button>
            </li>
          </ul>
        )}
      </div>

      {/* Estados de carregando / erro / vazio */}
      {carregando && (
        <div className="py-20 flex flex-col items-center gap-3 text-slate-400">
          <Loader2 size={30} className="animate-spin text-cyan-400" aria-hidden="true" />
          <p className="text-xs font-bold">Buscando anúncios da comunidade...</p>
        </div>
      )}

      {!carregando && erro && (
        <div className="mx-3 mt-6 p-7 rounded-2xl border border-rose-500/40 bg-rose-500/10 text-center">
          <AlertTriangle size={28} className="mx-auto text-rose-400" aria-hidden="true" />
          <p role="alert" className="mt-3 font-black text-slate-100 text-sm">
            {erro}
          </p>
          <button
            type="button"
            onClick={refreshListings}
            className="mt-4 px-5 py-3 min-h-11 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 font-black text-xs inline-flex items-center gap-2 active:scale-95 transition-transform"
          >
            <RefreshCw size={14} aria-hidden="true" />
            <span>Tentar de novo</span>
          </button>
        </div>
      )}

      {!carregando && !erro && listings.length === 0 && (
        <div className="mx-3 mt-6 p-7 rounded-2xl border border-slate-800 bg-[#1E293B]/50 text-center">
          <Package size={30} className="mx-auto text-cyan-400" aria-hidden="true" />
          <p className="mt-3 font-black text-slate-100">
            {totalFiltros > 0 || filters.q
              ? 'Nenhum anúncio com esses filtros'
              : 'Nenhum anúncio ainda'}
          </p>
          <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
            {totalFiltros > 0 || filters.q
              ? 'Tente ampliar a faixa de preço ou tirar algum filtro.'
              : 'Tem kite parado no armário? Anuncie e passe adiante para quem vai usar.'}
          </p>
          {totalFiltros > 0 || filters.q ? (
            <button
              type="button"
              onClick={() => {
                setFilters(DEFAULT_LISTING_FILTERS);
                setBuscaTexto('');
              }}
              className="mt-4 px-5 py-3 min-h-11 rounded-xl bg-slate-800 border border-slate-700 text-slate-100 font-black text-xs active:scale-95 transition-transform"
            >
              Limpar filtros
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsNewListingOpen(true)}
              className="mt-4 px-5 py-3 min-h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-slate-950 font-black text-sm active:scale-95 transition-transform"
            >
              Criar o primeiro anúncio
            </button>
          )}
        </div>
      )}

      {/* Grade de anúncios: 2 colunas no mobile */}
      {!carregando && listings.length > 0 && (
        <>
          <ul className="grid grid-cols-2 gap-2.5 p-3">
            {listings.map((listing) => {
              const tamanho = formatListingSize({
                category: listing.category,
                sizeM2: listing.sizeM2 ?? null,
                sizeCm: listing.sizeCm ?? null,
              });

              return (
                <li key={listing.id}>
                  <article
                    className={`relative h-full flex flex-col rounded-2xl border overflow-hidden shadow-lg transition-colors focus-within:ring-2 focus-within:ring-cyan-400 ${
                      beachMode
                        ? 'bg-[#020617] border-slate-800'
                        : 'bg-[#1E293B] border-slate-700/80'
                    }`}
                  >
                    <div className="relative aspect-square bg-black">
                      {listing.coverPhoto ? (
                        /* eslint-disable-next-line @next/next/no-img-element -- data URL do banco, sem host para o next/image otimizar */
                        <img
                          src={listing.coverPhoto}
                          alt={listing.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="w-full h-full flex items-center justify-center text-slate-600">
                          <Package size={30} aria-hidden="true" />
                        </span>
                      )}

                      {listing.status !== 'Ativo' && (
                        <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full bg-black/75 text-white text-[10px] font-black border border-white/15 backdrop-blur-md">
                          {listing.status}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col p-2.5 gap-1.5">
                      <p className="font-black text-sm text-emerald-400 leading-none">
                        {formatBRL(listing.priceCents)}
                      </p>

                      <h3 className="font-bold text-xs text-slate-100 leading-snug line-clamp-2">
                        {listing.title}
                      </h3>

                      <div className="flex flex-wrap gap-1 mt-auto pt-1">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                            CORES_CONDICAO[listing.condition] ?? 'bg-slate-700 text-slate-200 border-slate-600'
                          }`}
                        >
                          {listing.condition}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-slate-700/80 text-slate-200 text-[10px] font-black">
                          {listing.category}
                        </span>
                        {tamanho && (
                          <span className="px-2 py-0.5 rounded-full bg-slate-700/80 text-slate-200 text-[10px] font-black">
                            {tamanho}
                          </span>
                        )}
                      </div>

                      <p className="flex items-center gap-1 text-[10px] font-bold text-slate-400 truncate">
                        <MapPin size={10} className="text-rose-400 shrink-0" aria-hidden="true" />
                        <span className="truncate">
                          {listing.city} &bull; {listing.state}
                        </span>
                      </p>

                      {listing.negotiable && (
                        <p className="flex items-center gap-1 text-[10px] font-black text-emerald-300">
                          <Handshake size={10} aria-hidden="true" />
                          Negociável
                        </p>
                      )}
                    </div>

                    {/*
                      O card inteiro abre o detalhe. Botão em cima de tudo em vez
                      de envolver o conteúdo: <button> só aceita conteúdo de
                      frase, e h3/p dentro dele é HTML inválido. Vindo ANTES do
                      coração no DOM, o coração pinta por cima e segue clicável
                      sem precisar de z-index.
                    */}
                    <button
                      type="button"
                      onClick={() => setDetalheId(listing.id)}
                      aria-label={`Ver anúncio: ${listing.title} por ${formatBRL(listing.priceCents)}`}
                      className="absolute inset-0 rounded-2xl focus:outline-hidden"
                    />

                    <button
                      type="button"
                      onClick={() => favoritar(listing)}
                      aria-pressed={listing.isFavorite}
                      aria-label={
                        listing.isFavorite
                          ? `Remover ${listing.title} dos favoritos`
                          : `Salvar ${listing.title} nos favoritos`
                      }
                      className={`absolute top-1.5 right-1.5 min-w-11 min-h-11 flex items-center justify-center rounded-full backdrop-blur-md border transition-all active:scale-90 ${
                        listing.isFavorite
                          ? 'bg-rose-500/30 text-rose-300 border-rose-400/50'
                          : 'bg-black/50 text-white border-white/15 hover:bg-black/70'
                      }`}
                    >
                      <Heart
                        size={16}
                        className={listing.isFavorite ? 'fill-current' : ''}
                        aria-hidden="true"
                      />
                    </button>
                  </article>
                </li>
              );
            })}
          </ul>

          {hasMore && (
            <div className="px-3 pb-4">
              <button
                type="button"
                onClick={carregarMais}
                disabled={carregandoMais}
                className="w-full py-3.5 min-h-11 rounded-2xl bg-[#1E293B] border border-slate-700 text-slate-200 font-black text-xs flex items-center justify-center gap-2 active:scale-98 transition-all disabled:opacity-60"
              >
                {carregandoMais && (
                  <Loader2 size={15} className="animate-spin text-cyan-400" aria-hidden="true" />
                )}
                <span>{carregandoMais ? 'Carregando...' : 'Ver mais anúncios'}</span>
              </button>
            </div>
          )}
        </>
      )}

      {/*
        Botão flutuante Anunciar. `bottom-20` não incluía a safe-area e ficava
        por cima da pílula de navegação no iPhone instalado. Usa o mesmo
        contrato dos outros FABs: --nav-h já soma altura, gap e safe-area uma
        única vez (app/globals.css).
      */}
      <div className="fixed publish-fab-bottom left-0 right-0 z-20 flex justify-center pointer-events-none">
        <button
          type="button"
          onClick={() => setIsNewListingOpen(true)}
          className="pointer-events-auto flex items-center gap-2 px-6 py-3.5 min-h-11 rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-black text-sm tracking-wide shadow-2xl shadow-emerald-500/30 active:scale-95 transition-all border border-emerald-300/40"
        >
          <Plus size={18} className="stroke-[3]" aria-hidden="true" />
          <span>Anunciar</span>
        </button>
      </div>

      <FiltrosSheet
        aberto={sheetAberto}
        onFechar={() => setSheetAberto(false)}
        filters={filters}
        onAplicar={(novos) => {
          setFilters(novos);
          setSheetAberto(false);
        }}
      />

      <ListingDetailModal
        listingId={detalheId}
        onClose={() => setDetalheId(null)}
        onChanged={refreshListings}
      />
    </div>
  );
};

// --------------------------------------------------------------- bottom sheet

interface FiltrosSheetProps {
  aberto: boolean;
  onFechar: () => void;
  filters: ListingFilters;
  onAplicar: (filters: ListingFilters) => void;
}

/**
 * Painel de filtros em bottom sheet.
 *
 * O estado é local e só sobe no "Aplicar": mexer num seletor e ver a lista
 * recarregar embaixo do painel dispara uma requisição por toque e faz a tela
 * pular quando o painel fecha.
 */
const FiltrosSheet: React.FC<FiltrosSheetProps> = ({ aberto, onFechar, filters, onAplicar }) => {
  const [rascunho, setRascunho] = useState<ListingFilters>(filters);
  const [precoMin, setPrecoMin] = useState('');
  const [precoMax, setPrecoMax] = useState('');

  // Reabrir o painel precisa mostrar o que está aplicado hoje, não o rascunho
  // abandonado da vez anterior.
  // Rascunho no render, não em efeito: com useEffect o painel pintava um
  // quadro com o rascunho abandonado da vez anterior antes de corrigir.
  useAoMudar(aberto ? JSON.stringify(filters) : null, () => {
    if (!aberto) return;
    setRascunho(filters);
    setPrecoMin(filters.minPriceCents !== null ? maskBRLInput(String(filters.minPriceCents)) : '');
    setPrecoMax(filters.maxPriceCents !== null ? maskBRLInput(String(filters.maxPriceCents)) : '');
  });

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aberto, onFechar]);

  if (!aberto) return null;

  const aplicar = () => {
    const min = precoMin ? parseBRLToCents(precoMin) : null;
    const max = precoMax ? parseBRLToCents(precoMax) : null;
    // Faixa invertida é trocada em vez de devolver lista vazia sem explicação.
    const [minOk, maxOk] = min !== null && max !== null && min > max ? [max, min] : [min, max];
    onAplicar({ ...rascunho, minPriceCents: minOk, maxPriceCents: maxOk });
  };

  const limpar = () => {
    setRascunho({ ...DEFAULT_LISTING_FILTERS, q: rascunho.q, sort: rascunho.sort });
    setPrecoMin('');
    setPrecoMax('');
  };

  const usaCm = rascunho.category === 'Prancha';

  return (
    <div className="fixed inset-0 z-modal flex items-end justify-center">
      <button
        type="button"
        onClick={onFechar}
        aria-label="Fechar filtros"
        className="absolute inset-0 bg-black/70 backdrop-blur-xs"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filtros de anúncios"
        className="relative w-full max-w-md bg-[#0F172A] border-t border-slate-800 rounded-t-3xl shadow-2xl max-h-[88vh] flex flex-col"
      >
        <div className="px-4 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <h2 className="font-black text-base text-white">Filtrar anúncios</h2>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar filtros"
            className="min-w-11 min-h-11 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <fieldset>
            <legend className="font-bold text-xs text-slate-300 mb-2">Categoria</legend>
            <div className="flex flex-wrap gap-1.5">
              {LISTING_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() =>
                    setRascunho((f) => ({
                      ...f,
                      category: f.category === c ? null : c,
                      // Unidade de tamanho muda entre m² e cm; manter o número
                      // filtraria 9m² como 9cm.
                      minSize: null,
                      maxSize: null,
                    }))
                  }
                  aria-pressed={rascunho.category === c}
                  className={`px-3 py-2.5 min-h-11 rounded-xl text-xs font-black border transition-all ${
                    rascunho.category === c
                      ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                      : 'bg-[#1E293B] text-slate-300 border-slate-700 hover:border-slate-500'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-bold text-xs text-slate-300 mb-2">Conservação</legend>
            <div className="flex flex-wrap gap-1.5">
              {LISTING_CONDITIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() =>
                    setRascunho((f) => ({ ...f, condition: f.condition === c ? null : c }))
                  }
                  aria-pressed={rascunho.condition === c}
                  className={`px-3 py-2.5 min-h-11 rounded-xl text-xs font-black border transition-all ${
                    rascunho.condition === c
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                      : 'bg-[#1E293B] text-slate-300 border-slate-700 hover:border-slate-500'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-bold text-xs text-slate-300 mb-2">Faixa de preço</legend>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1" htmlFor="f-preco-min">
                  De
                </label>
                <input
                  id="f-preco-min"
                  type="text"
                  inputMode="numeric"
                  value={precoMin}
                  onChange={(e) => setPrecoMin(maskBRLInput(e.target.value))}
                  placeholder="R$ 0,00"
                  className={INPUT_SHEET}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1" htmlFor="f-preco-max">
                  Até
                </label>
                <input
                  id="f-preco-max"
                  type="text"
                  inputMode="numeric"
                  value={precoMax}
                  onChange={(e) => setPrecoMax(maskBRLInput(e.target.value))}
                  placeholder="R$ 0,00"
                  className={INPUT_SHEET}
                />
              </div>
            </div>
          </fieldset>

          <fieldset>
            <legend className="font-bold text-xs text-slate-300 mb-2">
              Tamanho {rascunho.category ? `(${usaCm ? 'cm' : 'm²'})` : '(m² ou cm)'}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1" htmlFor="f-size-min">
                  Mínimo
                </label>
                <input
                  id="f-size-min"
                  type="text"
                  inputMode="decimal"
                  value={rascunho.minSize ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(',', '.'));
                    setRascunho((f) => ({
                      ...f,
                      minSize: e.target.value === '' || !Number.isFinite(n) ? null : n,
                    }));
                  }}
                  placeholder={usaCm ? '130' : '7'}
                  className={INPUT_SHEET}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-400 mb-1" htmlFor="f-size-max">
                  Máximo
                </label>
                <input
                  id="f-size-max"
                  type="text"
                  inputMode="decimal"
                  value={rascunho.maxSize ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(',', '.'));
                    setRascunho((f) => ({
                      ...f,
                      maxSize: e.target.value === '' || !Number.isFinite(n) ? null : n,
                    }));
                  }}
                  placeholder={usaCm ? '145' : '12'}
                  className={INPUT_SHEET}
                />
              </div>
            </div>
            {!rascunho.category && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                Escolha a categoria para o tamanho usar a unidade certa.
              </p>
            )}
          </fieldset>

          <div>
            <label className="block font-bold text-xs text-slate-300 mb-2" htmlFor="f-estado">
              Estado
            </label>
            <select
              id="f-estado"
              value={rascunho.state ?? ''}
              onChange={(e) =>
                setRascunho((f) => ({ ...f, state: e.target.value === '' ? null : e.target.value }))
              }
              className={INPUT_SHEET}
            >
              <option value="">Todos os estados</option>
              {LISTING_STATES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="font-bold text-xs text-slate-300 mb-2">Ordenar por</legend>
            <div className="flex flex-wrap gap-1.5">
              {ORDENACOES.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setRascunho((f) => ({ ...f, sort: o.value }))}
                  aria-pressed={rascunho.sort === o.value}
                  className={`px-3 py-2.5 min-h-11 rounded-xl text-xs font-black border transition-all ${
                    rascunho.sort === o.value
                      ? 'bg-amber-400 text-slate-950 border-amber-300'
                      : 'bg-[#1E293B] text-slate-300 border-slate-700 hover:border-slate-500'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRascunho((f) => ({ ...f, favorites: !f.favorites, mine: false }))}
              aria-pressed={rascunho.favorites}
              className={`px-3 py-3 min-h-11 rounded-xl text-xs font-black border transition-all flex items-center justify-center gap-1.5 ${
                rascunho.favorites
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  : 'bg-[#1E293B] text-slate-300 border-slate-700'
              }`}
            >
              <Heart
                size={14}
                className={rascunho.favorites ? 'fill-current' : ''}
                aria-hidden="true"
              />
              <span>Só favoritos</span>
            </button>

            <button
              type="button"
              onClick={() => setRascunho((f) => ({ ...f, mine: !f.mine, favorites: false }))}
              aria-pressed={rascunho.mine}
              className={`px-3 py-3 min-h-11 rounded-xl text-xs font-black border transition-all ${
                rascunho.mine
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                  : 'bg-[#1E293B] text-slate-300 border-slate-700'
              }`}
            >
              Meus anúncios
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 flex items-center gap-2 safe-area-pb">
          <button
            type="button"
            onClick={limpar}
            className="px-4 py-3.5 min-h-11 rounded-2xl bg-[#1E293B] border border-slate-700 text-slate-200 font-black text-sm active:scale-98 transition-all"
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={aplicar}
            className="flex-1 py-3.5 min-h-11 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-xl shadow-cyan-500/25 active:scale-98 transition-all"
          >
            Aplicar filtros
          </button>
        </div>
      </div>
    </div>
  );
};
