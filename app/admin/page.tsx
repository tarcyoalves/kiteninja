import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { InviteManager } from './InviteManager';

export const metadata = { title: 'Convites | KiteNinja' };

export default async function AdminPage() {
  const user = await getSessionUser();

  // Checagem no servidor: quem não é admin nunca recebe o HTML desta página.
  if (!user) redirect('/');
  if (user.role !== 'admin') redirect('/');

  return <InviteManager adminName={user.name} />;
}
