/**
 * Testes de lib/social.ts — regra de negação incluída de propósito em cada
 * função: "não posso me seguir" e "não vejo sessão privada de terceiro" são
 * exatamente os dois jeitos de um velejador ver o que não devia.
 */
import { describe, expect, it } from 'vitest';
import {
  podeResponderComentario,
  podeSeguir,
  podeVerSessao,
  relacaoComRider,
  rotuloBotaoSeguir,
} from './social';

describe('podeSeguir', () => {
  it('autoriza seguir outro velejador', () => {
    expect(podeSeguir('u-eu', 'u-outro')).toBe(true);
  });

  it('nega seguir a si mesmo — mesma regra do CHECK de user_follows no banco', () => {
    expect(podeSeguir('u-eu', 'u-eu')).toBe(false);
  });
});

describe('relacaoComRider', () => {
  it('nenhuma: nenhum dos dois segue o outro', () => {
    expect(relacaoComRider(false, false)).toBe('nenhuma');
  });

  it('seguindo: eu sigo, ele não me segue', () => {
    expect(relacaoComRider(true, false)).toBe('seguindo');
  });

  it('segue_voce: ele me segue, eu não sigo', () => {
    expect(relacaoComRider(false, true)).toBe('segue_voce');
  });

  it('amigos: seguimento mútuo — derivado, não é tabela', () => {
    expect(relacaoComRider(true, true)).toBe('amigos');
  });
});

describe('rotuloBotaoSeguir', () => {
  it('nenhuma -> "Seguir"', () => {
    expect(rotuloBotaoSeguir('nenhuma')).toBe('Seguir');
  });

  it('segue_voce -> "Seguir de volta" (ele já me segue, eu ainda não)', () => {
    expect(rotuloBotaoSeguir('segue_voce')).toBe('Seguir de volta');
  });

  it('seguindo -> "Seguindo" (eu sigo, ele não me segue de volta)', () => {
    expect(rotuloBotaoSeguir('seguindo')).toBe('Seguindo');
  });

  it('amigos -> "Amigos" (seguimento mútuo)', () => {
    expect(rotuloBotaoSeguir('amigos')).toBe('Amigos');
  });
});

describe('podeVerSessao', () => {
  it('dono sempre vê a própria sessão, mesmo privada', () => {
    expect(podeVerSessao({ autorId: 'u-a', isPublic: false }, 'u-a')).toBe(true);
    expect(podeVerSessao({ autorId: 'u-a', isPublic: true }, 'u-a')).toBe(true);
  });

  it('terceiro vê sessão pública de outro velejador', () => {
    expect(podeVerSessao({ autorId: 'u-a', isPublic: true }, 'u-b')).toBe(true);
  });

  it('terceiro NÃO vê sessão privada de outro velejador', () => {
    expect(podeVerSessao({ autorId: 'u-a', isPublic: false }, 'u-b')).toBe(false);
  });
});

describe('podeResponderComentario', () => {
  it('permite responder a um comentário de primeiro nível (parentCommentId null)', () => {
    expect(podeResponderComentario({ parentCommentId: null })).toBe(true);
  });

  it('nega responder a uma resposta — Facebook: só 1 nível, nunca resposta de resposta', () => {
    expect(podeResponderComentario({ parentCommentId: 'c-pai' })).toBe(false);
  });
});
