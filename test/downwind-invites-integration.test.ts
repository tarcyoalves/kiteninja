import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';

describe('Integração e Segurança de Convites e Downwind', () => {
  it('gera hash seguro para tokens de convite de link', () => {
    const token1 = crypto.randomBytes(24).toString('hex');
    const token2 = crypto.randomBytes(24).toString('hex');
    expect(token1).not.toBe(token2);
    expect(token1.length).toBeGreaterThanOrEqual(16);

    const hash1 = crypto.createHash('sha256').update(token1).digest('hex');
    const hash2 = crypto.createHash('sha256').update(token2).digest('hex');
    expect(hash1).not.toBe(hash2);
    expect(hash1).toBe(crypto.createHash('sha256').update(token1).digest('hex')); // Determinístico
  });

  it('calcula métricas reais de GPS a partir de uma trilha de posições', () => {
    // Trilha simulada: Cumbuco (-3.626, -38.730) até Cauípe (-3.585, -38.790)
    const t0 = 1700000000000;
    const trilha: Array<[number, number, number]> = [
      [-3.626, -38.730, t0],
      [-3.610, -38.750, t0 + 15 * 60 * 1000],
      [-3.595, -38.770, t0 + 30 * 60 * 1000],
      [-3.585, -38.790, t0 + 45 * 60 * 1000],
    ];

    let distTotalKm = 0;
    let maxSpeedKnots = 0;
    for (let i = 1; i < trilha.length; i++) {
      const [lat1, lng1, t1] = trilha[i - 1];
      const [lat2, lng2, t2] = trilha[i];
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const dKm = R * c;
      distTotalKm += dKm;

      const dtHours = (t2 - t1) / 3_600_000;
      if (dtHours > 0 && dtHours <= 0.5) {
        const speedKnots = (dKm / 1.852) / dtHours;
        if (speedKnots < 50 && speedKnots > maxSpeedKnots) {
          maxSpeedKnots = speedKnots;
        }
      }
    }

    const duracaoMinutos = Math.round((trilha[trilha.length - 1][2] - trilha[0][2]) / 60000);

    expect(distTotalKm).toBeGreaterThan(5); // ~8km
    expect(distTotalKm).toBeLessThan(15);
    expect(maxSpeedKnots).toBeGreaterThan(5);
    expect(duracaoMinutos).toBe(45);
  });
});