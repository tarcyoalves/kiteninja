import { describe, it, expect } from 'vitest';
import {
  NUMEROS_EMERGENCIA,
  NUMEROS_PRIORITARIOS,
  mensagemDeSocorro,
  TEXTO_FALHA_REDE,
} from './emergencia';

/**
 * Estes testes protegem dado que só é usado numa emergência — ou seja, um erro
 * aqui não aparece em uso normal e só se manifesta na pior hora possível.
 */
describe('NUMEROS_EMERGENCIA', () => {
  it('mantém 193 (Bombeiros) como primeira opção', () => {
    // Salvamento aquático no litoral: é a resposta mais rápida na maioria das
    // cidades. Se alguém reordenar a lista sem pensar, este teste avisa.
    expect(NUMEROS_EMERGENCIA[0].numero).toBe('193');
    expect(NUMEROS_EMERGENCIA[0].nome).toBe('Bombeiros');
  });

  it('inclui a Marinha (185) para resgate em mar aberto', () => {
    const marinha = NUMEROS_EMERGENCIA.find(n => n.numero === '185');
    expect(marinha).toBeDefined();
    expect(marinha!.nome).toBe('Marinha');
  });

  it('só contém números discáveis (dígitos), sem espaço ou máscara', () => {
    // O valor vai direto para `tel:`. Um espaço ou parêntese quebra a discagem
    // em alguns Androids, silenciosamente.
    for (const n of NUMEROS_EMERGENCIA) {
      expect(n.numero).toMatch(/^\d{3}$/);
    }
  });

  it('não repete número', () => {
    const nums = NUMEROS_EMERGENCIA.map(n => n.numero);
    expect(new Set(nums).size).toBe(nums.length);
  });

  it('todo número explica quando ligar', () => {
    // Quem está em pânico não lê parágrafo: cada opção precisa de uma linha
    // curta que resolva a escolha.
    for (const n of NUMEROS_EMERGENCIA) {
      expect(n.quando.length).toBeGreaterThan(8);
      expect(n.quando.length).toBeLessThan(60);
      expect(n.cor).toContain('bg-');
      expect(n.corTexto).toContain('text-');
    }
  });

  it('a lista curta traz 193 e 185, nessa ordem', () => {
    expect(NUMEROS_PRIORITARIOS.map(n => n.numero)).toEqual(['193', '185']);
  });
});

describe('mensagemDeSocorro', () => {
  it('inclui coordenada em números E link de mapa', () => {
    // Números avulsos porque quem atende o 193 pede "me passa a latitude";
    // link porque quem recebe no WhatsApp quer tocar e navegar.
    const msg = mensagemDeSocorro({
      nome: 'João', lat: -5.12345678, lng: -35.98765432, spotNome: 'Ponta do Mel',
    });
    expect(msg).toContain('-5.12346');
    expect(msg).toContain('-35.98765');
    expect(msg).toContain('maps.google.com');
    expect(msg).toContain('Ponta do Mel');
    expect(msg).toContain('João');
  });

  it('sem GPS, avisa explicitamente que a posição não foi confirmada', () => {
    // Este é o caso que antes escondia o botão de WhatsApp inteiro. Mandar a
    // mensagem sem posição é melhor que não mandar nada — mas ela NÃO pode
    // sugerir uma posição que não existe.
    const msg = mensagemDeSocorro({ nome: 'João', lat: null, lng: null, spotNome: null });
    expect(msg.toLowerCase()).toContain('não confirmada');
    expect(msg).not.toContain('maps.google.com');
    expect(msg).not.toContain('null');
    expect(msg).not.toContain('undefined');
  });

  it('sempre aponta para a autoridade, com ou sem GPS', () => {
    const comGps = mensagemDeSocorro({ nome: 'A', lat: -5, lng: -35, spotNome: null });
    const semGps = mensagemDeSocorro({ nome: 'A', lat: null, lng: null, spotNome: null });
    for (const msg of [comGps, semGps]) {
      expect(msg).toContain('193');
      expect(msg).toContain('185');
    }
  });

  it('lida com coordenada zero sem tratá-la como ausente', () => {
    // Falsy-bug clássico: lat 0 é o equador, uma posição válida. Um
    // `if (lat)` no lugar de `if (lat !== null)` apagaria a posição.
    const msg = mensagemDeSocorro({ nome: 'A', lat: 0, lng: 0, spotNome: null });
    expect(msg).toContain('0.00000');
    expect(msg.toLowerCase()).not.toContain('não confirmada');
  });
});

describe('TEXTO_FALHA_REDE', () => {
  it('deixa claro que a comunidade NÃO foi avisada', () => {
    // Meia verdade aqui custa vida: o velejador poderia ficar esperando um
    // socorro que nunca foi acionado.
    expect(TEXTO_FALHA_REDE.toLowerCase()).toContain('não conseguimos avisar');
  });
});
