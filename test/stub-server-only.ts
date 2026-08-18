/**
 * Stub de `server-only` para os testes.
 *
 * No Next, importar `server-only` faz o bundler falhar se o módulo acabar num
 * componente de cliente. Sob vitest não há bundler, o pacote não resolve, e o
 * import derrubaria a suíte inteira. Um módulo vazio mantém a proteção onde ela
 * age (no build) e permite testar o código real, em vez de recopiá-lo no teste.
 */
export {};
