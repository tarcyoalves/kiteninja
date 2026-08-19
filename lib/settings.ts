import 'server-only';
import { sql } from '@/lib/db';
import {
  INTRO_VIDEO_KEY,
  parseIntroVideo,
  parseIntroVideoConfig,
  type IntroVideo,
  type IntroVideoConfig,
} from '@/lib/introVideo';

/**
 * Acesso à configuração global do app (`app_settings`).
 *
 * Os vídeos de abertura moram no banco e não no bundle porque trocar a abertura ou
 * gerenciar a playlist é decisão editorial, não mudança de código.
 */

export { INTRO_VIDEO_KEY };
export type { IntroVideo, IntroVideoConfig };

/** Lê a configuração completa da playlist de abertura. */
export async function getIntroVideoConfig(): Promise<IntroVideoConfig> {
  const rows = await sql`
    SELECT value FROM app_settings WHERE key = ${INTRO_VIDEO_KEY} LIMIT 1
  `;
  if (rows.length === 0) return { modo: 'rodizio', videos: [] };
  return parseIntroVideoConfig(rows[0].value);
}

/** Escolhe o primeiro vídeo ativo de uma config já lida (sem novo hit no banco). */
export function primeiroVideoAtivo(config: IntroVideoConfig): IntroVideo | null {
  return config.videos.find((v) => v.ativo) ?? null;
}

/** Lê o primeiro vídeo ativo ou null se não houver vídeo utilizável. */
export async function getIntroVideo(): Promise<IntroVideo | null> {
  const config = await getIntroVideoConfig();
  return primeiroVideoAtivo(config);
}

/** Lê o registro cru da configuração para o painel admin. */
export async function getIntroVideoRaw(): Promise<IntroVideoConfig> {
  return getIntroVideoConfig();
}

/** Grava a configuração da playlist de abertura. `updated_by` registra qual admin mexeu. */
export async function setIntroVideoConfig(value: IntroVideoConfig, adminId: string): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_by, updated_at)
    VALUES (${INTRO_VIDEO_KEY}, ${JSON.stringify(value)}::jsonb, ${adminId}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
  `;
}

/** Compatibilidade para gravar um único vídeo ou adicionar à playlist. */
export async function setIntroVideo(value: IntroVideo, adminId: string): Promise<void> {
  const atual = await getIntroVideoConfig();
  const videos = [value, ...atual.videos.filter((v) => v.id !== value.id && v.url !== value.url)];
  await setIntroVideoConfig({ modo: atual.modo || 'rodizio', videos }, adminId);
}

/** Remove todos os vídeos da abertura e devolve o app à animação vetorial. */
export async function clearIntroVideo(): Promise<void> {
  await sql`DELETE FROM app_settings WHERE key = ${INTRO_VIDEO_KEY}`;
}

