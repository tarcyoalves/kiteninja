import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
  },
  resolve: {
    // import.meta.dirname: __dirname não existe em ESM e o configLoader nativo
    // do Vite (futuro padrão) não o injeta mais.
    alias: { '@': import.meta.dirname },
  },
});
