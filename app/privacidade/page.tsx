import type { Metadata } from 'next';

/**
 * Política de Privacidade — página pública, sem login.
 *
 * POR QUE ESTA PÁGINA EXISTE
 *
 * O Google Play **recusa o envio** de um app sem política de privacidade
 * acessível por URL pública, e recusa com rigor extra quando o app declara
 * `ACCESS_FINE_LOCATION` com `FOREGROUND_SERVICE_LOCATION` — que é
 * exatamente o caso aqui, porque o rastreio do downwind precisa continuar com
 * a tela apagada.
 *
 * Duas auditorias externas trataram "publicar na Play Store" como assunto de
 * screenshots e texto de loja. Não é: sem esta página o envio nem chega à
 * revisão. Era o único item que sozinho impedia o lançamento.
 *
 * O conteúdo descreve o que o código realmente faz — as permissões vieram do
 * AndroidManifest e as categorias de dado, das tabelas de `lib/schema.sql`.
 * Se o app passar a coletar algo novo, esta página muda junto.
 */

export const metadata: Metadata = {
  title: 'Política de Privacidade — KiteNinja',
  description:
    'Como o KiteNinja coleta, usa e protege seus dados de localização, conta e uso do aplicativo.',
  alternates: { canonical: '/privacidade' },
  robots: { index: true, follow: true },
};

const ATUALIZADO_EM = '2 de setembro de 2026';
const CONTATO = 'tarcyo.alves@gmail.com';

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-black text-white">{titulo}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

export default function PoliticaDePrivacidade() {
  return (
    <main className="min-h-screen bg-[#070D18] px-5 py-10">
      <article className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-black text-white">Política de Privacidade</h1>
        <p className="mt-1 text-xs text-slate-500">Atualizada em {ATUALIZADO_EM}</p>

        <p className="mt-5 text-sm leading-relaxed text-slate-300">
          O KiteNinja é um aplicativo de segurança e comunidade para kitesurf, wing foil e
          downwind. Esta política descreve, em português claro, quais dados o aplicativo coleta,
          por que coleta e o que você pode fazer a respeito.
        </p>

        <Secao titulo="1. Localização — a parte mais importante">
          <p>
            O KiteNinja coleta a sua <strong>localização precisa (GPS)</strong>, inclusive{' '}
            <strong>com o aplicativo em segundo plano e a tela apagada</strong>. Isso não é
            acessório: é a função central do produto.
          </p>
          <p>A localização é usada para três coisas, e apenas para elas:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Rastreio de downwind.</strong> Enquanto uma travessia está em andamento, sua
              posição é enviada periodicamente para que os outros participantes e o apoio em terra
              vejam onde você está. Só quem participa daquele downwind — ou recebeu um link de
              acompanhamento — enxerga esses pontos.
            </li>
            <li>
              <strong>Pedido de socorro (SOS).</strong> Ao acionar o SOS, sua posição é enviada aos
              velejadores próximos para que possam ajudar. Sem ela, o pedido não encontra ninguém.
            </li>
            <li>
              <strong>Registro do seu velejo.</strong> A trilha percorrida vira distância,
              velocidade máxima e o traçado no seu histórico pessoal.
            </li>
          </ul>
          <p>
            O rastreio em segundo plano só funciona <strong>durante</strong> uma travessia que você
            iniciou, e para enquanto ela é encerrada. O aplicativo não coleta sua localização quando
            você não está velejando.
          </p>
          <p>
            As posições de uma travessia são <strong>apagadas 7 dias depois</strong> do
            encerramento. O que permanece é o resumo (distância, velocidade máxima e um traçado
            reduzido) no seu próprio histórico.
          </p>
        </Secao>

        <Secao titulo="2. Outros dados que coletamos">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Conta:</strong> nome, e-mail e senha. A senha nunca é guardada em texto —
              apenas um hash bcrypt, que não permite recuperar a senha original.
            </li>
            <li>
              <strong>Perfil de velejador:</strong> peso, altura, nível, spot de origem,
              equipamentos e biografia. Todos opcionais.
            </li>
            <li>
              <strong>Conteúdo que você cria:</strong> velejos registrados, publicações,
              comentários, mensagens de chat, alertas de segurança e anúncios do marketplace.
            </li>
            <li>
              <strong>Notificações:</strong> um identificador de dispositivo, para entregar avisos
              de SOS, mensagens e convites. Não identifica você fora do aplicativo.
            </li>
          </ul>
          <p>
            O aplicativo <strong>não</strong> usa rastreadores de publicidade, não faz perfilamento
            para anúncios e não vende dados a terceiros.
          </p>
        </Secao>

        <Secao titulo="3. Quem vê o quê">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Sua posição ao vivo:</strong> apenas participantes da mesma travessia e quem
              recebeu o link de acompanhamento que você compartilhou.
            </li>
            <li>
              <strong>Num SOS:</strong> os velejadores selecionados para socorrer, e moderadores.
            </li>
            <li>
              <strong>Seus velejos:</strong> só você, a menos que marque como públicos.
            </li>
            <li>
              <strong>Mensagens diretas:</strong> apenas você e a pessoa com quem conversa.
            </li>
          </ul>
        </Secao>

        <Secao titulo="4. Onde os dados ficam">
          <p>
            Os dados são armazenados em banco PostgreSQL hospedado pela Neon, e o aplicativo roda na
            infraestrutura da Vercel. As notificações passam pelo Firebase Cloud Messaging (Google).
            A previsão de vento e maré vem da API pública Open-Meteo, que recebe apenas as
            coordenadas do spot consultado — nunca a sua posição pessoal.
          </p>
        </Secao>

        <Secao titulo="5. Seus direitos">
          <p>
            Você pode, a qualquer momento: revogar a permissão de localização nas configurações do
            sistema (o rastreio para, e o aplicativo avisa que parou); desativar notificações;
            apagar velejos, publicações e anúncios; e{' '}
            <strong>pedir a exclusão completa da sua conta</strong>.
          </p>
          <p>
            Ao excluir a conta, tudo que está ligado a ela é removido em cascata — velejos,
            posições, mensagens, anúncios e inscrições. A exclusão é definitiva.
          </p>
          <p>
            Para exercer qualquer um desses direitos, escreva para{' '}
            <a href={`mailto:${CONTATO}`} className="text-cyan-400 underline">
              {CONTATO}
            </a>
            .
          </p>
        </Secao>

        <Secao titulo="6. Crianças">
          <p>
            O KiteNinja não é destinado a menores de 13 anos e não coleta dados dessa faixa etária
            de forma consciente.
          </p>
        </Secao>

        <Secao titulo="7. Mudanças nesta política">
          <p>
            Se o aplicativo passar a coletar algo diferente, esta página é atualizada junto com a
            mudança, e a data no topo reflete a revisão mais recente.
          </p>
        </Secao>

        <Secao titulo="8. Contato">
          <p>
            Dúvidas sobre privacidade, ou pedidos de acesso e exclusão:{' '}
            <a href={`mailto:${CONTATO}`} className="text-cyan-400 underline">
              {CONTATO}
            </a>
            .
          </p>
        </Secao>

        <p className="mt-10 text-center text-xs text-slate-600">
          <a href="/conheca" className="underline hover:text-slate-400">
            Voltar para o KiteNinja
          </a>
        </p>
      </article>
    </main>
  );
}
