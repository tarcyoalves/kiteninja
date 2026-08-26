import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Endpoint público que redireciona para o download do APK oficial Android.
 * Se houver ANDROID_APK_URL configurada (ex: release no GitHub, S3 ou Blob),
 * redireciona para lá (302). Caso contrário, redireciona para a release do repositório.
 */
export async function GET() {
  const downloadUrl =
    process.env.ANDROID_APK_URL ||
    process.env.NEXT_PUBLIC_ANDROID_APK_URL ||
    'https://github.com/tarcyoalves/kiteninja/releases/latest/download/kiteninja.apk';

  return NextResponse.redirect(downloadUrl, {
    status: 302,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}