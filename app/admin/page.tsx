import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { AdminDashboard } from './AdminDashboard';

export const metadata = { title: 'Painel de Controle | KiteNinja' };

export default async function AdminPage() {
  const user = await getSessionUser();

  // Checagem no servidor: quem não é admin nunca recebe o HTML desta página.
  if (!user) redirect('/');
  if (user.role !== 'admin') redirect('/');
  // Com troca de senha pendente, toda rota da API recusa (requireUser, desde
  // 13/11) — o painel abriria e nenhum botão funcionaria. A tela de troca
  // obrigatória mora no app principal.
  if (user.mustChangePassword) redirect('/');

  return <AdminDashboard adminName={user.name} />;
}

