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

  it('nunca escala um SOS já em_atendimento, mesmo com temResponsavel false e prazo vencido', () => {
    // Cenário real: alguém confirmou "a caminho" (status virou em_atendimento),
    // depois mudou para "não posso" — temResponsavel volta a false, mas o
    // alerta não pode voltar a escalar por causa disso (bug já visto em produção).
    const criadoEm = new Date('2024-01-01T12:00:00Z'); // 10 mins atrás, prazo vencido
    const result = deveEscalar({
      raioKm: 5,
      criadoEm,
      escaladoEm: null,
      agora,
      temResponsavel: false,
      statusAtual: 'em_atendimento',
    });
    expect(result).toBe(false);
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
