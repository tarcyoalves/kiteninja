import { AcompanharView } from './AcompanharView';

export const metadata = { title: 'Acompanhar velejo | KiteNinja' };

/**
 * Página pública de acompanhamento do velejo solo.
 *
 * Mesma escolha de app/dw-motorista/[token]: NÃO monta a árvore de providers
 * do app (Auth/KiteData/Downwind). Quem abre isto é o amigo no carro, sem
 * conta — ele não deveria carregar spots, feed, chat nem nada do app geral, e
 * não ter os providers aqui garante isso na raiz, não só na autorização.
 *
 * Diferente da página do motorista de downwind, esta NÃO pré-valida o token no
 * servidor: aqui a resposta muda com o tempo (o velejo pode encerrar enquanto
 * a página está aberta), então quem manda no que aparece é o mesmo poll que
 * atualiza a posição. Uma validação no servidor só duplicaria a regra em dois
 * lugares — e regra duplicada é regra que diverge.
 */
export default function AcompanharVelejoPage() {
  return <AcompanharView />;
}
