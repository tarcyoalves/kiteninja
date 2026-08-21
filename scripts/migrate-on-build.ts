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
 * DESENHO DEFENSIVO — NUNCA DERRUBA O BUILD, em nenhuma circunstância. O
 * ambiente de agente que desenvolve este repo tem acesso de rede bloqueado
 * para o host do Neon (política do ambiente — confirmado tentando conectar:
 * "connect_rejected... policy denial", ver /root/.ccr/README.md), então este
 * script nunca roda de verdade contra produção a partir dali, só é validado
 * localmente contra PGlite (scripts/verify-sql.ts). Se o ambiente de build da
 * Vercel também não conseguir aplicar a migração por qualquer motivo
 * (DATABASE_URL ausente nesta fase, rede indisponível, banco suspenso por
 * inatividade), este script REGISTRA o problema e SAI COM SUCESSO — nunca
 * falha o processo. Travar o deploy inteiro por causa de uma migração que não
 * rodou seria pior que o problema original: uma coluna faltando quebra UMA
 * feature; um build que nunca mais publica quebra o app inteiro para todo
 * mundo. Por ser idempotente, rodar de novo no próximo deploy sozinho
 * "cicatriza" uma falha transitória — sem precisar de ninguém lembrando.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';
import { loadEnv } from './load-env';

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
  // Mesma regra de scripts/migrate.ts: remove comentários de linha antes de
  // dividir por ';'. O schema não usa PL/pgSQL com ';' interno, então este
  // split simples é seguro — não trocar por um bloco DO/BEGIN sem revisar
  // este split também.
  const withoutComments = schema.replace(/^--.*$/gm, '');
  const statements = withoutComments
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let falhas = 0;
  for (const statement of statements) {
    try {
      await sql.query(statement);
    } catch (err) {
      // Por instrução, não pelo script inteiro: uma ALTER que falha não pode
      // impedir as próximas de rodar, e nenhuma delas pode travar o build.
      falhas++;
      console.error(
        '[migrate-on-build] instrução falhou (build continua mesmo assim):',
        statement.split('\n')[0].slice(0, 100)
      );
      console.error(err instanceof Error ? err.message : err);
    }
  }
  console.log(
    `[migrate-on-build] ${statements.length - falhas}/${statements.length} instruções aplicadas.`
  );
}

async function main() {
  loadEnv();
  const url = process.env.DATABASE_URL;
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
  // Última rede de segurança: mesmo um erro que escapou dos catches internos
  // (ex.: `neon(url)` rejeitando por URL malformada) não pode derrubar
  // `next build`. Ver o comentário no topo do arquivo.
  console.error('[migrate-on-build] falha inesperada (build continua mesmo assim):', err);
});
