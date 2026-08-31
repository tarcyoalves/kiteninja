import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// O SHA Git é a única identidade de deploy. Horário/timestamp variam entre
// instâncias serverless e não podem ser usados para decidir se há código novo.
const COMMIT_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  'local';

export async function GET() {
  return NextResponse.json(
    {
      version: '0.1.0',
      commit: COMMIT_SHA,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        Pragma: 'no-cache',
        Expires: '0',
      },
    }
  );
}