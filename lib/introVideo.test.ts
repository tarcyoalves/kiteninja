import { describe, it, expect } from 'vitest';
import { parseIntroVideo } from './introVideo';

/**
 * `app_settings` guarda JSONB editável pelo admin, e o valor governa a primeira
 * tela do app. Um registro malformado não pode derrubar a abertura nem virar
 * canal de injeção, então a validação é testada isoladamente do banco.
 */
describe('parseIntroVideo', () => {
  const valido = {
    url: 'https://blob.vercel-storage.com/intro/abertura-1.mp4',
    inicioSeg: 2,
    fimSeg: 8,
    ativo: true,
  };

  it('aceita um registro bem formado', () => {
    const v = parseIntroVideo(valido);
    expect(v).not.toBeNull();
    expect(v?.url).toBe(valido.url);
    expect(v?.inicioSeg).toBe(2);
    expect(v?.fimSeg).toBe(8);
  });

  it('rejeita valores que não são objeto', () => {
    for (const raw of [null, undefined, 'texto', 42, true, []]) {
      expect(parseIntroVideo(raw as unknown)).toBeNull();
    }
  });

  it('rejeita URL ausente ou vazia', () => {
    expect(parseIntroVideo({ ...valido, url: '' })).toBeNull();
    expect(parseIntroVideo({ ...valido, url: undefined })).toBeNull();
    expect(parseIntroVideo({ ...valido, url: 123 })).toBeNull();
  });

  it('aceita apenas https, barrando esquemas executáveis', () => {
    // A abertura roda antes do login: um javascript: aqui seria execução
    // arbitrária na primeira tela, sem nenhuma barreira de sessão.
    expect(parseIntroVideo({ ...valido, url: 'javascript:alert(1)' })).toBeNull();
    expect(parseIntroVideo({ ...valido, url: 'data:video/mp4;base64,AAAA' })).toBeNull();
    expect(parseIntroVideo({ ...valido, url: 'http://sem-tls.example/v.mp4' })).toBeNull();
    expect(parseIntroVideo({ ...valido, url: 'file:///etc/passwd' })).toBeNull();
  });

  it('trata ativo:false como ausência de vídeo', () => {
    // Desligar no painel deve cair na animação vetorial, não tocar escondido.
    expect(parseIntroVideo({ ...valido, ativo: false })).toBeNull();
  });

  it('considera ativo quando o campo não está presente', () => {
    const { ativo: _ativo, ...semAtivo } = valido;
    expect(parseIntroVideo(semAtivo)).not.toBeNull();
  });

  it('rejeita trecho incoerente', () => {
    expect(parseIntroVideo({ ...valido, inicioSeg: 5, fimSeg: 5 })).toBeNull();
    expect(parseIntroVideo({ ...valido, inicioSeg: 9, fimSeg: 3 })).toBeNull();
    expect(parseIntroVideo({ ...valido, inicioSeg: -1 })).toBeNull();
  });

  it('rejeita números não finitos', () => {
    expect(parseIntroVideo({ ...valido, inicioSeg: NaN })).toBeNull();
    expect(parseIntroVideo({ ...valido, fimSeg: Infinity })).toBeNull();
    expect(parseIntroVideo({ ...valido, fimSeg: 'oito' })).toBeNull();
  });

  it('descarta poster que não seja imagem embutida', () => {
    const comScript = parseIntroVideo({
      ...valido,
      posterDataUrl: 'javascript:alert(1)',
    });
    expect(comScript?.posterDataUrl).toBeUndefined();

    const comImagem = parseIntroVideo({
      ...valido,
      posterDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
    });
    expect(comImagem?.posterDataUrl).toBe('data:image/jpeg;base64,/9j/4AAQ');
  });

  it('ignora campos opcionais com tipo errado em vez de falhar', () => {
    // Metadado cosmético quebrado não justifica derrubar a abertura toda.
    const v = parseIntroVideo({ ...valido, nomeArquivo: 99, duracaoSeg: 'longo' });
    expect(v).not.toBeNull();
    expect(v?.nomeArquivo).toBeUndefined();
    expect(v?.duracaoSeg).toBeUndefined();
  });

  it('preserva duracaoSeg numérica para o editor reabrir no lugar certo', () => {
    const v = parseIntroVideo({ ...valido, duracaoSeg: 19.05 });
    expect(v?.duracaoSeg).toBeCloseTo(19.05, 2);
  });
});
