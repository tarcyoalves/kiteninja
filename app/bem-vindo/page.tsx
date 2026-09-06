import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';
import { BemVindoCliente } from './BemVindoCliente';

export const metadata = { title: 'Bem-vindo | KiteNinja' };

/**
 * Boas-vindas de quem acabou de criar a conta por um convite.
 *
 * POR QUE ESTA PÁGINA EXISTE
 *
 * Quem aceitava o convite era jogado direto na `/` — a mesma tela de quem já
 * usa o app há meses, com sete abas, mapa, feed e nada explicando por onde
 * começar. O convite é o momento em que a pessoa está MAIS disposta a
 * entender o app, e ele estava sendo gasto num "pronto, se vire".
 *
 * O nome vem do servidor, não da URL: `?nome=` seria texto de terceiro numa
 * página que dá as boas-vindas, e qualquer um poderia mandar um link com o
 * nome que quisesse escrito em letra grande.
 */
export default async function BemVindoPage() {
  const user = await getSessionUser();

  /*
   * Sem sessão, a página não tem o que dizer — e mostrar boas-vindas para
   * quem não entrou seria convite a indexar uma tela vazia. Manda entrar.
   */
  if (!user) {
    return (
      <main className="flex-1 min-h-0 overflow-y-auto bg-[var(--app-bg)] text-slate-100 flex items-center justify-center p-5">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-5xl" aria-hidden="true">
            🪁
          </div>
          <h1 className="text-xl font-black">Entre para continuar</h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Esta página é a recepção de quem acabou de criar a conta pelo convite.
          </p>
          <Link
            href="/"
            className="inline-block mt-1 px-5 py-3 rounded-2xl bg-slate-800 text-slate-200 font-bold text-sm"
          >
            Ir para o KiteNinja
          </Link>
        </div>
      </main>
    );
  }

  return <BemVindoCliente nome={user.name} />;
}
