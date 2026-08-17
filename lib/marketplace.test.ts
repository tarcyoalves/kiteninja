/**
 * Testes do marketplace.
 *
 * Aqui o dano é financeiro e de privacidade, não físico: preço com um centavo a
 * menos por erro de ponto flutuante, foto apontando para host de terceiro, ou
 * filtro que silenciosamente ignora o que o velejador pediu e mostra kite de
 * R$ 8 mil para quem filtrou até R$ 2 mil.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LISTING_FILTERS,
  LISTING_CATEGORIES,
  MAX_PHOTO_CHARS,
  activeFilterChips,
  centsToReais,
  clearFilter,
  countActiveFilters,
  formatBRL,
  formatListingSize,
  isSafeImageDataUrl,
  listingFiltersToQuery,
  maskBRLInput,
  parseBRLToCents,
  parseListingFilters,
  reaisToCents,
} from './marketplace';
import type { ListingFilters } from '../types';

/** Espaço estreito não separável que o Intl usa entre "R$" e o número. */
function normalizar(s: string): string {
  return s.replace(/ | /g, ' ');
}

describe('formatBRL', () => {
  it('formata centavos como moeda brasileira', () => {
    expect(normalizar(formatBRL(0))).toBe('R$ 0,00');
    expect(normalizar(formatBRL(1999))).toBe('R$ 19,99');
    expect(normalizar(formatBRL(189990))).toBe('R$ 1.899,90');
    expect(normalizar(formatBRL(100000000))).toBe('R$ 1.000.000,00');
  });

  it('sempre mostra duas casas, inclusive em valor redondo', () => {
    expect(normalizar(formatBRL(250000))).toBe('R$ 2.500,00');
    expect(normalizar(formatBRL(5))).toBe('R$ 0,05');
  });

  it('não devolve NaN quando o valor vem quebrado do banco', () => {
    expect(normalizar(formatBRL(Number.NaN))).toBe('R$ 0,00');
    expect(formatBRL(Number.NaN)).not.toMatch(/NaN/);
  });
});

describe('conversão reais ↔ centavos', () => {
  it('não perde centavo em valor com dízima binária', () => {
    // 19.99 * 100 = 1998.9999999999998 em float; truncar tiraria um centavo.
    expect(reaisToCents(19.99)).toBe(1999);
    expect(reaisToCents(0.07)).toBe(7);
    expect(reaisToCents(4999.99)).toBe(499999);
    expect(reaisToCents(1.29)).toBe(129);
    expect(reaisToCents(8.15)).toBe(815);
  });

  it('meio centavo mostra o limite do float, e é por isso que a UI não usa reais', () => {
    // 1.005 em binário é 1.00499999...: reaisToCents devolve 100, não 101. Não é
    // bug de arredondamento, é o limite de representar dinheiro em float. Por
    // isso o campo de preço da tela usa parseBRLToCents/maskBRLInput, que
    // trabalham só com dígitos e nunca constroem um float de reais.
    expect(reaisToCents(1.005)).toBe(100);
    expect(parseBRLToCents(maskBRLInput('101'))).toBe(101);
  });

  it('ida e volta preserva o valor exato', () => {
    for (const cents of [0, 1, 7, 99, 1999, 189990, 499999, 100000000]) {
      expect(reaisToCents(centsToReais(cents))).toBe(cents);
    }
  });

  it('sempre produz inteiro, nunca float', () => {
    for (const reais of [0.1, 0.2, 0.3, 12.34, 999.995, 1234.567]) {
      expect(Number.isInteger(reaisToCents(reais))).toBe(true);
    }
  });

  it('soma de preços em centavos não acumula erro', () => {
    // Em reais, 0.1 + 0.2 !== 0.3. Em centavos a igualdade é exata, e é por
    // isso que todo o app guarda dinheiro como inteiro.
    const total = reaisToCents(0.1) + reaisToCents(0.2);
    expect(total).toBe(reaisToCents(0.3));
    expect(total).toBe(30);
  });

  it('valor negativo ou inválido vira zero em vez de sujar o banco', () => {
    expect(reaisToCents(-50)).toBe(0);
    expect(reaisToCents(Number.NaN)).toBe(0);
    expect(reaisToCents(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('parseBRLToCents — o que o velejador digita no celular', () => {
  it('aceita os formatos que aparecem na prática', () => {
    expect(parseBRLToCents('1.899,90')).toBe(189990);
    expect(parseBRLToCents('1899,90')).toBe(189990);
    expect(parseBRLToCents('R$ 1.899,90')).toBe(189990);
    expect(parseBRLToCents('1899.90')).toBe(189990);
    expect(parseBRLToCents('19,9')).toBe(1990);
  });

  it('valor inteiro sem centavos não ganha zeros errados', () => {
    expect(parseBRLToCents('2500')).toBe(250000);
    expect(parseBRLToCents('2.500')).toBe(250000);
    expect(parseBRLToCents('R$ 2.500')).toBe(250000);
  });

  it('entrada vazia ou só símbolo vira zero', () => {
    expect(parseBRLToCents('')).toBe(0);
    expect(parseBRLToCents('R$')).toBe(0);
    expect(parseBRLToCents('abc')).toBe(0);
  });

  it('sempre devolve inteiro', () => {
    for (const s of ['1.899,90', '0,01', '12,3', '99999,99', '7']) {
      expect(Number.isInteger(parseBRLToCents(s))).toBe(true);
    }
  });

  it('fecha o ciclo com formatBRL', () => {
    for (const cents of [1, 99, 1999, 250000, 189990]) {
      expect(parseBRLToCents(formatBRL(cents))).toBe(cents);
    }
  });
});

describe('maskBRLInput', () => {
  it('monta o valor da direita para a esquerda enquanto digita', () => {
    expect(maskBRLInput('')).toBe('');
    expect(normalizar(maskBRLInput('1'))).toBe('R$ 0,01');
    expect(normalizar(maskBRLInput('189990'))).toBe('R$ 1.899,90');
  });

  it('ignora o que não é dígito', () => {
    expect(normalizar(maskBRLInput('R$ 1.899,90'))).toBe('R$ 1.899,90');
  });

  it('o valor mascarado volta a virar os mesmos centavos', () => {
    expect(parseBRLToCents(maskBRLInput('189990'))).toBe(189990);
  });
});

describe('isSafeImageDataUrl', () => {
  it('aceita data URL jpeg, png e webp', () => {
    for (const tipo of ['jpeg', 'png', 'webp']) {
      expect(isSafeImageDataUrl(`data:image/${tipo};base64,iVBORw0KGgo=`)).toBe(true);
    }
  });

  it('rejeita URL externa: o feed não deve disparar GET em host de terceiro', () => {
    const externas = [
      'https://evil.example.com/foto.jpg',
      'http://cdn.exemplo.com/kite.png',
      '//exemplo.com/kite.png',
      '/uploads/kite.jpg',
      'ftp://exemplo.com/kite.jpg',
    ];
    for (const url of externas) {
      expect(isSafeImageDataUrl(url)).toBe(false);
    }
  });

  it('rejeita data URL de tipo não-imagem ou perigoso', () => {
    expect(isSafeImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe(false);
    expect(isSafeImageDataUrl('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeImageDataUrl('data:application/javascript;base64,YWxlcnQoMSk=')).toBe(false);
    expect(isSafeImageDataUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejeita data URL sem base64 declarado', () => {
    expect(isSafeImageDataUrl('data:image/png,rawbytes')).toBe(false);
    expect(isSafeImageDataUrl('data:image/png;charset=utf-8,abc')).toBe(false);
  });

  it('rejeita valor que não é string ou está vazio', () => {
    expect(isSafeImageDataUrl(null)).toBe(false);
    expect(isSafeImageDataUrl(undefined)).toBe(false);
    expect(isSafeImageDataUrl(42)).toBe(false);
    expect(isSafeImageDataUrl('')).toBe(false);
    expect(isSafeImageDataUrl({})).toBe(false);
  });

  it('rejeita foto acima do teto de tamanho do corpo da requisição', () => {
    const grande = `data:image/jpeg;base64,${'A'.repeat(MAX_PHOTO_CHARS)}`;
    expect(isSafeImageDataUrl(grande)).toBe(false);
  });
});

describe('parseListingFilters — montagem dos filtros', () => {
  const filtros = (qs: string) => parseListingFilters(new URLSearchParams(qs));

  it('sem parâmetro nenhum, nada é filtrado', () => {
    expect(filtros('')).toEqual(DEFAULT_LISTING_FILTERS);
    expect(countActiveFilters(filtros(''))).toBe(0);
  });

  it('lê os filtros válidos da query string', () => {
    const f = filtros(
      'category=Kite&condition=Semi-novo&state=CE&minPrice=100000&maxPrice=500000&minSize=7&maxSize=12&q=rebel&sort=price_asc&mine=1&favorites=1'
    );
    expect(f.category).toBe('Kite');
    expect(f.condition).toBe('Semi-novo');
    expect(f.state).toBe('CE');
    expect(f.minPriceCents).toBe(100000);
    expect(f.maxPriceCents).toBe(500000);
    expect(f.minSize).toBe(7);
    expect(f.maxSize).toBe(12);
    expect(f.q).toBe('rebel');
    expect(f.sort).toBe('price_asc');
    expect(f.mine).toBe(true);
    expect(f.favorites).toBe(true);
  });

  it('valor fora da lista permitida é descartado, não vira filtro', () => {
    // Se um valor arbitrário passasse adiante, ele chegaria ao CHECK do banco
    // como erro 500 em vez de "filtro ignorado".
    const f = filtros("category=DROP TABLE&condition=Perfeito&state=ZZ&sort=random");
    expect(f.category).toBeNull();
    expect(f.condition).toBeNull();
    expect(f.state).toBeNull();
    expect(f.sort).toBe('recent');
  });

  it('preço não numérico ou negativo é ignorado', () => {
    const f = filtros('minPrice=abc&maxPrice=-500');
    expect(f.minPriceCents).toBeNull();
    expect(f.maxPriceCents).toBeNull();
  });

  it('preço em centavos permanece inteiro', () => {
    const f = filtros('minPrice=199990.7&maxPrice=500000');
    expect(f.minPriceCents).toBe(199990);
    expect(Number.isInteger(f.minPriceCents!)).toBe(true);
  });

  it('faixa invertida é corrigida em vez de devolver lista vazia', () => {
    const f = filtros('minPrice=500000&maxPrice=100000&minSize=12&maxSize=7');
    expect(f.minPriceCents).toBe(100000);
    expect(f.maxPriceCents).toBe(500000);
    expect(f.minSize).toBe(7);
    expect(f.maxSize).toBe(12);
  });

  it('busca é aparada e limitada em tamanho', () => {
    expect(filtros('q=%20%20rebel%20%20').q).toBe('rebel');
    expect(filtros(`q=${'a'.repeat(400)}`).q.length).toBe(120);
  });

  it('mine e favorites só ligam com o valor exato "1"', () => {
    expect(filtros('mine=true').mine).toBe(false);
    expect(filtros('mine=0').mine).toBe(false);
    expect(filtros('mine=1').mine).toBe(true);
    expect(filtros('favorites=1').favorites).toBe(true);
  });

  it('toda categoria do domínio é aceita, incluindo as acentuadas', () => {
    for (const c of LISTING_CATEGORIES) {
      const f = parseListingFilters(new URLSearchParams({ category: c }));
      expect(f.category).toBe(c);
    }
  });

  it('ida e volta pela query string preserva os filtros', () => {
    const original = filtros(
      'category=Foil&condition=Usado&state=RN&minPrice=50000&maxPrice=300000&minSize=5&maxSize=9&q=duotone&sort=price_desc&favorites=1'
    );
    const roundTrip = filtros(listingFiltersToQuery(original));
    expect(roundTrip).toEqual(original);
  });

  it('filtro neutro não polui a query string', () => {
    expect(listingFiltersToQuery(DEFAULT_LISTING_FILTERS)).toBe('');
    // sort=recent é o padrão e também é omitido.
    expect(listingFiltersToQuery({ ...DEFAULT_LISTING_FILTERS, sort: 'recent' })).toBe('');
  });

  it('paginação entra na query só quando pedida', () => {
    expect(listingFiltersToQuery(DEFAULT_LISTING_FILTERS, { limit: 24 })).toBe('limit=24');
    expect(listingFiltersToQuery(DEFAULT_LISTING_FILTERS, { offset: 0 })).toBe('');
  });
});

describe('chips de filtro ativo', () => {
  it('não mostra chip quando nada está filtrado', () => {
    expect(activeFilterChips(DEFAULT_LISTING_FILTERS)).toEqual([]);
  });

  it('preço vira um chip de faixa, não dois', () => {
    const chips = activeFilterChips({
      ...DEFAULT_LISTING_FILTERS,
      minPriceCents: 100000,
      maxPriceCents: 500000,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].key).toBe('price');
    expect(normalizar(chips[0].label)).toContain('R$ 1.000,00');
    expect(normalizar(chips[0].label)).toContain('R$ 5.000,00');
  });

  it('faixa aberta descreve o lado informado', () => {
    const so_min = activeFilterChips({ ...DEFAULT_LISTING_FILTERS, minPriceCents: 100000 });
    expect(so_min[0].label).toMatch(/A partir de/);

    const so_max = activeFilterChips({ ...DEFAULT_LISTING_FILTERS, maxPriceCents: 100000 });
    expect(so_max[0].label).toMatch(/^Até/);
  });

  it('remover um chip zera só o filtro dele', () => {
    const cheio = {
      ...DEFAULT_LISTING_FILTERS,
      category: 'Kite' as const,
      state: 'CE',
      minPriceCents: 100000,
      maxPriceCents: 500000,
      favorites: true,
    };
    expect(countActiveFilters(cheio)).toBe(4);

    const semPreco = clearFilter(cheio, 'price');
    expect(semPreco.minPriceCents).toBeNull();
    expect(semPreco.maxPriceCents).toBeNull();
    expect(semPreco.category).toBe('Kite');
    expect(semPreco.state).toBe('CE');
    expect(semPreco.favorites).toBe(true);
  });

  it('remover todos os chips volta ao estado neutro', () => {
    /* Tipo anotado: sem isso o TS infere pelo valor inicial (category: 'Wing')
       e a reatribuição para null dentro do laço não compila. */
    let f: ListingFilters = {
      ...DEFAULT_LISTING_FILTERS,
      category: 'Wing' as const,
      condition: 'Novo' as const,
      state: 'SC',
      minPriceCents: 1000,
      maxPriceCents: 2000,
      minSize: 4,
      maxSize: 6,
      favorites: true,
      mine: true,
    };
    for (const chip of activeFilterChips(f)) {
      f = { ...f, ...clearFilter(f, chip.key) };
    }
    expect(countActiveFilters(f)).toBe(0);
    // Busca e ordenação não são chips: seguem seus próprios controles.
    expect(activeFilterChips(f)).toEqual([]);
  });

  it('cada filtro ativo gera exatamente um chip removível', () => {
    const f = {
      ...DEFAULT_LISTING_FILTERS,
      category: 'Prancha' as const,
      condition: 'Usado' as const,
      state: 'RJ',
      minSize: 130,
    };
    const chips = activeFilterChips(f);
    expect(chips.map((c) => c.key)).toEqual(['category', 'condition', 'state', 'size']);
  });
});

describe('formatListingSize', () => {
  it('usa m² para kite, wing e foil', () => {
    expect(formatListingSize({ category: 'Kite', sizeM2: 9 })).toBe('9m²');
    expect(formatListingSize({ category: 'Wing', sizeM2: 4.5 })).toBe('4.5m²');
    expect(formatListingSize({ category: 'Foil', sizeM2: 1.2 })).toBe('1.2m²');
  });

  it('usa cm para prancha', () => {
    expect(formatListingSize({ category: 'Prancha', sizeCm: 138 })).toBe('138cm');
  });

  it('sem tamanho informado não inventa rótulo', () => {
    expect(formatListingSize({ category: 'Barra' })).toBeNull();
    expect(formatListingSize({ category: 'Kite', sizeM2: null })).toBeNull();
  });
});
