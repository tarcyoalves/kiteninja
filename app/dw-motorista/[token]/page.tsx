import Link from 'next/link';
import { buscarConviteValido } from '@/lib/downwindDb';
import { ConvidadoView } from './ConvidadoView';

export const metadata = { title: 'Apoio do Downwind | KiteNinja' };

/**
 * Página pública do link de 12h para apoio em terra sem conta — pedido do
 * dono. Server Component que pré-valida o token ANTES de renderizar o
 * formulário, mesmo padrão de app/convite/[token]/page.tsx: um link
 * inválido nunca chega a mostrar nada interativo.
 *
 * A parte com estado (checar sessão de convidado já existente, formulário de
 * nome, mapa e chat) vive em ConvidadoView.tsx, Client Component — esta
 * página não usa AuthProvider/KiteDataProvider/DownwindProvider (a árvore de
 * providers do app principal, montada em app/page.tsx): o convidado nunca
 * deveria carregar spots, feed ou qualquer outra coisa do app geral, e não
 * ter esses providers aqui é o que garante isso na raiz, não só a
 * autorização do servidor.
 */
export default async function MotoristaConvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const convite = await buscarConviteValido(token);

  if (!convite) {
    return (
      <main className="min-h-screen bg-[#0F172A] text-slate-100 flex items-center justify-center p-5">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-5xl" aria-hidden="true">
            🚗
          </div>
          <h1 className="text-xl font-black">Link indisponível</h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Este link de apoio já expirou (dura 12 horas), foi revogado, ou o
            downwind já terminou. Peça um novo link a quem organizou a travessia.
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

  return <ConvidadoView token={token} downwindNome={convite.downwindNome} />;
}
