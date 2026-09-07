import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapaMostraDownwind, pedidoDeAberturaVale } from './activity';

const semComentarios = (texto: string) =>
  texto
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((linha) => linha.replace(/\/\/.*$/, ''))
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

  it('não existe mais zerador do pedido reagindo à troca de id', () => {
    // Esta é a linha que comia o pedido. Se alguém a trouxer de volta junto
    // com o booleano, o bug volta inteiro.
    const src = contexto();
    expect(src).not.toContain('setAbertoDeliberadamente');
  });
});
