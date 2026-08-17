'use client';

import React, { useMemo, useState } from 'react';
import {
  X,
  Camera,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Check,
  Tag,
  MapPin,
  DollarSign,
  Package,
  ArrowUp,
  ArrowDown,
  Trash2,
  Megaphone,
} from 'lucide-react';
import { compressImage } from '../lib/imageCompress';
import { useKiteData } from '../context/KiteDataContext';
import {
  CATEGORIES_SIZE_CM,
  CATEGORIES_SIZE_M2,
  LISTING_CATEGORIES,
  LISTING_CONDITIONS,
  LISTING_STATES,
  MAX_LISTING_PHOTOS,
  formatBRL,
  maskBRLInput,
  parseBRLToCents,
} from '../lib/marketplace';
import type { ListingCategory, ListingCondition } from '../types';

/** Etapas na ordem em que o velejador preenche. */
const ETAPAS = ['categoria', 'detalhes', 'fotos', 'preco', 'revisao'] as const;
type Etapa = (typeof ETAPAS)[number];

const TITULO_ETAPA: Record<Etapa, string> = {
  categoria: 'O que você está vendendo?',
  detalhes: 'Detalhes do equipamento',
  fotos: 'Fotos do equipamento',
  preco: 'Preço e localização',
  revisao: 'Confira antes de publicar',
};

const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const LIMITE_BYTES = 12 * 1024 * 1024;

const INPUT = 'w-full p-3 rounded-xl bg-[#1E293B] border border-slate-700 text-white text-base focus:outline-hidden focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400';
const LABEL = 'block font-bold text-slate-300 mb-1.5 text-xs';

export const NewListingModal: React.FC = () => {
  const { isNewListingOpen, setIsNewListingOpen, refreshListings } = useKiteData();

  const [etapa, setEtapa] = useState<Etapa>('categoria');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const [category, setCategory] = useState<ListingCategory | null>(null);
  const [condition, setCondition] = useState<ListingCondition | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [size, setSize] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [fotoBusy, setFotoBusy] = useState(false);
  // Guarda o texto mascarado; os centavos saem dele só no envio.
  const [precoTexto, setPrecoTexto] = useState('');
  const [negotiable, setNegotiable] = useState(true);
  const [city, setCity] = useState('');
  const [state, setState] = useState('');

  const priceCents = useMemo(() => parseBRLToCents(precoTexto), [precoTexto]);
  const usaM2 = category != null && CATEGORIES_SIZE_M2.includes(category);
  const usaCm = category != null && CATEGORIES_SIZE_CM.includes(category);
  const indiceEtapa = ETAPAS.indexOf(etapa);

  if (!isNewListingOpen) return null;

  const fechar = () => {
    setIsNewListingOpen(false);
    // Reset ao fechar: reabrir com o formulário meio preenchido de um anúncio
    // abandonado faz o velejador publicar dado errado sem perceber.
    setEtapa('categoria');
    setErro(null);
    setCategory(null);
    setCondition(null);
    setTitle('');
    setDescription('');
    setBrand('');
    setModel('');
    setYear('');
    setSize('');
    setPhotos([]);
    setPrecoTexto('');
    setNegotiable(true);
    setCity('');
    setState('');
  };

  /** Valida a etapa atual e devolve a mensagem, ou null se estiver ok. */
  const validarEtapa = (e: Etapa): string | null => {
    if (e === 'categoria') {
      if (!category) return 'Escolha a categoria do equipamento.';
      if (!condition) return 'Escolha o estado de conservação.';
      return null;
    }
    if (e === 'detalhes') {
      if (title.trim().length < 4) return 'O título precisa ter pelo menos 4 caracteres.';
      if (description.trim().length < 10) return 'Descreva o equipamento com pelo menos 10 caracteres.';
      if (year) {
        const n = Number(year);
        const limite = new Date().getFullYear() + 1;
        if (!Number.isInteger(n) || n < 1990 || n > limite) {
          return `Ano deve estar entre 1990 e ${limite}.`;
        }
      }
      if (size) {
        const n = Number(size.replace(',', '.'));
        if (!Number.isFinite(n)) return 'Tamanho deve ser um número.';
        if (usaM2 && (n < 0.5 || n > 25)) return 'Tamanho em m² deve estar entre 0,5 e 25.';
        if (usaCm && (n < 50 || n > 300)) return 'Tamanho em cm deve estar entre 50 e 300.';
      }
      return null;
    }
    if (e === 'fotos') {
      // Foto não é obrigatória: equipamento sem foto vende menos, mas travar
      // aqui faz o velejador desistir na praia, sem sinal para subir imagem.
      if (photos.length > MAX_LISTING_PHOTOS) return `Máximo de ${MAX_LISTING_PHOTOS} fotos.`;
      return null;
    }
    if (e === 'preco') {
      if (priceCents <= 0) return 'Informe o preço do equipamento.';
      if (city.trim().length < 2) return 'Informe a cidade.';
      if (!state) return 'Escolha o estado.';
      return null;
    }
    return null;
  };

  const avancar = () => {
    const msg = validarEtapa(etapa);
    if (msg) {
      setErro(msg);
      return;
    }
    setErro(null);
    setEtapa(ETAPAS[Math.min(indiceEtapa + 1, ETAPAS.length - 1)]);
  };

  const voltar = () => {
    setErro(null);
    setEtapa(ETAPAS[Math.max(indiceEtapa - 1, 0)]);
  };

  async function selecionarFotos(ev: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(ev.target.files ?? []);
    ev.target.value = '';
    if (arquivos.length === 0) return;
    setErro(null);

    const vagas = MAX_LISTING_PHOTOS - photos.length;
    if (vagas <= 0) {
      setErro(`Você já tem ${MAX_LISTING_PHOTOS} fotos. Remova uma para trocar.`);
      return;
    }

    setFotoBusy(true);
    try {
      const novas: string[] = [];
      for (const file of arquivos.slice(0, vagas)) {
        if (!TIPOS_ACEITOS.includes(file.type)) {
          setErro('Formato não aceito. Use JPG, PNG, WEBP ou HEIC.');
          continue;
        }
        if (file.size > LIMITE_BYTES) {
          setErro('Uma das fotos passa de 12MB e foi ignorada.');
          continue;
        }
        // 1280px cobre o carrossel em tela retina sem estourar o corpo da
        // requisição com seis imagens de uma vez.
        novas.push(await compressImage(file, 1280, 0.75));
      }
      if (novas.length > 0) setPhotos((prev) => [...prev, ...novas]);
      if (arquivos.length > vagas) {
        setErro(`Só cabiam ${vagas} foto(s); o resto foi ignorado.`);
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível processar a foto.');
    } finally {
      setFotoBusy(false);
    }
  }

  const moverFoto = (de: number, para: number) => {
    if (para < 0 || para >= photos.length) return;
    setPhotos((prev) => {
      const copia = [...prev];
      const [item] = copia.splice(de, 1);
      copia.splice(para, 0, item);
      return copia;
    });
  };

  const publicar = async () => {
    // Revalida tudo: o velejador pode ter voltado e mexido numa etapa anterior.
    for (const e of ETAPAS) {
      const msg = validarEtapa(e);
      if (msg) {
        setErro(msg);
        setEtapa(e);
        return;
      }
    }

    setEnviando(true);
    setErro(null);
    try {
      const tamanho = size ? Number(size.replace(',', '.')) : null;
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
          condition,
          priceCents,
          negotiable,
          brand: brand.trim() || undefined,
          model: model.trim() || undefined,
          yearManufactured: year ? Number(year) : undefined,
          sizeM2: usaM2 && tamanho != null ? tamanho : undefined,
          sizeCm: usaCm && tamanho != null ? tamanho : undefined,
          city: city.trim(),
          state,
          photos,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (body && typeof body === 'object' && 'error' in body
            ? String((body as { error: unknown }).error)
            : null) || 'Não foi possível publicar o anúncio.'
        );
      }
      // Avisa o feed que há anúncio novo antes de fechar, senão o velejador
      // publica e não vê o próprio anúncio na lista.
      refreshListings();
      fechar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao publicar o anúncio.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center p-3 bg-black/75 backdrop-blur-xs overflow-y-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Anunciar equipamento"
        className="bg-[#0F172A] text-slate-100 rounded-3xl w-full max-w-md overflow-hidden border border-slate-800 shadow-2xl my-6"
      >
        <div className="bg-gradient-to-r from-emerald-600 to-cyan-500 px-5 py-4 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <Megaphone size={20} className="text-white shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="font-black text-base text-white truncate">Anunciar Equipamento</h2>
              <p className="text-[11px] font-bold text-white/85">
                Etapa {indiceEtapa + 1} de {ETAPAS.length} &bull; {TITULO_ETAPA[etapa]}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={fechar}
            className="p-2 rounded-full bg-black/20 hover:bg-black/40 text-white transition-colors min-w-11 min-h-11 flex items-center justify-center shrink-0"
            aria-label="Fechar formulário de anúncio"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Trilha de progresso */}
        <div className="flex gap-1 px-5 pt-4" aria-hidden="true">
          {ETAPAS.map((e, i) => (
            <span
              key={e}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i <= indiceEtapa ? 'bg-cyan-400' : 'bg-slate-700'
              }`}
            />
          ))}
        </div>

        <div className="p-4 sm:p-5 space-y-4">
          {erro && (
            <p
              role="alert"
              className="text-xs font-bold text-rose-200 bg-rose-500/15 border border-rose-500/40 rounded-xl px-3 py-2.5"
            >
              {erro}
            </p>
          )}

          {etapa === 'categoria' && (
            <>
              <fieldset>
                <legend className={LABEL}>
                  <span className="flex items-center gap-1.5">
                    <Package size={13} className="text-cyan-400" aria-hidden="true" />
                    Categoria
                  </span>
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {LISTING_CATEGORIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setCategory(c);
                        // Unidade de tamanho muda com a categoria; manter o
                        // número antigo colocaria 138 num campo de m².
                        setSize('');
                      }}
                      aria-pressed={category === c}
                      className={`px-2 py-3 min-h-11 rounded-xl text-xs font-black border transition-all ${
                        category === c
                          ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/25'
                          : 'bg-[#1E293B] text-slate-300 border-slate-700 hover:border-slate-500'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className={LABEL}>Estado de conservação</legend>
                <div className="grid grid-cols-2 gap-2">
                  {LISTING_CONDITIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCondition(c)}
                      aria-pressed={condition === c}
                      className={`px-3 py-3 min-h-11 rounded-xl text-xs font-black border transition-all ${
                        condition === c
                          ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-md shadow-emerald-500/25'
                          : 'bg-[#1E293B] text-slate-300 border-slate-700 hover:border-slate-500'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </fieldset>
            </>
          )}

          {etapa === 'detalhes' && (
            <>
              <div>
                <label className={LABEL} htmlFor="listing-title">
                  Título do anúncio
                </label>
                <input
                  id="listing-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="Ex: Kite Duotone Rebel 9m² 2023"
                  className={INPUT}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={LABEL} htmlFor="listing-brand">
                    Marca (opcional)
                  </label>
                  <input
                    id="listing-brand"
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    maxLength={80}
                    placeholder="Duotone"
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="listing-model">
                    Modelo (opcional)
                  </label>
                  <input
                    id="listing-model"
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    maxLength={80}
                    placeholder="Rebel"
                    className={INPUT}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={LABEL} htmlFor="listing-year">
                    Ano (opcional)
                  </label>
                  <input
                    id="listing-year"
                    type="number"
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    placeholder="2023"
                    className={INPUT}
                  />
                </div>
                {(usaM2 || usaCm) && (
                  <div>
                    <label className={LABEL} htmlFor="listing-size">
                      Tamanho ({usaM2 ? 'm²' : 'cm'})
                    </label>
                    <input
                      id="listing-size"
                      type="text"
                      inputMode="decimal"
                      value={size}
                      onChange={(e) => setSize(e.target.value)}
                      placeholder={usaM2 ? '9' : '138'}
                      className={INPUT}
                    />
                  </div>
                )}
              </div>

              <div>
                <label className={LABEL} htmlFor="listing-description">
                  Descrição
                </label>
                <textarea
                  id="listing-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={4000}
                  placeholder="Conte o histórico de uso, reparos, o que vai junto (bag, bomba, barra)..."
                  className={`${INPUT} h-28 resize-none`}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Quem descreve reparos e horas de uso vende mais rápido.
                </p>
              </div>
            </>
          )}

          {etapa === 'fotos' && (
            <>
              <p className="text-xs text-slate-400">
                Até {MAX_LISTING_PHOTOS} fotos. A primeira aparece no feed — use a
                melhor do equipamento montado.
              </p>

              {photos.length > 0 && (
                <ul className="space-y-2">
                  {photos.map((foto, i) => (
                    <li
                      key={`${i}-${foto.slice(-16)}`}
                      className="flex items-center gap-2.5 p-2 rounded-xl bg-[#1E293B] border border-slate-700"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- data URL local, sem host para o next/image otimizar */}
                      <img
                        src={foto}
                        alt={`Foto ${i + 1} do equipamento`}
                        className="w-16 h-16 rounded-lg object-cover shrink-0 bg-black"
                      />
                      <span className="flex-1 text-xs font-bold text-slate-300">
                        {i === 0 ? 'Capa do anúncio' : `Foto ${i + 1}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => moverFoto(i, i - 1)}
                        disabled={i === 0}
                        aria-label={`Mover foto ${i + 1} para cima`}
                        className="min-w-11 min-h-11 flex items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30"
                      >
                        <ArrowUp size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moverFoto(i, i + 1)}
                        disabled={i === photos.length - 1}
                        aria-label={`Mover foto ${i + 1} para baixo`}
                        className="min-w-11 min-h-11 flex items-center justify-center rounded-lg bg-slate-800 text-slate-300 hover:text-white disabled:opacity-30"
                      >
                        <ArrowDown size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Remover foto ${i + 1}`}
                        className="min-w-11 min-h-11 flex items-center justify-center rounded-lg bg-rose-500/15 text-rose-300 hover:bg-rose-500/30"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {photos.length < MAX_LISTING_PHOTOS && (
                <label
                  htmlFor="listing-fotos"
                  className="flex flex-col items-center justify-center gap-1.5 py-7 rounded-xl border-2 border-dashed border-slate-700 bg-[#1E293B] cursor-pointer hover:border-cyan-500/60 transition-colors"
                >
                  {fotoBusy ? (
                    <>
                      <Loader2 size={22} className="text-cyan-400 animate-spin" aria-hidden="true" />
                      <span className="text-slate-300 font-bold text-xs">Preparando fotos...</span>
                    </>
                  ) : (
                    <>
                      <Camera size={22} className="text-cyan-400" aria-hidden="true" />
                      <span className="text-slate-300 font-bold text-xs">
                        Adicionar fotos ({photos.length}/{MAX_LISTING_PHOTOS})
                      </span>
                      <span className="text-[11px] text-slate-400">JPG, PNG, WEBP ou HEIC até 12MB</span>
                    </>
                  )}
                </label>
              )}

              <input
                id="listing-fotos"
                type="file"
                accept="image/*"
                multiple
                onChange={selecionarFotos}
                disabled={fotoBusy}
                className="sr-only"
              />
            </>
          )}

          {etapa === 'preco' && (
            <>
              <div>
                <label className={LABEL} htmlFor="listing-price">
                  <span className="flex items-center gap-1.5">
                    <DollarSign size={13} className="text-emerald-400" aria-hidden="true" />
                    Preço
                  </span>
                </label>
                <input
                  id="listing-price"
                  type="text"
                  inputMode="numeric"
                  value={precoTexto}
                  onChange={(e) => setPrecoTexto(maskBRLInput(e.target.value))}
                  placeholder="R$ 0,00"
                  className={`${INPUT} font-black text-emerald-400`}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Digite só os números: os centavos entram da direita para a esquerda.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setNegotiable((v) => !v)}
                aria-pressed={negotiable}
                className={`w-full px-3 py-3 min-h-11 rounded-xl text-xs font-black border transition-all flex items-center justify-between ${
                  negotiable
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                    : 'bg-[#1E293B] text-slate-400 border-slate-700'
                }`}
              >
                <span>Aceito negociar o preço</span>
                <span
                  className={`px-2.5 py-1 rounded-lg ${
                    negotiable ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {negotiable ? 'Sim' : 'Não'}
                </span>
              </button>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={LABEL} htmlFor="listing-city">
                    <span className="flex items-center gap-1.5">
                      <MapPin size={13} className="text-rose-400" aria-hidden="true" />
                      Cidade
                    </span>
                  </label>
                  <input
                    id="listing-city"
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    maxLength={80}
                    placeholder="Natal"
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="listing-state">
                    Estado
                  </label>
                  <select
                    id="listing-state"
                    value={state}
                    onChange={(e) => setState(e.target.value)}
                    className={INPUT}
                  >
                    <option value="">Escolha...</option>
                    {LISTING_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {etapa === 'revisao' && (
            <div className="space-y-3">
              <div className="rounded-2xl overflow-hidden border border-slate-700 bg-[#1E293B]">
                {photos[0] ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- data URL local */
                  <img src={photos[0]} alt="Capa do anúncio" className="w-full aspect-4/3 object-cover bg-black" />
                ) : (
                  <div className="w-full aspect-4/3 flex items-center justify-center text-slate-500">
                    <Camera size={28} aria-hidden="true" />
                  </div>
                )}
                <div className="p-3.5 space-y-2">
                  <h3 className="font-black text-sm text-white">{title}</h3>
                  <p className="font-black text-lg text-emerald-400">{formatBRL(priceCents)}</p>
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-black">
                    <span className="px-2.5 py-1 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      {category}
                    </span>
                    <span className="px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {condition}
                    </span>
                    {size && (
                      <span className="px-2.5 py-1 rounded-full bg-slate-700 text-slate-200">
                        {size}
                        {usaM2 ? 'm²' : 'cm'}
                      </span>
                    )}
                    {negotiable && (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Negociável
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-300 whitespace-pre-line leading-relaxed">{description}</p>
                  <p className="text-[11px] text-slate-400 font-bold flex items-center gap-1">
                    <MapPin size={11} aria-hidden="true" />
                    {city} &bull; {state}
                    {(brand || model || year) && (
                      <span className="ml-1 text-slate-500">
                        | {[brand, model, year].filter(Boolean).join(' ')}
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {photos.length} foto(s) no anúncio
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Navegação entre etapas */}
        <div className="p-4 sm:p-5 pt-0 flex items-center gap-2">
          {indiceEtapa > 0 && (
            <button
              type="button"
              onClick={voltar}
              disabled={enviando}
              className="px-4 py-3.5 min-h-11 rounded-2xl bg-[#1E293B] border border-slate-700 text-slate-200 font-black text-sm flex items-center gap-1.5 active:scale-98 transition-all disabled:opacity-50"
            >
              <ChevronLeft size={16} aria-hidden="true" />
              <span>Voltar</span>
            </button>
          )}

          {etapa === 'revisao' ? (
            <button
              type="button"
              onClick={publicar}
              disabled={enviando}
              className="flex-1 py-3.5 min-h-11 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-black text-sm shadow-xl shadow-emerald-500/25 active:scale-98 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {enviando ? (
                <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              ) : (
                <Check size={16} aria-hidden="true" />
              )}
              <span>{enviando ? 'Publicando...' : 'Publicar anúncio'}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={avancar}
              className="flex-1 py-3.5 min-h-11 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-black text-sm shadow-xl shadow-cyan-500/25 active:scale-98 transition-all flex items-center justify-center gap-2"
            >
              <span>Continuar</span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
