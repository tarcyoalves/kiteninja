// Separador mínimo de instruções PostgreSQL para os scripts de migração.
//
// Um `schema.split(';')` quebra blocos PL/pgSQL (`DO $$ ... ; ... $$`) e também
// qualquer texto/identificador que contenha ponto-e-vírgula. Este scanner só
// considera `;` como separador quando está fora de strings, identificadores,
// comentários e dollar-quotes (`$$` ou `$tag$`). Não tenta interpretar SQL: ele
// apenas preserva os contextos lexicais necessários para dividir com segurança.
export function splitSqlStatements(source: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  let state: 'normal' | 'single' | 'double' | 'line-comment' | 'block-comment' | 'dollar' = 'normal';
  let dollarTag = '';
  let blockDepth = 0;

  const finish = () => {
    const statement = current.trim();
    if (statement) statements.push(statement);
    current = '';
  };

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (state === 'line-comment') {
      if (char === '\n') {
        state = 'normal';
        current += char;
      }
      i++;
      continue;
    }

    if (state === 'block-comment') {
      if (char === '/' && next === '*') {
        blockDepth++;
        i += 2;
        continue;
      }
      if (char === '*' && next === '/') {
        blockDepth--;
        i += 2;
        if (blockDepth === 0) state = 'normal';
        continue;
      }
      i++;
      continue;
    }

    if (state === 'single') {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        i += 2;
        continue;
      }
      if (char === "'") state = 'normal';
      i++;
      continue;
    }

    if (state === 'double') {
      current += char;
      if (char === '"' && next === '"') {
        current += next;
        i += 2;
        continue;
      }
      if (char === '"') state = 'normal';
      i++;
      continue;
    }

    if (state === 'dollar') {
      if (source.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length;
        state = 'normal';
      } else {
        current += char;
        i++;
      }
      continue;
    }

    // Estado normal.
    if (char === '-' && next === '-') {
      // Comentário separa tokens como whitespace (`SELECT/*x*/1` => SELECT 1).
      if (current && !/\s$/.test(current)) current += ' ';
      state = 'line-comment';
      i += 2;
      continue;
    }
    if (char === '/' && next === '*') {
      if (current && !/\s$/.test(current)) current += ' ';
      state = 'block-comment';
      blockDepth = 1;
      i += 2;
      continue;
    }
    if (char === "'") {
      state = 'single';
      current += char;
      i++;
      continue;
    }
    if (char === '"') {
      state = 'double';
      current += char;
      i++;
      continue;
    }
    if (char === '$') {
      const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(source.slice(i));
      if (match) {
        dollarTag = match[0];
        state = 'dollar';
        current += dollarTag;
        i += dollarTag.length;
        continue;
      }
    }
    if (char === ';') {
      finish();
      i++;
      continue;
    }

    current += char;
    i++;
  }

  finish();
  return statements;
}
