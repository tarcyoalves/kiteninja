/**
 * Regras compartilhadas do marketplace.
 *
 * Vive fora das rotas e das telas de propósito: preço em centavos, validação de
 * foto e montagem de filtros são as três coisas que, erradas, causam prejuízo
 * real (valor errado no anúncio, requisição a terceiro, filtro que ignora o que
 * o velejador pediu). Ficando aqui, dá para testar sem banco e sem navegador.
 */
import type {
  ListingCategory,
  ListingCondition,
  ListingFilters,
  ListingSort,
} from '../types';

export const LISTING_CATEGORIES: readonly ListingCategory[] = [
  'Kite',
  'Prancha',
  'Barra',
  'Trapézio',
  'Foil',
  'Wing',
  'Neoprene',
  'Acessório',
  'Outro',
] as const;

export const LISTING_CONDITIONS: readonly ListingCondition[] = [
  'Novo',
  'Semi-novo',
  'Usado',
  'Bem usado',
  'Para reparo',
] as const;

export const LISTING_SORTS: readonly ListingSort[] = ['recent', 'price_asc', 'price_desc'] as const;

/** Estados com spot cadastrado hoje; 'Outro' cobre o resto do país. */
export const LISTING_STATES: readonly string[] = [
  'RN',
  'CE',
  'PI',
  'RJ',
  'SP',
  'SC',
  'BA',
  'PE',
  'PB',
  'MA',
  'PR',
  'RS',
  'ES',
  'AL',
  'SE',
  'Outro',
] as const;

/** Categorias medidas em m² (kite, wing, foil); as demais usam cm ou nada. */
export const CATEGORIES_SIZE_M2: readonly ListingCategory[] = ['Kite', 'Wing', 'Foil'] as const;
export const CATEGORIES_SIZE_CM: readonly ListingCategory[] = ['Prancha'] as const;

export const MAX_LISTING_PHOTOS = 6;

/** Teto por foto acompanhando lib/imageCompress (data URL já comprimida). */
export const MAX_PHOTO_CHARS = 1_500_000;

/**
 * Só data URL de imagem é aceita. URL externa (http/https) transformaria o
 * anúncio em vetor de requisição a terceiros: quem abrisse o feed dispararia um
 * GET no host do anunciante, entregando IP e User-Agent de toda a comunidade.
 */
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,/;

export function isSafeImageDataUrl(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.length > MAX_PHOTO_CHARS) return false;
  return IMAGE_DATA_URL.test(value);
}

// ------------------------------------------------------------------ dinheiro

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Formata centavos como moeda brasileira: 189990 -> "R$ 1.899,90". */
export function formatBRL(priceCents: number): string {
  if (!Number.isFinite(priceCents)) return BRL.format(0);
  return BRL.format(priceCents / 100);
}

/**
 * Reais -> centavos.
 *
 * `Math.round` é obrigatório aqui: 19.99 * 100 dá 1998.9999999999998 em ponto
 * flutuante binário, e truncar geraria um centavo a menos no anúncio.
 */
export function reaisToCents(reais: number): number {
  if (!Number.isFinite(reais) || reais < 0) return 0;
  return Math.round(reais * 100);
}

/** Centavos -> reais, para preencher campo numérico de edição. */
export function centsToReais(priceCents: number): number {
  if (!Number.isFinite(priceCents)) return 0;
  return priceCents / 100;
}

/**
 * Lê o que o velejador digitou no campo de preço e devolve centavos.
 *
 * Aceita "1.899,90", "1899,90", "R$ 1.899,90" e "1899.90": no celular o teclado
 * numérico varia e ninguém vai formatar direito com a mão molhada de água
 * salgada. A regra é: o último separador antes de 1-2 dígitos finais é o
 * decimal; qualquer outro ponto/vírgula é milhar e some.
 */
export function parseBRLToCents(input: string): number {
  const limpo = String(input).replace(/[^\d.,]/g, '');
  if (!limpo) return 0;

  const ultimaVirgula = limpo.lastIndexOf(',');
  const ultimoPonto = limpo.lastIndexOf('.');
  const posDecimal = Math.max(ultimaVirgula, ultimoPonto);

  // Sem separador, ou separador longe do fim (ex: "1.899" = milhar): inteiro.
  const casas = posDecimal === -1 ? 0 : limpo.length - posDecimal - 1;
  if (posDecimal === -1 || casas === 0 || casas > 2) {
    const digitos = limpo.replace(/[^\d]/g, '');
    return digitos ? reaisToCents(Number(digitos)) : 0;
  }

  const inteiros = limpo.slice(0, posDecimal).replace(/[^\d]/g, '') || '0';
  const decimais = limpo.slice(posDecimal + 1).padEnd(2, '0').slice(0, 2);
  // Soma em centavos inteiros, nunca reconstruindo um float de reais.
  return Number(inteiros) * 100 + Number(decimais);
}

/** Máscara progressiva do campo de preço: mostra "1.899,90" enquanto digita. */
export function maskBRLInput(input: string): string {
  const digitos = String(input).replace(/\D/g, '').slice(0, 11);
  if (!digitos) return '';
  const cents = Number(digitos);
  return BRL.format(cents / 100);
}

// ------------------------------------------------------------------- filtros

export const DEFAULT_LISTING_FILTERS: ListingFilters = {
  category: null,
  condition: null,
  state: null,
  minPriceCents: null,
  maxPriceCents: null,
  minSize: null,
  maxSize: null,
  q: '',
  sort: 'recent',
  mine: false,
  favorites: false,
};

function inteiroOuNulo(raw: string | null, min = 0): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return null;
  return Math.trunc(n);
}

function numeroOuNulo(raw: string | null, min = 0): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) return null;
  return n;
}

function umDe<T extends string>(raw: string | null, permitidos: readonly T[]): T | null {
  if (raw === null) return null;
  return permitidos.includes(raw as T) ? (raw as T) : null;
}

/**
 * Normaliza a query string do feed em filtros já validados.
 *
 * Valor inválido vira `null` (filtro ignorado) em vez de erro 400: o feed do
 * marketplace não deve quebrar por causa de um parâmetro digitado errado num
 * link compartilhado. O que importa é que nada não-validado chegue ao SQL.
 */
export function parseListingFilters(params: URLSearchParams): ListingFilters {
  const minPrice = inteiroOuNulo(params.get('minPrice'));
  const maxPrice = inteiroOuNulo(params.get('maxPrice'));
  const minSize = numeroOuNulo(params.get('minSize'));
  const maxSize = numeroOuNulo(params.get('maxSize'));

  // Faixa invertida (min > max) devolveria zero resultado sem explicação;
  // trocamos a ordem, que é o que a pessoa quis dizer.
  const [minP, maxP] =
    minPrice !== null && maxPrice !== null && minPrice > maxPrice
      ? [maxPrice, minPrice]
      : [minPrice, maxPrice];
  const [minS, maxS] =
    minSize !== null && maxSize !== null && minSize > maxSize
      ? [maxSize, minSize]
      : [minSize, maxSize];

  return {
    category: umDe(params.get('category'), LISTING_CATEGORIES),
    condition: umDe(params.get('condition'), LISTING_CONDITIONS),
    state: umDe(params.get('state'), LISTING_STATES),
    minPriceCents: minP,
    maxPriceCents: maxP,
    minSize: minS,
    maxSize: maxS,
    q: (params.get('q') ?? '').trim().slice(0, 120),
    sort: umDe(params.get('sort'), LISTING_SORTS) ?? 'recent',
    mine: params.get('mine') === '1',
    favorites: params.get('favorites') === '1',
  };
}

/** Serializa filtros de volta para query string, omitindo o que está neutro. */
export function listingFiltersToQuery(
  filters: ListingFilters,
  page: { limit?: number; offset?: number } = {}
): string {
  const p = new URLSearchParams();
  if (filters.category) p.set('category', filters.category);
  if (filters.condition) p.set('condition', filters.condition);
  if (filters.state) p.set('state', filters.state);
  if (filters.minPriceCents !== null) p.set('minPrice', String(filters.minPriceCents));
  if (filters.maxPriceCents !== null) p.set('maxPrice', String(filters.maxPriceCents));
  if (filters.minSize !== null) p.set('minSize', String(filters.minSize));
  if (filters.maxSize !== null) p.set('maxSize', String(filters.maxSize));
  if (filters.q.trim()) p.set('q', filters.q.trim());
  if (filters.sort !== 'recent') p.set('sort', filters.sort);
  if (filters.mine) p.set('mine', '1');
  if (filters.favorites) p.set('favorites', '1');
  if (page.limit) p.set('limit', String(page.limit));
  if (page.offset) p.set('offset', String(page.offset));
  return p.toString();
}

/**
 * Quantos filtros estão ativos, para o badge do botão "Filtros".
 *
 * Faixa de preço e faixa de tamanho contam como UM filtro cada, mesmo com os
 * dois extremos preenchidos: o número tem de bater com a quantidade de chips na
 * tela, senão o badge diz "5" e o velejador conta 3.
 */
export function countActiveFilters(filters: ListingFilters): number {
  let n = 0;
  if (filters.category) n++;
  if (filters.condition) n++;
  if (filters.state) n++;
  if (filters.minPriceCents !== null || filters.maxPriceCents !== null) n++;
  if (filters.minSize !== null || filters.maxSize !== null) n++;
  if (filters.favorites) n++;
  if (filters.mine) n++;
  return n;
}

/** Chave de um filtro removível, para o chip saber o que zerar. */
export type ListingFilterKey =
  | 'category'
  | 'condition'
  | 'state'
  | 'price'
  | 'size'
  | 'favorites'
  | 'mine';

export interface FilterChip {
  key: ListingFilterKey;
  label: string;
}

/** Chips dos filtros ativos. Preço e tamanho viram um chip só (faixa). */
export function activeFilterChips(filters: ListingFilters): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.category) chips.push({ key: 'category', label: filters.category });
  if (filters.condition) chips.push({ key: 'condition', label: filters.condition });
  if (filters.state) chips.push({ key: 'state', label: filters.state });

  if (filters.minPriceCents !== null || filters.maxPriceCents !== null) {
    const de = filters.minPriceCents !== null ? formatBRL(filters.minPriceCents) : null;
    const ate = filters.maxPriceCents !== null ? formatBRL(filters.maxPriceCents) : null;
    const label = de && ate ? `${de} – ${ate}` : de ? `A partir de ${de}` : `Até ${ate}`;
    chips.push({ key: 'price', label });
  }

  if (filters.minSize !== null || filters.maxSize !== null) {
    const de = filters.minSize;
    const ate = filters.maxSize;
    const label =
      de !== null && ate !== null
        ? `${de} – ${ate}`
        : de !== null
          ? `A partir de ${de}`
          : `Até ${ate}`;
    chips.push({ key: 'size', label: `Tamanho ${label}` });
  }

  if (filters.favorites) chips.push({ key: 'favorites', label: 'Só favoritos' });
  if (filters.mine) chips.push({ key: 'mine', label: 'Meus anúncios' });

  return chips;
}

/** Remove um filtro pela chave do chip, devolvendo novos filtros. */
export function clearFilter(filters: ListingFilters, key: ListingFilterKey): ListingFilters {
  switch (key) {
    case 'category':
      return { ...filters, category: null };
    case 'condition':
      return { ...filters, condition: null };
    case 'state':
      return { ...filters, state: null };
    case 'price':
      return { ...filters, minPriceCents: null, maxPriceCents: null };
    case 'size':
      return { ...filters, minSize: null, maxSize: null };
    case 'favorites':
      return { ...filters, favorites: false };
    case 'mine':
      return { ...filters, mine: false };
  }
}

/** Rótulo curto do tamanho, respeitando a unidade de cada categoria. */
export function formatListingSize(opts: {
  category: ListingCategory;
  sizeM2?: number | null;
  sizeCm?: number | null;
}): string | null {
  if (opts.sizeM2 != null && CATEGORIES_SIZE_M2.includes(opts.category)) {
    return `${opts.sizeM2}m²`;
  }
  if (opts.sizeCm != null && CATEGORIES_SIZE_CM.includes(opts.category)) {
    return `${opts.sizeCm}cm`;
  }
  if (opts.sizeM2 != null) return `${opts.sizeM2}m²`;
  if (opts.sizeCm != null) return `${opts.sizeCm}cm`;
  return null;
}
