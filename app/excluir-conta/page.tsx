import type { Metadata } from 'next';

/**
 * Exclusão de Conta — página pública, sem login.
 *
 * POR QUE ESTA PÁGINA EXISTE
 *
 * Desde 2024 o Google Play exige, de todo app que permite criar conta, DUAS
 * portas de exclusão: uma dentro do app e outra numa URL pública, acessível
 * sem instalar nada e sem fazer login — porque quem já desinstalou o app
 * também tem direito de apagar os dados. Faltando a URL, o envio é recusado
 * na revisão; não é item de capricho.
 *
 * Ela é o par de `DELETE /api/profile`, que faz a exclusão de verdade. O que
 * está escrito aqui sobre o que some e o que fica foi tirado das chaves
 * estrangeiras de `lib/schema.sql`, não de intenção: 35 delas apontam para
 * `users`, todas ON DELETE CASCADE (dado do velejador) ou ON DELETE SET NULL
 * (registro de auditoria que precisa sobreviver sem a pessoa).
 */

export const metadata: Metadata = {
  title: 'Excluir sua conta — KiteNinja',
  description:
    'Como excluir permanentemente sua conta do KiteNinja e quais dados são apagados ou mantidos.',
  alternates: { canonical: '/excluir-conta' },
  robots: { index: true, follow: true },
};

const CONTATO = 'tarcyo.alves@gmail.com';
const ATUALIZADO_EM = '3 de setembro de 2026';

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-black text-white">{titulo}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

export default function ExcluirConta() {
  return (
    <main className="min-h-screen bg-[#070D18] px-5 py-10">
      <article className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-black text-white">Excluir sua conta</h1>
        <p className="mt-1 text-xs text-slate-500">Atualizada em {ATUALIZADO_EM}</p>

        <p className="mt-5 text-sm leading-relaxed text-slate-300">
          Você pode apagar permanentemente sua conta do KiteNinja e os dados associados a ela. A
          exclusão é definitiva: não há lixeira, e não é possível desfazer.
        </p>

        <Secao titulo="1. Pelo aplicativo (mais rápido)">
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>Abra o KiteNinja e entre na sua conta.</li>
            <li>
              Toque no seu avatar para abrir o <strong>Perfil</strong>.
            </li>
            <li>
              Role até o fim e toque em <strong>Excluir minha conta</strong>.
            </li>
            <li>Digite sua senha para confirmar.</li>
          </ol>
          <p>
            A conta é apagada na hora e você é desconectado de todos os aparelhos.
          </p>
        </Secao>

        <Secao titulo="2. Por e-mail (se você já desinstalou o app)">
          <p>
            Envie uma mensagem para{' '}
            <a className="text-cyan-400 underline" href={`mailto:${CONTATO}`}>
              {CONTATO}
            </a>{' '}
            a partir do <strong>mesmo endereço de e-mail cadastrado na conta</strong>, com o
            assunto <strong>&ldquo;Excluir minha conta&rdquo;</strong>.
          </p>
          <p>
            O pedido é atendido em até <strong>30 dias</strong>. Pedimos que o e-mail parta do
            endereço cadastrado porque é assim que confirmamos que a conta é sua — sem isso,
            qualquer pessoa poderia pedir a exclusão da conta alheia.
          </p>
        </Secao>

        <Secao titulo="3. O que é apagado">
          <p>Some tudo que é seu, imediatamente e sem cópia:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Seu cadastro: nome, e-mail, senha, foto, peso, nível e equipamento.</li>
            <li>Seus velejos registrados, com trilhas de GPS, distância e velocidade.</li>
            <li>Suas travessias de downwind e todas as posições enviadas nelas.</li>
            <li>Suas mensagens de chat, publicações, comentários e curtidas.</li>
            <li>Seus favoritos, anúncios do marketplace e inscrições em eventos.</li>
            <li>Seus chamados de SOS e o histórico deles.</li>
            <li>
              Suas sessões abertas e as autorizações de notificação — o aplicativo para de
              enviar qualquer aviso.
            </li>
          </ul>
        </Secao>

        <Secao titulo="4. O que permanece, e por quê">
          <p>
            Três coisas continuam existindo depois da exclusão, sempre{' '}
            <strong>desvinculadas do seu nome</strong>:
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Downwinds que você organizou e outras pessoas participaram.</strong> A
              travessia continua no histórico de quem velejou junto; o campo de organizador fica
              vazio. Apagar a travessia inteira destruiria o registro dos outros velejadores.
            </li>
            <li>
              <strong>Registros de auditoria de segurança.</strong> Guardamos o fato de que uma
              ação administrativa aconteceu, sem o autor. Isso protege a comunidade contra abuso
              e não descreve seu comportamento.
            </li>
            <li>
              <strong>Convites que você usou para entrar.</strong> Fica o registro de que o
              convite foi consumido, sem apontar para você.
            </li>
          </ul>
          <p>
            Nenhum desses registros contém seu nome, e-mail, foto ou localização. Cópias de
            segurança do banco de dados são substituídas no ciclo normal, em até 30 dias.
          </p>
        </Secao>

        <Secao titulo="5. Quando a exclusão é recusada">
          <p>Em duas situações o aplicativo pede que você resolva algo antes:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Você tem um SOS em aberto.</strong> Apagar a conta durante um chamado de
              socorro tiraria sua posição da tela de quem está indo ajudar. Encerre o chamado
              primeiro.
            </li>
            <li>
              <strong>Você é o único administrador ativo.</strong> Promova outra pessoa antes,
              ou a comunidade fica sem quem administre.
            </li>
          </ul>
        </Secao>

        <Secao titulo="6. Dúvidas">
          <p>
            Fale com{' '}
            <a className="text-cyan-400 underline" href={`mailto:${CONTATO}`}>
              {CONTATO}
            </a>
            . Veja também a{' '}
            <a className="text-cyan-400 underline" href="/privacidade">
              Política de Privacidade
            </a>
            .
          </p>
        </Secao>
      </article>
    </main>
  );
}
