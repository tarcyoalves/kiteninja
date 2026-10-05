import Link from 'next/link';
import { ArrowLeft, KeyRound, MessageCircle, ShieldCheck } from 'lucide-react';

/**
 * "Esqueci minha senha" — dizendo a verdade sobre como a recuperação funciona.
 *
 * O QUE ESTA TELA FAZIA, E POR QUE ERA O PIOR PEDAÇO DO FLUXO
 *
 * Pedia o e-mail, chamava `POST /api/auth/recover-password` e mostrava
 * "Instruções enviadas! Você receberá o link". Não existe envio de e-mail
 * neste projeto: o token era criado e nunca chegava a ninguém.
 *
 * E não era só inútil — era destrutivo. Criar esse token invalidava os links
 * anteriores da conta, inclusive o que o admin tinha acabado de gerar e mandar
 * pelo WhatsApp. A pessoa, esperando um e-mail que nunca vinha, abria o link
 * certo e lia "Link de recuperação inválido, expirado ou já utilizado".
 * Reproduzido rodando as rotas reais (lib/redefinirSenhaFluxo.test.ts,
 * cenário D). Foi o "a redefinição não prestou".
 *
 * Hoje o único caminho que entrega um link é o painel admin. Então esta tela
 * diz isso, e não chama rota nenhuma. Quando houver envio de e-mail de
 * verdade, o formulário volta — a rota continua lá esperando (e já não mata
 * mais o link de ninguém: ver `createPasswordResetToken` em lib/auth.ts).
 */
export default function RecuperarSenhaPage() {
  return (
    <main className="min-h-screen bg-[#0F172A] text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#1E293B] rounded-3xl border border-slate-700/80 shadow-2xl p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            <span>Voltar ao login</span>
          </Link>
          <span className="text-xs font-black text-cyan-400">KiteNinja</span>
        </div>

        <div className="space-y-1">
          <h1 className="text-xl font-black text-white flex items-center gap-2">
            <KeyRound className="text-cyan-400" size={22} />
            <span>Esqueceu a senha?</span>
          </h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            A recuperação de acesso é feita pelo administrador do KiteNinja.
          </p>
        </div>

        <ol className="space-y-3">
          <li className="flex gap-3 p-3 rounded-2xl bg-[#0F172A] border border-slate-700/80">
            <MessageCircle size={18} className="text-cyan-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-300 leading-relaxed">
              <strong className="text-white">Peça um link de nova senha</strong> ao administrador
              ou a quem te convidou para o app. Ele gera o link pelo painel e te manda por
              WhatsApp.
            </p>
          </li>
          <li className="flex gap-3 p-3 rounded-2xl bg-[#0F172A] border border-slate-700/80">
            <ShieldCheck size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <p className="text-xs text-slate-300 leading-relaxed">
              <strong className="text-white">Abra o link e escolha a senha nova.</strong> Ele vale
              por 2 horas e serve uma única vez. Se expirar, é só pedir outro.
            </p>
          </li>
        </ol>

        <Link
          href="/"
          className="block w-full py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs rounded-xl shadow-lg shadow-cyan-500/25 transition-all text-center"
        >
          Voltar ao login
        </Link>
      </div>
    </main>
  );
}
