import { describe, expect, it } from 'vitest';
import { UFS_BRASIL, eventoCasaComUf, normalizarUf, ufsPresentes } from './uf';

describe('UFS_BRASIL', () => {
  it('tem as 27 unidades federativas, sem repetição', () => {
    expect(UFS_BRASIL).toHaveLength(27);
    expect(new Set(UFS_BRASIL).size).toBe(27);
  });

  it('cobre os estados dos spots já catalogados', () => {
    // Se um spot novo entrar com UF fora desta lista, o evento dele nasce sem
    // estado e some de qualquer filtro — falha silenciosa. Este teste é o
    // alarme.
    for (const uf of ['CE', 'PI', 'RJ', 'RN']) {
      expect(UFS_BRASIL).toContain(uf);
    }
  });
});

describe('normalizarUf', () => {
  it('aceita sigla válida em qualquer caixa', () => {
    expect(normalizarUf('rn')).toBe('RN');
    expect(normalizarUf(' CE ')).toBe('CE');
  });

  it('devolve null para desconhecido, em vez de inventar uma UF plausível', () => {
    for (const ruim of ['XX', 'Rio Grande do Norte', 'BR', '', null, undefined, 12, {}]) {
      expect(normalizarUf(ruim)).toBeNull();
    }
  });
});

describe('eventoCasaComUf', () => {
  it('sem filtro, tudo entra — inclusive evento sem UF', () => {
    expect(eventoCasaComUf('RN', null)).toBe(true);
    expect(eventoCasaComUf(null, null)).toBe(true);
  });

  it('com filtro, só a UF pedida', () => {
    expect(eventoCasaComUf('RN', 'RN')).toBe(true);
    expect(eventoCasaComUf('CE', 'RN')).toBe(false);
  });

  it('evento sem UF fica de fora de um filtro específico', () => {
    // Mostrar um evento de estado desconhecido a quem pediu "Ceará" é
    // responder outra pergunta.
    expect(eventoCasaComUf(null, 'CE')).toBe(false);
  });
});

describe('ufsPresentes', () => {
  it('lista só o que existe, ordenado e sem repetir', () => {
    const ufs = ufsPresentes([
      { uf: 'RN' }, { uf: 'CE' }, { uf: 'RN' }, { uf: null }, { uf: 'PI' },
    ]);
    expect(ufs).toEqual(['CE', 'PI', 'RN']);
  });

  it('devolve lista vazia quando nenhum evento tem UF', () => {
    // A barra de filtros some sozinha nesse caso — botão que só sabe devolver
    // lista vazia é pior que filtro nenhum.
    expect(ufsPresentes([{ uf: null }, { uf: null }])).toEqual([]);
    expect(ufsPresentes([])).toEqual([]);
  });
});
