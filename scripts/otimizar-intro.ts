/**
 * Sobe versões otimizadas dos vídeos de abertura e reaponta a config.
 *
 * Os arquivos originais eram .mov (QuickTime) SEM faststart: o átomo `moov`
 * (o índice) ficava no fim do arquivo, então o Safari precisava baixar quase
 * os 3,6MB inteiros antes de exibir o primeiro quadro — era isso que fazia a
 * abertura demorar, não a API (que responde em 0,4s).
 *
 * A conversão (feita com ffmpeg antes deste script) resolve três coisas:
 *   1. `-movflags +faststart` move o `moov` para o início → 1o quadro imediato.
 *   2. Recorta só o trecho usado → não baixa segundos que ninguém vê, e mata o
 *      seek em arquivo sem índice (que era o pior caso, no vídeo que começa em 7,6s).
 *   3. H.264/MP4 em 720p → ~50% menos bytes, e é o formato que todo navegador toca.
 *
 * Como o arquivo já contém apenas o trecho, inicioSeg passa a 0 e fimSeg à
 * duração real — o player não precisa mais fazer seek nenhum.
 *
 * Uso: npx tsx scripts/otimizar-intro.ts <arquivo1.mp4> <arquivo2.mp4> ...
 * A ordem dos arquivos deve seguir a ordem dos vídeos na config.
 */
import { readFileSync } from 'node:fs';
import { loadEnv } from './load-env';

// Precisa vir antes de importar lib/db (que valida DATABASE_URL na carga).
loadEnv();

const { put } = await import('@vercel/blob');
const { sql } = await import('../lib/db');
// Lemos a config por SQL direto em vez de lib/settings.ts: aquele módulo é
// marcado 'server-only' e não resolve fora do runtime do Next.
import { INTRO_VIDEO_KEY, parseIntroVideoConfig, type IntroVideo } from '../lib/introVideo';

async function getIntroVideoConfig() {
  const rows = await sql`
    SELECT value FROM app_settings WHERE key = ${INTRO_VIDEO_KEY} LIMIT 1
  `;
  if (rows.length === 0) return { modo: 'rodizio' as const, videos: [] as IntroVideo[] };
  return parseIntroVideoConfig(rows[0].value);
}

async function main() {
  const arquivos = process.argv.slice(2);
  if (arquivos.length === 0) {
    console.error('Uso: npx tsx scripts/otimizar-intro.ts <arquivo.mp4> [...]');
    process.exit(1);
  }

  const config = await getIntroVideoConfig();
  if (config.videos.length === 0) {
    console.error('Nenhum vídeo na config — nada a otimizar.');
    process.exit(1);
  }
  if (arquivos.length !== config.videos.length) {
    console.error(
      `Recebi ${arquivos.length} arquivo(s) mas a config tem ${config.videos.length} vídeo(s). ` +
        'Passe um arquivo por vídeo, na mesma ordem.'
    );
    process.exit(1);
  }

  const novos: IntroVideo[] = [];

  for (let i = 0; i < config.videos.length; i++) {
    const antigo = config.videos[i];
    const caminho = arquivos[i];
    const bytes = readFileSync(caminho);

    const enviado = await put(`intro/abertura-otimizada-${Date.now()}-${i}.mp4`, bytes, {
      access: 'public',
      contentType: 'video/mp4',
    });

    // O arquivo já é só o trecho: zera o offset e usa a duração real.
    const duracao = Math.round((antigo.fimSeg - antigo.inicioSeg) * 100) / 100;

    novos.push({
      ...antigo,
      url: enviado.url,
      inicioSeg: 0,
      fimSeg: duracao,
      duracaoSeg: duracao,
    });

    const kbAntes = '?';
    console.log(
      `vídeo ${i + 1}: ${(bytes.length / 1024 / 1024).toFixed(2)}MB enviado\n` +
        `  antes: ${antigo.url}\n  (trecho ${antigo.inicioSeg}s–${antigo.fimSeg}s)\n` +
        `  agora: ${enviado.url}\n  (trecho 0s–${duracao}s, faststart, sem seek)`
    );
    void kbAntes;
  }

  // Só troca o `value`, preservando `updated_by` (é UUID com FK para users —
  // este script não tem um admin autenticado para atribuir).
  await sql`
    UPDATE app_settings
       SET value = ${JSON.stringify({ modo: config.modo, videos: novos })}::jsonb,
           updated_at = NOW()
     WHERE key = ${INTRO_VIDEO_KEY}
  `;
  console.log('\nConfig atualizada. A abertura agora usa os MP4 otimizados.');
}

main().catch((err) => {
  console.error('Falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
