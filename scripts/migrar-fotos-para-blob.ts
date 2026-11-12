/**
 * Move as fotos antigas (texto base64 dentro do banco) para o Vercel Blob.
 * Rode na SUA máquina; o agente que escreveu isto nunca teve o banco nem o
 * token. Passo a passo em docs/MIGRAR-FOTOS-PARA-BLOB.md.
 *
 *   npx tsx scripts/migrar-fotos-para-blob.ts              # só conta (dry-run)
 *   npx tsx scripts/migrar-fotos-para-blob.ts --aplicar    # migra de verdade
 *   npx tsx scripts/migrar-fotos-para-blob.ts --aplicar --lote 3
 *
 * Precisa de DATABASE_URL e, para --aplicar, BLOB_READ_WRITE_TOKEN em
 * .env.local (ou exportados no terminal). Nunca imprime nenhum dos dois.
 */
import { neon } from '@neondatabase/serverless';
import { put } from '@vercel/blob';
import { loadEnv } from './load-env';
import { migrarFotos, type SqlTag } from '../lib/migrarFotosParaBlob';

loadEnv();

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes('--aplicar');
  const iLote = args.indexOf('--lote');
  const lote = iLote >= 0 ? Number(args[iLote + 1]) : 5;

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ERRO: DATABASE_URL não definida. Preencha .env.local.');
    process.exit(1);
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (aplicar && !token) {
    console.error('ERRO: para --aplicar é preciso BLOB_READ_WRITE_TOKEN (veja docs/MIGRAR-FOTOS-PARA-BLOB.md).');
    process.exit(1);
  }

  console.log(aplicar ? 'MODO: APLICAR (vai subir fotos e trocar no banco)' : 'MODO: DRY-RUN (só conta; nada é alterado)');

  const resumos = await migrarFotos({
    sql: neon(url) as unknown as SqlTag,
    aplicar,
    tamanhoLote: lote,
    log: (m) => console.log(m),
    subir: async (pathname, corpo, contentType) => {
      const r = await put(pathname, corpo, {
        access: 'public',
        contentType,
        token,
        // Nome fixo (pelo id da linha) + sobrescrita: se o script cair depois
        // do upload e antes de gravar no banco, rodar de novo não deixa
        // arquivo duplicado no Blob.
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return r.url;
    },
  });

  const total = resumos.reduce((a, r) => a + r.pendentes, 0);
  const mb = resumos.reduce((a, r) => a + r.bytes, 0) / 1024 / 1024;
  console.log('\nRESUMO');
  for (const r of resumos) {
    console.log(
      `  ${r.tabela}: ${r.pendentes} pendente(s)` +
        (aplicar ? `, ${r.migradas} migrada(s), ${r.falhas} falha(s), ${r.ignoradas} ignorada(s)` : '')
    );
  }
  console.log(`  TOTAL: ${total} foto(s), ${mb.toFixed(1)} MB de texto no banco`);
  if (!aplicar) console.log('\nNada foi alterado. Para migrar de verdade, rode de novo com --aplicar.');
  if (aplicar && resumos.some((r) => r.falhas > 0)) {
    console.log('\nHouve falhas: as linhas afetadas continuam intactas. Rode de novo para tentar outra vez.');
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e);
  process.exit(1);
});
