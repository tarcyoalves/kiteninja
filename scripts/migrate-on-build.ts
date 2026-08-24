/**
 * Migração automática, rodada pelo PRÓPRIO PIPELINE DE BUILD da Vercel a cada
 * deploy — não por um humano lembrando de rodar `npm run migrate` à parte.
 *
 * POR QUE ISTO EXISTE: docs/PENDENCIAS-20-08-2026.md documenta o incidente de
 * 20/08 — um deploy que dependia de `height_cm` foi ao ar sem a coluna existir
 * em produção, e o dono ficou trancado fora do próprio app até rodar o SQL à
 * mão no Neon. O próprio postmortem sugere a correção estrutural: "considerar
 * adicionar a migração ao pipeline de deploy (build step da Vercel) para este
 * tipo de esquecimento parar de ser possível." É isto aqui.
 *
 * DESENHO DEFENSIVO — DATABASE_URL ausente faz a etapa ser pulada (ambientes
 * de análise e builds sem banco continuam funcionando). Porém, se uma URL foi
 * fornecida e uma instrução falhar, o build FALHA: publicar código que depende
 * de coluna/constraint ausente repete exatamente o incidente que este script
 * existe para prevenir. O schema é idempotente, então uma falha transitória
 * pode ser retentada no próximo build sem desfazer dados.
 *
 * Para migração, prefere DATABASE_URL_UNPOOLED (conexão direta). A aplicação
 * continua usando DATABASE_URL pooled no runtime serverless.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { loadEnv } from './load-env';
import { splitSqlStatements } from '../lib/splitSqlStatements';

/**
 * Sem tipar o parâmetro como `ReturnType<typeof neon>`: os genéricos default
 * de `NeonQueryFunction` (`ArrayMode`/`FullResults`) divergem entre a
 * instância criada com `neon(url)` no `main()` e a inferida aqui como tipo de
 * parâmetro solto, e o `tsc` do build rejeita a chamada por isso — sintoma
 * só aparece no `next build` (que type-checa), não no editor. `Awaited<...>`
 * sobre uma chamada real ao construtor evita o descompasso.
 */
type SqlClient = ReturnType<typeof neon<false, false>>;

async function dedupDownwindEventId(sql: SqlClient): Promise<void> {
  /**
   * `ux_downwinds_event` (UNIQUE parcial em `downwinds.event_id`) trava "um
   * evento tem no máximo um downwind". Dado anterior à constraint pode ter
   * duplicata — de uma retentativa de criação de evento antes do rollback
   * manual existir (commit 30eb6f8) — e `CREATE UNIQUE INDEX` abaixo falharia
   * nesse caso, travando essa instrução específica (não o build inteiro, ver
   * o catch por instrução mais abaixo, mas ainda assim deixaria a constraint
   * sem existir para sempre sem alguém notar).
   *
   * Resolve sozinho, SEM APAGAR NADA: para cada `event_id` duplicado, mantém
   * o downwind mais ANTIGO (o mais provável de ser o original — duplicata
   * nasce de uma retentativa POSTERIOR a uma falha, não anterior) e desvincula
   * os demais (`event_id = NULL`). Eles continuam existindo no banco, só
   * perdem o vínculo com aquele evento.
   */
  try {
    const duplicados = await sql`
      SELECT event_id, array_agg(id ORDER BY criado_em ASC) AS ids
      FROM downwinds
      WHERE event_id IS NOT NULL
      GROUP BY event_id
      HAVING COUNT(*) > 1
    `;
    for (const row of duplicados) {
      const ids = (row as Record<string, unknown>).ids as string[];
      const [manter, ...descartar] = ids;
      console.warn(
        `[migrate-on-build] event_id duplicado: mantendo downwind ${manter}, desvinculando ${descartar.length} outro(s) do evento`
      );
      await sql`UPDATE downwinds SET event_id = NULL WHERE id = ANY(${descartar})`;
    }
  } catch (err) {
    // Tabela pode não existir ainda (base nova) — o schema abaixo cria. Falha
    // aqui é sempre não-fatal: melhor tentar criar o índice e deixar ele
    // reportar o próprio erro do que travar a checagem preventiva.
    console.warn(
      '[migrate-on-build] checagem de duplicata de event_id não rodou (não bloqueia o resto):',
      err instanceof Error ? err.message : err
    );
  }
}

async function aplicarSchema(sql: SqlClient): Promise<void> {
  const schema = readFileSync(join(process.cwd(), 'lib', 'schema.sql'), 'utf8');
  // O schema contém blocos PL/pgSQL `DO $$ ... $$`; o separador respeita
  // dollar-quotes, strings e comentários. O split antigo por `;` quebrava esses
  // blocos em várias queries inválidas e mesmo assim anunciava "concluído".
  const statements = splitSqlStatements(schema);

  const failures: Array<{ statement: string; message: string }> = [];
  for (const statement of statements) {
    try {
      await sql.query(statement);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ statement: statement.split('\n')[0].slice(0, 100), message });
      console.error('[migrate-on-build] instrução falhou:', statement.split('\n')[0].slice(0, 100));
      console.error(message);
    }
  }
  console.log(
    `[migrate-on-build] ${statements.length - failures.length}/${statements.length} instruções aplicadas.`
  );
  if (failures.length > 0) {
    throw new Error(`Migração incompleta: ${failures.length} instrução(ões) falharam.`);
  }
}

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.warn(
      '[migrate-on-build] DATABASE_URL ausente nesta fase de build — pulando migração automática.'
    );
    return;
  }

  const sql = neon(url);
  await dedupDownwindEventId(sql);
  await aplicarSchema(sql);
  console.log('[migrate-on-build] concluído.');
}

main().catch((err) => {
  console.error('[migrate-on-build] falha: deploy bloqueado para não publicar schema incompleto.');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
