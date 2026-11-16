import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Comentários fora: explicar o bug num comentário não é consertá-lo. */
const semComentarios = (texto: string) =>
  texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*$/, ''))
    .join('\n');

/**
 * Guarda: o botão de "redefinir senha" do painel admin precisa redefinir a
 * senha de verdade.
 *
 * O QUE ACONTECEU: o dono clicou em redefinir a senha de um velejador que
 * havia esquecido a dele. O botão só ligava `must_change_password`, que
 * EXIGE a troca no próximo login — e a pessoa não conseguia chegar ao próximo
 * login, porque continuava batendo em "credencial inválida". O reset não
 * mexia na senha em momento nenhum.
 *
 * O caminho de autoatendimento também não fecha sozinho: a rota de
 * `recover-password` gera o token, mas não existe envio de e-mail no
 * projeto — o token é criado e nunca chega a ninguém. Por isso o admin
 * precisa conseguir gerar e entregar o link com a própria mão.
 */
describe('redefinição de senha pelo admin', () => {
  const rota = () =>
    semComentarios(readFileSync('app/api/admin/users/[id]/senha/route.ts', 'utf8'));
  const painel = () => semComentarios(readFileSync('app/admin/UserManager.tsx', 'utf8'));

  it('a rota existe, é só de admin e gera um token de recuperação', () => {
    const src = rota();
    expect(src).toContain('requireAdmin');
    expect(src).toContain('createPasswordResetToken');
    expect(src).toMatch(/export async function POST/);
  });

  it('devolve o link pronto para colar, não o token cru', () => {
    // O admin vai mandar isto por WhatsApp: um token solto não vira nada.
    expect(rota()).toContain('/recuperar-senha/');
  });

  it('derruba as sessões abertas do velejador', () => {
    // Se a pessoa perdeu o acesso, sessão viva em outro aparelho é justamente
    // o que não deveria seguir de pé.
    expect(rota()).toContain('invalidateAllUserSessions');
  });

  it('recusa conta suspensa com motivo, em vez de erro genérico', () => {
    const src = rota();
    expect(src).toContain('is_active');
    expect(src).toContain('suspensa');
  });

  it('o painel chama a rota de redefinição, e não só o must_change_password', () => {
    const src = painel();
    expect(src).toContain('/senha');
    // Não basta a função existir no arquivo: ela tem que estar LIGADA a um
    // clique. A primeira versão deste teste passava com o botão desligado,
    // porque a declaração da função sozinha já casava com o nome.
    expect(src).toMatch(/onClick=\{\(\) => gerarLinkSenha\(/);
  });

  it('o painel mostra o link gerado para o admin copiar', () => {
    const src = painel();
    expect(src).toContain('linkSenha');
    expect(src).toMatch(/clipboard\.writeText/);
  });

  it('o botão "Exigir troca" não volta: no lugar dele, a senha provisória', () => {
    // A versão anterior desta trava exigia o botão "Exigir troca" com um aviso
    // no `title` ("não serve para quem esqueceu a senha"). Não bastou: no
    // celular não há `title` visível, e o dono seguiu usando o botão para
    // redefinir senha — "só dá senha errada" (16/11/2026). O botão saiu; a
    // senha provisória (com troca obrigatória) ocupa o lugar dele.
    // Comportamento coberto pelas rotas em lib/senhaProvisoriaFluxo.test.ts.
    const src = painel();
    expect(src).not.toMatch(/\{\s*mustChangePassword:\s*true\s*\}/);
    expect(src).not.toContain('Exigir troca');
    expect(src).toContain('/senha-provisoria');
    expect(src).toContain('Senha provisória');
  });
});
