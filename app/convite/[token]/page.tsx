import Link from 'next/link';
import { findUsableInvite } from '@/lib/auth';
import { AcceptInviteForm } from './AcceptInviteForm';

export const metadata = { title: 'Convite | KiteNinja' };

// O convite é validado no servidor: um link inválido nunca chega a renderizar o
// formulário, e o token não passa pelo bundle do cliente antes disso.
export default async function ConvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await findUsableInvite(token);

  if (!invite) {
    return (
      <main className="min-h-screen bg-[#0F172A] text-slate-100 flex items-center justify-center p-5">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-5xl" aria-hidden="true">
            🪁
          </div>
          <h1 className="text-xl font-black">Convite indisponível</h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Este link já foi usado, expirou ou foi revogado. Cada convite serve para
            uma única conta e não pode ser repassado.
          </p>
          <p className="text-sm text-slate-400">
            Peça um novo link ao administrador.
          </p>
          <Link
            href="/"
            className="inline-block mt-2 px-5 py-3 rounded-2xl bg-slate-800 text-slate-200 font-bold text-sm"
          >
            Voltar ao início
          </Link>
        </div>
      </main>
    );
  }

  return <AcceptInviteForm token={token} lockedEmail={invite.email} />;
}
