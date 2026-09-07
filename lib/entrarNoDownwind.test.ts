import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapaMostraDownwind, pedidoDeAberturaVale } from './activity';

/**
 * Tira comentários — os do TS e também os do SQL.
 *
 * Os do SQL importam aqui: a primeira versão deste teste afirmava que
 * `previsto_para ASC` não aparecia mais no arquivo, e ela FALHOU contra o
 * código já corrigido, porque a string sobrevivia dentro de um comentário
 * `--` que explicava a ordenação antiga. Um teste que lê comentário não está
 * lendo o código.
 *
 * Só linhas que COMEÇAM com `--`: no meio de uma linha de TypeScript, `--`
 * pode ser o operador de decremento, e cortar dali para a frente apagaria
 * código de verdade.
 */
const semComentarios = (texto: string) =>
  texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*$/, ''))
    .filter((linha) => !linha.trimStart().startsWith('--'))
    .join('\n');

/**
 * "Tentei entrar num dw e não prestou."
 *
 * O servidor gravava a entrada certinho. O que falhava era a tela: entrar num
 * downwind AGENDADO levava a pessoa para a aba Mapa comum, sem sinal nenhum
 * do downwind — como se o toque não tivesse feito nada.
 *
 * A CAUSA era uma corrida entre duas correções antigas que não se conheciam.
 * `abertoDeliberadamente` era um booleano; um `useAoMudar` o zerava sempre que
 * o id do downwind ativo mudava, para o "quero ver" de um downwind não ser
 * herdado por outro. Só que entrar faz as duas coisas juntas: recarrega o
 * downwind (id vai de `null` para o novo) E liga o pedido. O zerador roda
 * durante o render seguinte — depois de o React juntar as duas mudanças — e
 * desligava o pedido que acabara de ser ligado.
 *
 * Por isso só quebrava na PRIMEIRA entrada e só em downwind 'aberto':
 * travessia em andamento toma a tela por outro caminho, e quem já era
 * participante não tem troca de id para o zerador reagir.
 */
describe('entrar num downwind agendado abre a tela do downwind', () => {
  const contexto = () => semComentarios(readFileSync('context/DownwindContext.tsx', 'utf8'));

  it('o pedido vale para o downwind que o recebeu', () => {
    expect(pedidoDeAberturaVale('dw-1', 'dw-1')).toBe(true);
  });

  it('o pedido NÃO é herdado por outro downwind', () => {
    // A propriedade que o zerador antigo protegia — e que agora sai de graça,
    // sem ninguém precisar desligar nada.
    expect(pedidoDeAberturaVale('dw-1', 'dw-2')).toBe(false);
    expect(pedidoDeAberturaVale('dw-1', null)).toBe(false);
  });

  it('sem pedido nenhum, downwind agendado não toma a tela', () => {
    expect(pedidoDeAberturaVale(null, 'dw-1')).toBe(false);
    expect(
      mapaMostraDownwind({
        downwind: { status: 'aberto' },
        abertoDeliberadamente: pedidoDeAberturaVale(null, 'dw-1'),
      })
    ).toBe(false);
  });

  it('A CENA DO BUG: entrar num agendado que ainda não estava carregado', () => {
    // Antes: id ia de null para 'dw-1' e o zerador apagava o pedido, então
    // isto dava `false` e a pessoa via o mapa comum.
    const pedido = 'dw-1'; // gravado por entrarNoDownwind com o id recebido
    const ativo = { id: 'dw-1', status: 'aberto' as const };
    expect(
      mapaMostraDownwind({
        downwind: ativo,
        abertoDeliberadamente: pedidoDeAberturaVale(pedido, ativo.id),
      })
    ).toBe(true);
  });

  it('entrarNoDownwind guarda o id que recebeu, não um booleano', () => {
    const src = contexto();
    expect(src).toContain('setPedidoAberturaId(downwindId)');
  });

  it('a rota do downwind ativo aceita QUAL downwind, em vez de adivinhar', () => {
    /*
     * A SEGUNDA CAUSA, encontrada depois que a primeira foi corrigida e o
     * relato continuou: `/api/downwind/ativo` devolvia UM downwind escolhido
     * por `ORDER BY ... LIMIT 1`. Quem está em mais de um — e quem cria
     * downwinds de teste fica em vários, porque nada fecha os antigos —
     * recebia sempre o mesmo, que não era o recém-aberto.
     *
     * O app então pedia a tela do downwind X e recebia o Y: o pedido não
     * casava com o downwind ativo e era descartado em silêncio. Nenhum erro,
     * nenhuma mensagem — a aba Mapa comum, de novo.
     */
    const rota = semComentarios(readFileSync('app/api/downwind/ativo/route.ts', 'utf8'));
    expect(rota).toContain("searchParams.get('id')");
    expect(rota).toContain('AND d.id = ${idPedido}');

    // E o cliente precisa realmente MANDAR o id ao entrar.
    expect(contexto()).toContain('await recarregar(downwindId)');
  });

  it('sem id pedido, a ordem prefere a travessia em andamento e a entrada mais recente', () => {
    // A ordem antiga (`previsto_para ASC` entre agendados) elegia o downwind
    // de data MAIS ANTIGA — o teste esquecido de duas semanas atrás ganhava
    // do que a pessoa acabou de criar.
    const rota = semComentarios(readFileSync('app/api/downwind/ativo/route.ts', 'utf8'));
    expect(rota).toContain("(d.status = 'em_andamento') DESC");
    expect(rota).toContain('dp.entrou_em DESC');
    expect(rota).not.toContain('previsto_para ASC');
  });

  it('não existe mais zerador do pedido reagindo à troca de id', () => {
    // Esta é a linha que comia o pedido. Se alguém a trouxer de volta junto
    // com o booleano, o bug volta inteiro.
    const src = contexto();
    expect(src).not.toContain('setAbertoDeliberadamente');
  });
});
