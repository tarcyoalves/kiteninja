import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Varredura de código-fonte, no mesmo espírito de lib/authz.test.ts: procura um
 * defeito que nenhum teste de comportamento pegaria, porque o código COMPILA e
 * o TypeScript aceita.
 *
 * O BUG QUE ORIGINOU ISTO
 *
 * `app/api/downwind/[id]/posicoes/route.ts` tinha:
 *
 *     VALUES (..., ${registradoEm ?? sql`DEFAULT`})
 *
 * A intenção era óbvia: "se não veio timestamp, usa o DEFAULT da coluna". Só
 * que o driver HTTP do Neon (@neondatabase/serverless) NÃO compõe fragmentos
 * de SQL — diferente de bibliotecas como postgres.js, onde isso funcionaria.
 * O `sql` aninhado é avaliado como um objeto (NeonQueryPromise) e entra como
 * VALOR de parâmetro:
 *
 *     values: [..., { queryData: { strings: ['DEFAULT'], values: [] } }]
 *
 * O Postgres então recusa: "Invalid input for date type". Resultado prático:
 * todo POST de posição SEM `registradoEm` devolvia 500 e nenhuma posição era
 * gravada. Como o app nativo sempre manda o campo e o beacon web nunca manda,
 * o bug quebrava exatamente um dos dois lados — o mais difícil de perceber.
 *
 * A correção é escrever duas queries completas e escolher entre elas em
 * JavaScript, nunca montar SQL por interpolação.
 */

const RAIZ = join(__dirname, '..');
const PASTAS = ['app', 'lib', 'scripts'];

function arquivosDeCodigo(dir: string): string[] {
  const achados: string[] = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name === 'node_modules' || entrada.name === '.next') continue;
      achados.push(...arquivosDeCodigo(caminho));
    } else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
      achados.push(caminho);
    }
  }
  return achados;
}

/**
 * Casa um template `sql` aparecendo DENTRO de uma interpolação `${...}` — que
 * é a assinatura do erro. Um `sql\`...\`` no início de uma expressão (o uso
 * normal, `await sql\`SELECT ...\``) não casa.
 */
const SQL_ANINHADO = /\$\{[^}]*\bsql`/;

/**
 * Linhas de comentário não são código. Precisa existir porque o comentário que
 * explica este próprio bug — no topo da correção em posicoes/route.ts — cita o
 * trecho defeituoso literalmente, e sem esta exceção a varredura acusaria a
 * documentação da correção como se fosse a reincidência dela.
 */
function ehComentario(linha: string): boolean {
  const t = linha.trim();
  return t.startsWith('*') || t.startsWith('//') || t.startsWith('/*');
}

describe('composição de SQL com o driver do Neon', () => {
  const arquivos = PASTAS.flatMap((p) => arquivosDeCodigo(join(RAIZ, p)));

  it('encontra arquivos para varrer (a varredura em si não pode virar no-op)', () => {
    expect(arquivos.length).toBeGreaterThan(50);
  });

  it('nenhum arquivo interpola um template `sql` dentro de outra query', () => {
    const infratores: string[] = [];

    for (const arquivo of arquivos) {
      const linhas = readFileSync(arquivo, 'utf-8').split('\n');
      linhas.forEach((linha, i) => {
        if (!ehComentario(linha) && SQL_ANINHADO.test(linha)) {
          infratores.push(`${arquivo.replace(RAIZ + '/', '')}:${i + 1}  ${linha.trim()}`);
        }
      });
    }

    expect(
      infratores,
      'Fragmento `sql` dentro de ${...} vira VALOR de parâmetro no driver do Neon, ' +
        'não SQL — o Postgres recusa a query em tempo de execução. Escreva duas ' +
        'queries completas e escolha entre elas em JavaScript.\n' +
        infratores.join('\n')
    ).toEqual([]);
  });
});
