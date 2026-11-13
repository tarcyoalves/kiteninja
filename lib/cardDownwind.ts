/**
 * Que botões o card de um downwind mostra para ESTA pessoa (T11, opção A).
 *
 * O DEFEITO QUE ISTO FECHA
 *
 * Quem encerrava o próprio velejo e queria ver o resto do grupo chegar
 * encontrava, no card, um botão grande "Downwind AO VIVO — entrar". Tocar nele
 * levava `encerrado` de volta para `confirmado` — o contorno de setembro para
 * a "armadilha de três portas" (docs/ESPECTADOR-DE-DOWNWIND.md). A pessoa só
 * queria OLHAR, e saía dali contando de novo no quórum: o grupo inteiro
 * chegava na praia e não conseguia fechar o downwind, porque o app achava que
 * ela tinha voltado para a água. Para destravar ela tinha que "sair", o que
 * gravava `desistiu` por cima de quem tinha completado a travessia.
 *
 * O botão ao lado, "Só assistir (não vou velejar)", era pior ainda para esse
 * caso: troca o papel para espectador.
 *
 * A DECISÃO DO DONO (13/11/2026): quem já encerrou reabre SÓ PARA ASSISTIR,
 * sem voltar a contar no quórum.
 *
 * POR QUE PELO CARD, E NÃO SERVINDO `encerrado` EM `/api/downwind/ativo`
 *
 * O plano sugeria fazer `/ativo` devolver participante em qualquer estado. Lido
 * o contexto, isso religaria o envio de posição: o beacon web e o Wake Lock
 * ligam por "travessia em andamento" sem olhar o estado da pessoa
 * (context/DownwindContext.tsx), justamente porque `/ativo` nunca devolveu
 * quem encerrou. Quem assistisse do carro voltaria a transmitir de terra,
 * aparecendo no mapa do grupo como se estivesse no mar.
 *
 * O mapa ao vivo de leitura (`/dw-live/[id]`) já existe, já aceita qualquer
 * participante (`podeVerReplayAoVivo`) e não muda estado nenhum. Assistir
 * passa a ir para lá. Voltar para a água continua possível — é o que acontece
 * na praia — mas vira um gesto separado, que diz o que custa.
 */

export type AcaoPrincipalDoCard =
  /** Põe a pessoa na travessia (conta no quórum). */
  | 'entrar'
  /** Abre o mapa ao vivo de leitura. Não muda estado nenhum. */
  | 'assistir'
  | null;

export interface AcoesDoCardDownwind {
  principal: AcaoPrincipalDoCard;
  /** "Voltar para a água": reentrar depois de ter encerrado. Volta ao quórum. */
  voltarParaAgua: boolean;
  /** "Só assistir (não vou velejar)": vira espectador. */
  virarEspectador: boolean;
  /** Link secundário para o mapa ao vivo ("Acompanhar de terra"). */
  mapaAoVivo: boolean;
  /** A pessoa já encerrou o próprio velejo e o grupo segue na água. */
  jaEncerrei: boolean;
}

const NADA: AcoesDoCardDownwind = {
  principal: null,
  voltarParaAgua: false,
  virarEspectador: false,
  mapaAoVivo: false,
  jaEncerrei: false,
};

export function acoesDoCardDownwind(args: {
  status: string | null | undefined;
  meuPapel: string | null | undefined;
  meuEstado: string | null | undefined;
  /** Quem não participa só vê o mapa ao vivo se o downwind é público ou é dele. */
  podeVerSemParticipar: boolean;
}): AcoesDoCardDownwind {
  const { status, meuPapel, meuEstado, podeVerSemParticipar } = args;

  if (status !== 'aberto' && status !== 'em_andamento') return NADA;

  const emAndamento = status === 'em_andamento';
  const participo = meuPapel != null;
  const espectador = meuPapel === 'espectador';

  // Só existe "já encerrei" com a travessia rolando: em downwind agendado
  // ninguém chegou a navegar, então não há o que ter encerrado.
  const jaEncerrei = emAndamento && participo && !espectador && meuEstado === 'encerrado';

  if (jaEncerrei) {
    return {
      principal: 'assistir',
      voltarParaAgua: true,
      // Trocar o papel de quem COMPLETOU a travessia para espectador apagaria
      // o lugar dela no resumo. Assistir não exige isso.
      virarEspectador: false,
      // O botão principal já leva ao mapa; um segundo igual só confunde.
      mapaAoVivo: false,
      jaEncerrei: true,
    };
  }

  return {
    principal: 'entrar',
    voltarParaAgua: false,
    virarEspectador: !espectador,
    mapaAoVivo: emAndamento && (participo || podeVerSemParticipar),
    jaEncerrei: false,
  };
}
