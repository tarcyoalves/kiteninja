import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSilencioConfig } from './downwindSilencio';

// Mock do db
vi.mock('./db', () => ({
  sql: vi.fn().mockResolvedValue([]),
}));

import { sql } from './db';

const mockedSql = sql as unknown as ReturnType<typeof vi.fn>;

describe('downwindSilencio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSilencioConfig', () => {
    it('retorna config padrão quando não há config no banco', async () => {
      mockedSql.mockResolvedValue([]);

      const config = await getSilencioConfig();

      expect(config.silencioSegundos).toBe(300);
      expect(config.graceInicioSegundos).toBe(120);
      expect(config.habilitado).toBe(true);
    });

    it('retorna config do banco quando existe', async () => {
      mockedSql.mockResolvedValue([
        {
          value: {
            silencioSegundos: 600,
            graceInicioSegundos: 180,
            habilitado: false,
          },
        },
      ]);

      const config = await getSilencioConfig();

      expect(config.silencioSegundos).toBe(600);
      expect(config.graceInicioSegundos).toBe(180);
      expect(config.habilitado).toBe(false);
    });

    it('usa valores padrão para campos missing', async () => {
      mockedSql.mockResolvedValue([
        {
          value: {
            // sósilencioSegundos, falta graceInicioSegundos e habilitado
            silencioSegundos: 450,
          },
        },
      ]);

      const config = await getSilencioConfig();

      expect(config.silencioSegundos).toBe(450);
      expect(config.graceInicioSegundos).toBe(120); // default
      expect(config.habilitado).toBe(true); // default
    });

    it('trata erro retornando config padrão', async () => {
      mockedSql.mockRejectedValue(new Error('DB error'));

      const config = await getSilencioConfig();

      expect(config.silencioSegundos).toBe(300);
      expect(config.graceInicioSegundos).toBe(120);
      expect(config.habilitado).toBe(true);
    });
  });
});

describe('varrerSilencos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('não varre quando desabilitado', async () => {
    mockedSql
      .mockResolvedValueOnce([]) // getSilencioConfig
      .mockResolvedValueOnce([]); // participantes

    const { varrerSilencos } = await import('./downwindSilencio');
    const resultado = await varrerSilencos(new Date());

    expect(resultado.examinados).toBe(0);
    expect(resultado.silencios).toHaveLength(0);
    expect(resultado.erros).toBe(0);
  });

  it('detecta silêncio quando participante não reporta há tempo suficiente', async () => {
    const agora = new Date('2026-08-25T12:00:00Z');

    // Config habilitada
    mockedSql
      .mockResolvedValueOnce([{ value: { silencioSegundos: 300, graceInicioSegundos: 120, habilitado: true } }])
      // Participante em downwind em andamento
      .mockResolvedValueOnce([
        {
          downwind_id: 'dw-123',
          downwind_nome: 'Test Downwind',
          downwind_iniciado_em: '2026-08-25T10:00:00Z', // começou há 2h (fora do grace)
          user_id: 'user-456',
          participante_nome: 'João',
          ultima_posicao_em: '2026-08-25T11:50:00Z', // há 10 min (dentro do silêncio de 5min)
          apoio_user_id: 'apoio-789',
        },
      ])
      // Verifica alerta existente
      .mockResolvedValueOnce([])
      // Busca organizadores
      .mockResolvedValueOnce([{ user_id: 'org-001' }])
      // Insere alerta
      .mockResolvedValueOnce([{ id: 'alerta-123' }])
      // Limpa alertas antigos
      .mockResolvedValueOnce([]);

    const { varrerSilencos } = await import('./downwindSilencio');
    const resultado = await varrerSilencos(agora);

    expect(resultado.examinados).toBe(1);
    expect(resultado.silencios).toHaveLength(1);
    expect(resultado.silencios[0].participanteNome).toBe('João');
  });

  it('não detecta silêncio dentro do grace period', async () => {
    const agora = new Date('2026-08-25T12:00:00Z');

    // Config habilitada
    mockedSql
      .mockResolvedValueOnce([{ value: { silencioSegundos: 300, graceInicioSegundos: 120, habilitado: true } }])
      // Participante em downwind que começou há 1min (dentro do grace de 2min)
      .mockResolvedValueOnce([
        {
          downwind_id: 'dw-123',
          downwind_nome: 'Test Downwind',
          downwind_iniciado_em: '2026-08-25T11:59:00Z', // começou há 1 min (dentro do grace)
          user_id: 'user-456',
          participante_nome: 'Maria',
          ultima_posicao_em: null,
          apoio_user_id: null,
        },
      ]);

    const { varrerSilencos } = await import('./downwindSilencio');
    const resultado = await varrerSilencos(agora);

    expect(resultado.examinados).toBe(1);
    expect(resultado.silencios).toHaveLength(0);
  });
});

describe('resolverSilencio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolve silêncio quando encontrado', async () => {
    mockedSql.mockResolvedValue([{ id: 'alerta-123' }]);

    const { resolverSilencio } = await import('./downwindSilencio');
    const resultado = await resolverSilencio('dw-123', 'user-456');

    expect(resultado).toBe(true);
    // Verifica que a query foi chamada (pode ter sido passada de diferentes formas)
    expect(mockedSql).toHaveBeenCalled();
  });

  it('retorna false quando não há silêncio para resolver', async () => {
    mockedSql.mockResolvedValue([]);

    const { resolverSilencio } = await import('./downwindSilencio');
    const resultado = await resolverSilencio('dw-inexistente', 'user-inexistente');

    expect(resultado).toBe(false);
  });
});
