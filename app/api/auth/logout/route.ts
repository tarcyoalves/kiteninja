import { handle } from '@/lib/api';
import { destroySession } from '@/lib/auth';

export async function POST() {
  return handle(async () => {
    await destroySession();
    return { ok: true };
  });
}
