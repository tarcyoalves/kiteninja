import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
  },
  resolve: {
    alias: {
      // import.meta.dirname: __dirname não existe em ESM e o configLoader nativo
      // do Vite (futuro padrão) não o injeta mais.
      '@': import.meta.dirname,
      // `server-only` só existe para o bundler do Next barrar import de código
      // de servidor no cliente. Fora dele o pacote não resolve, e sem este
      // stub qualquer módulo que o importe fica impossível de testar — o que
      // levaria a duplicar a lógica no teste em vez de testar a real.
      'server-only': `${import.meta.dirname}/test/stub-server-only.ts`,
    },
  },
});
