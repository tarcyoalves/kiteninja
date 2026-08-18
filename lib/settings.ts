import 'server-only';
import { sql } from '@/lib/db';
import { INTRO_VIDEO_KEY, parseIntroVideo, type IntroVideo } from '@/lib/introVideo';

/**
 * Acesso à configuração global do app (`app_settings`).
 *
 * O vídeo de abertura mora no banco e não no bundle porque trocar a abertura é
 * decisão editorial, não mudança de código: o admin sobe outro arquivo e o app
 * muda sem deploy. A validação da forma fica em `lib/introVideo.ts`, testável
 * sem banco.
 */

export { INTRO_VIDEO_KEY };
export type { IntroVideo };

/** Lê a abertura ativa, ou `null` se não houver vídeo utilizável. */
export async function getIntroVideo(): Promise<IntroVideo | null> {
  const rows = await sql`
    SELECT value FROM app_settings WHERE key = ${INTRO_VIDEO_KEY} LIMIT 1
  `;
  if (rows.length === 0) return null;
  return parseIntroVideo(rows[0].value);
}

/**
 * Lê o registro cru, inclusive desativado — o painel precisa mostrar o vídeo
 * desligado para o admin poder religá-lo, enquanto o app não deve tocá-lo.
 */
export async function getIntroVideoRaw(): Promise<
  (Partial<IntroVideo> & { ativo: boolean }) | null
> {
  const rows = await sql`
    SELECT value FROM app_settings WHERE key = ${INTRO_VIDEO_KEY} LIMIT 1
  `;
  if (rows.length === 0) return null;
  const v = rows[0].value as Record<string, unknown> | null;
  if (v === null || typeof v !== 'object') return null;

  return {
    url: typeof v.url === 'string' ? v.url : undefined,
    inicioSeg: Number.isFinite(Number(v.inicioSeg)) ? Number(v.inicioSeg) : undefined,
    fimSeg: Number.isFinite(Number(v.fimSeg)) ? Number(v.fimSeg) : undefined,
    posterDataUrl: typeof v.posterDataUrl === 'string' ? v.posterDataUrl : undefined,
    nomeArquivo: typeof v.nomeArquivo === 'string' ? v.nomeArquivo : undefined,
    duracaoSeg: Number.isFinite(Number(v.duracaoSeg)) ? Number(v.duracaoSeg) : undefined,
    ativo: v.ativo !== false,
  };
}

/** Grava a abertura. `updated_by` registra qual admin mexeu. */
export async function setIntroVideo(value: IntroVideo, adminId: string): Promise<void> {
  await sql`
    INSERT INTO app_settings (key, value, updated_by, updated_at)
    VALUES (${INTRO_VIDEO_KEY}, ${JSON.stringify(value)}::jsonb, ${adminId}, NOW())
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
  `;
}

/** Remove a abertura e devolve o app à animação vetorial. */
export async function clearIntroVideo(): Promise<void> {
  await sql`DELETE FROM app_settings WHERE key = ${INTRO_VIDEO_KEY}`;
}
