/**
 * Regra ÚNICA de tamanho de senha — servidor e telas leem daqui.
 *
 * Existe porque as duas divergiram: o servidor (lib/validation.ts) exigia 10
 * caracteres e a página do link de redefinição dizia "mínimo 6", com
 * `minLength={6}` no campo. Quem seguia a instrução da própria tela recebia
 * "A senha precisa ter no mínimo 10 caracteres" — reproduzido no cenário A
 * de lib/redefinirSenhaFluxo.test.ts. Duas regras para a mesma coisa
 * divergem; uma só não tem como.
 *
 * Sem `server-only` e sem dependência nenhuma de propósito: componentes de
 * cliente importam este arquivo.
 */
export const SENHA_MINIMA = 10;
export const SENHA_MAXIMA = 200;
export const MSG_SENHA_CURTA = `A senha precisa ter no mínimo ${SENHA_MINIMA} caracteres.`;
