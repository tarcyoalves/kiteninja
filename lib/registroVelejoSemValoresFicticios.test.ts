/**
 * O formulário "Registrar Velejo" não pode nascer com medições inventadas.
 *
 * Ele abria com vento 20 nós, rajada 26, 28,4 km, 50 km/h e salto de 9,2 m.
 * Quem registrava um velejo à mão sem apagar esses campos publicava no feed e
 * no ranking uma sessão que não aconteceu. Não há infraestrutura de teste de
 * componente no projeto (sem jsdom), então a trava lê o código-fonte: cada
 * medição começa vazia e volta a vazio depois de salvar.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const fonte = readFileSync(join(__dirname, '..', 'components', 'SessionLoggerModal.tsx'), 'utf-8');

const MEDICOES = [
  ['avgWindKnots', 'setAvgWindKnots'],
  ['maxGustKnots', 'setMaxGustKnots'],
  ['distanceKm', 'setDistanceKm'],
  ['maxSpeedKmh', 'setMaxSpeedKmh'],
  ['highestJumpM', 'setHighestJumpM'],
] as const;

describe('Registrar Velejo — medições começam vazias', () => {
  it.each(MEDICOES)('%s nasce vazio', (campo, setter) => {
    const decl = new RegExp(`const \\[${campo}, ${setter}\\] = useState(?:<[^>]*>)?\\(([^)]*)\\);`);
    const m = decl.exec(fonte);
    expect(m, `declaração de ${campo} não encontrada`).not.toBeNull();
    expect(m![1].trim()).toBe("''");
  });

  it.each(MEDICOES)('%s nunca recebe um número literal (nem ao limpar depois de salvar)', (_campo, setter) => {
    const literais = fonte.match(new RegExp(`\\b${setter}\\(\\s*-?\\d`, 'g')) ?? [];
    expect(literais).toEqual([]);
  });

  it('vento médio continua obrigatório (a coluna é NOT NULL): envio sem ele mostra erro', () => {
    expect(fonte).toMatch(/if \(avgWindKnots === ''\) \{\s*setSaveError\(/);
  });
});
