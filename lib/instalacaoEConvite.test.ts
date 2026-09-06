import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Comentários fora: citar um endereço num comentário não é redirecionar. */
const semComentarios = (texto: string) =>
  texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*$/, ''))
    .join('\n');

/**
 * Guarda: o botão de baixar o app nunca mais joga ninguém num 404.
 *
 * O QUE ACONTECEU: sem `ANDROID_APK_URL` configurada, a rota caía num endereço
 * fixo de release do GitHub. O repositório é privado e não há release nenhuma
 * publicada, então o usuário via o 404 do GitHub — com o caminho do
 * repositório à mostra. Foi relatado com print.
 *
 * O erro de fundo não foi o endereço: foi redirecionar para um lugar que
 * ninguém confirmou existir. Um palpite embutido em código vira promessa para
 * o usuário, e quando falha a culpa parece do app.
 */
describe('download do Android não promete o que não existe', () => {
  const rota = () => semComentarios(readFileSync('app/api/download/android/route.ts', 'utf8'));

  it('não tem endereço de release chutado no código', () => {
    const src = rota();
    expect(src).not.toContain('github.com');
    expect(src).not.toContain('releases/latest');
  });

  it('sem APK configurado, leva para a página que ensina a instalar', () => {
    expect(rota()).toContain('/instalar-android');
  });

  it('só redireciona para fora com http(s) — nada de javascript: ou data:', () => {
    // A rota é pública: uma variável mal preenchida viraria redirecionamento
    // aberto a partir de um endpoint que qualquer um chama.
    const src = rota();
    expect(src).toContain("'https:'");
    expect(src).toContain("'http:'");
  });

  it('a página de instalação existe de verdade', () => {
    expect(() => readFileSync('app/instalar-android/page.tsx', 'utf8')).not.toThrow();
  });
});

/**
 * Guarda: quem entra por convite é recebido, não largado na home.
 *
 * Cair direto na `/` põe quem acabou de criar a conta na mesma tela de quem
 * usa o app há meses — sete abas, mapa, feed, e nada dizendo por onde começar.
 */
describe('convite aceito leva à recepção', () => {
  it('o formulário de convite manda para /bem-vindo', () => {
    const src = semComentarios(readFileSync('app/convite/[token]/AcceptInviteForm.tsx', 'utf8'));
    expect(src).toContain("router.push('/bem-vindo')");
  });

  it('a página de boas-vindas existe', () => {
    expect(() => readFileSync('app/bem-vindo/page.tsx', 'utf8')).not.toThrow();
  });

  it('o nome vem da sessão, nunca da URL', () => {
    /*
     * `?nome=` seria texto de terceiro exibido em letra grande numa página de
     * boas-vindas: qualquer um poderia mandar um link com o nome que quisesse.
     */
    const src = semComentarios(readFileSync('app/bem-vindo/page.tsx', 'utf8'));
    expect(src).toContain('getSessionUser');
    expect(src).not.toContain('searchParams');
  });
});
