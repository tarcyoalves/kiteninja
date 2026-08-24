/**
 * Testes para as funções de lógica pura do SOS (lib/sos.ts).
 */
import { describe, expect, it } from 'vitest';
import { 
  proximoRaio, 
  deveEscalar, 
  ordenarCandidatos, 
  textoDoAlerta, 
  boundingBox,
  JANELA_PRESENCA_MS
} from './sos';

describe('proximoRaio', () => {
  it('avança para o próximo estágio', () => {
    expect(proximoRaio(5)).toBe(15);
    expect(proximoRaio(15)).toBe(50);
  });

  it('retorna null se estiver no estágio máximo ou for desconhecido', () => {
    expect(proximoRaio(50)).toBeNull();
    expect(proximoRaio(100)).toBeNull();
  });
});

describe('deveEscalar', () => {
  const agora = new Date('2024-01-01T12:10:00Z');
  
  it('retorna false quando temResponsavel é true, mesmo com o tempo expirado', () => {
    const criadoEm = new Date('2024-01-01T12:00:00Z'); // 10 mins atrás
    const result = deveEscalar({ raioKm: 5, criadoEm, escaladoEm: null, agora, temResponsavel: true });
    expect(result).toBe(false);
  });

  it('retorna true quando o tempo expira e não há responsável', () => {
    const criadoEm = new Date('2024-01-01T12:05:00Z'); // 5 mins atrás (tempo > 2 mins)
    const result = deveEscalar({ raioKm: 5, criadoEm, escaladoEm: null, agora, temResponsavel: false });
    expect(result).toBe(true);
  });

  it('retorna false quando o tempo não expirou', () => {
    const criadoEm = new Date('2024-01-01T12:09:00Z'); // 1 min atrás (tempo < 2 mins)
    const result = deveEscalar({ raioKm: 5, criadoEm, escaladoEm: null, agora, temResponsavel: false });
    expect(result).toBe(false);
  });

  it('respeita escaladoEm (não criadoEm) quando a escalada já ocorreu', () => {
    const criadoEm = new Date('2024-01-01T12:00:00Z'); // 10 mins atrás
    // escalado recentemente, não deve escalar ainda
    const escaladoEm = new Date('2024-01-01T12:09:00Z'); // 1 min atrás
    const result1 = deveEscalar({ raioKm: 15, criadoEm, escaladoEm, agora, temResponsavel: false });
    expect(result1).toBe(false);
    
    // escalado há bastante tempo, deve escalar
    const escaladoEm2 = new Date('2024-01-01T12:05:00Z'); // 5 mins atrás
    const result2 = deveEscalar({ raioKm: 15, criadoEm, escaladoEm: escaladoEm2, agora, temResponsavel: false });
    expect(result2).toBe(true);
  });

  // MUDANÇA DE REGRA (2026-08-23) — ver docs/MAQUINA-ESTADOS-SOS.md.
  // Este teste antes afirmava o contrário: que 'em_atendimento' NUNCA volta a
  // escalar. Aquela regra criava o cenário de abandono: socorrista marca
  // 'a_caminho', desiste (ou simplesmente some), e o SOS fica congelado em
  // 5 km para sempre — velejador sem socorro e sem escalada.
  // Quem manda agora é `temResponsavel`. O antiflapping que justificava o
  // congelamento é feito reiniciando `escalated_at` na volta para 'ativo'
  // (ver app/api/sos/[id]/respond/route.ts), não travando a busca.
  it('volta a escalar um SOS em_atendimento abandonado (sem responsável vivo) com prazo vencido', () => {
    const criadoEm = new Date('2024-01-01T12:00:00Z'); // 10 mins atrás, prazo vencido
    const result = deveEscalar({
      raioKm: 5,
      criadoEm,
      escaladoEm: null,
      agora,
      temResponsavel: false,
      statusAtual: 'em_atendimento',
    });
    expect(result).toBe(true);
  });

  it('não escala em_atendimento enquanto houver responsável vivo', () => {
    const criadoEm = new Date('2024-01-01T12:00:00Z');
    const result = deveEscalar({
      raioKm: 5,
      criadoEm,
      escaladoEm: null,
      agora,
      temResponsavel: true,
      statusAtual: 'em_atendimento',
    });
    expect(result).toBe(false);
  });

  it('nunca escala um SOS em estado terminal, mesmo sem responsável e com prazo vencido', () => {
    const criadoEm = new Date('2024-01-01T12:00:00Z');
    for (const statusAtual of ['resolvido', 'cancelado', 'falso_alarme'] as const) {
      expect(
        deveEscalar({ raioKm: 5, criadoEm, escaladoEm: null, agora, temResponsavel: false, statusAtual })
      ).toBe(false);
    }
  });

  it('o reinício do relógio na volta para ativo evita escalada instantânea (antiflapping)', () => {
    // Socorrista desistiu agora: respond grava escalated_at = NOW().
    // Mesmo com o SOS criado há muito tempo, precisa esperar o estágio inteiro.
    const criadoEm = new Date('2024-01-01T12:00:00Z'); // 10 min atrás
    const acabouDeDesistir = new Date(agora.getTime() - 1000); // 1s atrás

    expect(
      deveEscalar({ raioKm: 5, criadoEm, escaladoEm: acabouDeDesistir, agora, temResponsavel: false, statusAtual: 'ativo' })
    ).toBe(false);

    // Passados os 2 min do estágio, escala.
    const desistiuHaDoisMin = new Date(agora.getTime() - 2 * 60 * 1000);
    expect(
      deveEscalar({ raioKm: 5, criadoEm, escaladoEm: desistiuHaDoisMin, agora, temResponsavel: false, statusAtual: 'ativo' })
    ).toBe(true);
  });

  it('escala normalmente quando statusAtual é ativo (ou omitido)', () => {
    const criadoEm = new Date('2024-01-01T12:05:00Z'); // 5 mins atrás (prazo vencido)
    const comStatus = deveEscalar({
      raioKm: 5,
      criadoEm,
      escaladoEm: null,
      agora,
      temResponsavel: false,
      statusAtual: 'ativo',
    });
    expect(comStatus).toBe(true);

    const semStatus = deveEscalar({ raioKm: 5, criadoEm, escaladoEm: null, agora, temResponsavel: false });
    expect(semStatus).toBe(true);
  });
});

describe('ordenarCandidatos', () => {
  const agora = new Date('2024-01-01T12:00:00Z');
  
  it('ordena pelos mais próximos primeiro', () => {
    const candidatos = [
      { id: 1, distanciaKm: 10, ultimaPresenca: new Date('2024-01-01T11:58:00Z') },
      { id: 2, distanciaKm: 5, ultimaPresenca: new Date('2024-01-01T11:58:00Z') },
    ];
    
    const ordenados = ordenarCandidatos(candidatos, agora);
    expect(ordenados[0].id).toBe(2);
  });
  
  it('desempata por presença mais recente', () => {
    const candidatos = [
      { id: 1, distanciaKm: 5, ultimaPresenca: new Date('2024-01-01T11:50:00Z') },  // 10 mins
      { id: 2, distanciaKm: 5, ultimaPresenca: new Date('2024-01-01T11:58:00Z') },  // 2 mins, vence desempate
    ];
    
    const ordenados = ordenarCandidatos(candidatos, agora);
    expect(ordenados[0].id).toBe(2);
  });

  it('filtra presenças muito antigas (maior que JANELA_PRESENCA_MS)', () => {
    const candidatos = [
      { id: 1, distanciaKm: 1, ultimaPresenca: new Date(agora.getTime() - JANELA_PRESENCA_MS + 1000) }, // válido
      { id: 2, distanciaKm: 1, ultimaPresenca: new Date(agora.getTime() - JANELA_PRESENCA_MS - 1000) }, // obsoleto
    ];
    
    const ordenados = ordenarCandidatos(candidatos, agora);
    expect(ordenados.length).toBe(1);
    expect(ordenados[0].id).toBe(1);
  });
});

describe('textoDoAlerta', () => {
  it('informa quando a posição não foi confirmada', () => {
    const txt = textoDoAlerta({ nome: 'João', distanciaKm: 10, spotNome: null, temCoordenada: false });
    expect(txt.titulo).toBe('🆘 SOS — João');
    expect(txt.corpo.toLowerCase()).toContain('posição não confirmada');
  });

  it('inclui a distância e o nome do spot quando disponíveis', () => {
    const txt = textoDoAlerta({ nome: 'Maria', distanciaKm: 5.4, spotNome: 'Cumbuco', temCoordenada: true });
    expect(txt.corpo).toContain('5km');
    expect(txt.corpo).toContain('Cumbuco');
  });

  it('funciona sem bater erro sem o nome do spot', () => {
    const txt = textoDoAlerta({ nome: 'Pedro', distanciaKm: 10, spotNome: null, temCoordenada: true });
    expect(txt.corpo).toContain('10km');
    expect(txt.corpo).not.toContain('null');
  });
});

describe('boundingBox', () => {
  it('gera bounds corretos para coordenadas do Brasil e maiores para raios maiores', () => {
    // Fortaleza
    const lat = -3.7319;
    const lng = -38.5267;
    
    const bb5 = boundingBox(lat, lng, 5);
    const bb50 = boundingBox(lat, lng, 50);
    
    expect(bb5.minLat).toBeLessThan(lat);
    expect(bb5.maxLat).toBeGreaterThan(lat);
    expect(bb5.minLng).toBeLessThan(lng);
    expect(bb5.maxLng).toBeGreaterThan(lng);
    
    // Raio 50km gera caixa maior que raio 5km
    expect(bb50.maxLat - bb50.minLat).toBeGreaterThan(bb5.maxLat - bb5.minLat);
    expect(bb50.maxLng - bb50.minLng).toBeGreaterThan(bb5.maxLng - bb5.minLng);
  });
});
