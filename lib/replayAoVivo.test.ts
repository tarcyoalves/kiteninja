import { describe, expect, it } from 'vitest';
import { podeVerReplayAoVivo } from './downwindAcesso';
import type { MinhaParticipacao } from './downwindAcesso';

/**
 * Trava do mapa ao vivo / replay (`GET /api/downwind/[id]/live`).
 *
 * A rota era pública sem checagem nenhuma: lia `visibilidade`, devolvia o
 * valor no payload e nunca o verificava. Como a coluna nasce `privado` e o
 * modal de criação já vem com `privado` pré-selecionado, na prática TODO
 * downwind tinha nome, avatar e trilha GPS completa acessíveis a quem tivesse
 * o UUID.
 */

const participante: MinhaParticipacao = {
  papel: 'velejador',
  estado: 'navegando',
  ehOrganizador: false,
  apoioUserId: null,
};

describe('podeVerReplayAoVivo', () => {
  it('downwind de comunidade é espectador aberto, inclusive sem sessão', () => {
    expect(
      podeVerReplayAoVivo({ visibilidade: 'comunidade', participacao: null, ehModerador: false })
    ).toBe(true);
  });

  /** A regressão em si. */
  it('downwind privado NÃO abre para visitante sem sessão', () => {
    expect(
      podeVerReplayAoVivo({ visibilidade: 'privado', participacao: null, ehModerador: false })
    ).toBe(false);
  });

  it('downwind privado não abre para usuário logado que não participa', () => {
    // Sem participação é exatamente o que `buscarContexto` devolve para quem
    // tem conta mas não entrou neste downwind.
    expect(
      podeVerReplayAoVivo({ visibilidade: 'privado', participacao: null, ehModerador: false })
    ).toBe(false);
  });

  it('participante vê o próprio downwind privado', () => {
    expect(
      podeVerReplayAoVivo({ visibilidade: 'privado', participacao: participante, ehModerador: false })
    ).toBe(true);
  });

  it('apoio em terra também é participante e vê', () => {
    expect(
      podeVerReplayAoVivo({
        visibilidade: 'privado',
        participacao: { ...participante, papel: 'apoio_terra', estado: 'confirmado' },
        ehModerador: false,
      })
    ).toBe(true);
  });

  it('moderação vê downwind privado sem participar', () => {
    expect(
      podeVerReplayAoVivo({ visibilidade: 'privado', participacao: null, ehModerador: true })
    ).toBe(true);
  });

  /**
   * Quem já encerrou ou desistiu continua tendo direito ao replay da travessia
   * de que participou — sair da água não apaga o histórico próprio. Quem some
   * do mapa AO VIVO é outra regra, tratada por `posicaoVisivel`.
   */
  it.each(['encerrado', 'desistiu'] as const)(
    'participante que saiu (%s) ainda vê o replay',
    (estado) => {
      expect(
        podeVerReplayAoVivo({
          visibilidade: 'privado',
          participacao: { ...participante, estado },
          ehModerador: false,
        })
      ).toBe(true);
    }
  );
});
