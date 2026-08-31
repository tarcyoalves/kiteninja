import { describe, expect, it } from 'vitest';
import { precisaInstalarParaPush, type AmbienteInstalacao } from './instalacaoIos';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36';

const base: AmbienteInstalacao = {
  ehAppNativo: false,
  userAgent: IPHONE_SAFARI,
  standalone: false,
  displayModeStandalone: false,
};

describe('precisaInstalarParaPush', () => {
  it('avisa no iPhone dentro do Safari comum', () => {
    expect(precisaInstalarParaPush(base)).toBe(true);
  });

  it('não avisa quando o iPhone já tem o app na tela de início', () => {
    expect(precisaInstalarParaPush({ ...base, standalone: true })).toBe(false);
    expect(precisaInstalarParaPush({ ...base, displayModeStandalone: true })).toBe(false);
  });

  /**
   * Regressão que a mensagem causaria se a checagem fosse só "não está
   * instalado": Android entrega push no Chrome normal, e mandar o velejador
   * instalar um app que ele já pode usar seria uma instrução errada.
   */
  it('nunca avisa fora do iOS', () => {
    expect(precisaInstalarParaPush({ ...base, userAgent: ANDROID_CHROME })).toBe(false);
    expect(precisaInstalarParaPush({ ...base, userAgent: '' })).toBe(false);
  });

  it('nunca avisa dentro do app nativo — lá o push vem pelo FCM', () => {
    expect(precisaInstalarParaPush({ ...base, ehAppNativo: true })).toBe(false);
  });
});
