/**
 * Acompanhamento do velejo SOLO por quem ficou em terra.
 *
 * O QUE ISTO CONSERTA
 *
 * A folha "Iniciar atividade" perguntava "quer que alguém em terra
 * acompanhe?" e o botão compartilhava `window.location.origin` — a página
 * inicial do app. Quem recebia não via nada daquele velejo. E não havia o que
 * ver: um velejo solo nunca mandou posição para o servidor. A trilha ficava só
 * no aparelho (`lib/trilhaSessao.ts`), e o beacon que reporta posição exige um
 * downwind.
 *
 * O MOLDE É O DO DOWNWIND, de propósito: token guardado só como hash, validade
 * curta, link reutilizável por mais de uma pessoa. Aquele caminho já resolveu
 * "como deixar alguém sem conta acompanhar" e foi testado na praia.
 *
 * A DIFERENÇA QUE IMPORTA: o acompanhamento do downwind é do grupo e dura o
 * que a travessia durar. Aqui é de UMA pessoa, e a transmissão da posição
 * dela nunca é ligada por padrão — só quando ela pede o link. Ver
 * `ACOMPANHAMENTO_NUNCA_LIGA_SOZINHO` abaixo.
 */

/**
 * Doze horas, igual ao link do motorista de downwind.
 *
 * Não é número redondo por acaso: cobre a travessia mais longa mais a volta
 * de carro, e expira antes de virar um rastreador permanente da pessoa. Um
 * link de acompanhamento que não expira é um problema de privacidade, não uma
 * comodidade.
 */
export const VALIDADE_APOIO_HORAS = 12;

/**
 * A transmissão de posição do velejo solo NUNCA começa sozinha.
 *
 * Esta constante existe para ser lida, não para ser usada em condicional: é o
 * contrato desta funcionalidade. Nenhum velejo solo manda posição ao servidor
 * a menos que a pessoa tenha pedido o link de acompanhamento. Isso responde
 * de uma vez ao custo de bateria e de invocação (quem não usa não paga) e à
 * privacidade (ninguém é rastreado por um padrão que não escolheu).
 */
export const ACOMPANHAMENTO_NUNCA_LIGA_SOZINHO = true;

/**
 * De quanto em quanto tempo a posição sobe.
 *
 * 45s é o mesmo do beacon do downwind. Quem acompanha de carro não precisa de
 * mais resolução que isso — a estrada é paralela à praia, e a decisão que ele
 * toma ("paro no próximo acesso ou sigo") não muda com 15 segundos.
 */
export const INTERVALO_ENVIO_APOIO_MS = 45_000;

export interface SessaoApoio {
  /** ISO. */
  expiraEm: string;
  /** ISO, ou null enquanto o velejo está em andamento. */
  encerradoEm: string | null;
}

/**
 * O link ainda serve?
 *
 * Três motivos de recusa, e a página de quem acompanha diz cada um com texto
 * próprio — "expirou" e "o velejo acabou" pedem reações diferentes de quem
 * está no carro.
 */
export type MotivoIndisponivel = 'expirado' | 'encerrado' | null;

export function motivoIndisponivel(sessao: SessaoApoio, agora: Date): MotivoIndisponivel {
  if (sessao.encerradoEm !== null) return 'encerrado';
  if (new Date(sessao.expiraEm).getTime() <= agora.getTime()) return 'expirado';
  return null;
}

export function acompanhamentoAtivo(sessao: SessaoApoio, agora: Date): boolean {
  return motivoIndisponivel(sessao, agora) === null;
}

/**
 * Reaproveita a sessão que já está valendo em vez de criar outra.
 *
 * Sem isto, cada toque em "Convidar apoio" geraria um link novo e os antigos
 * continuariam válidos — foi exatamente o defeito do botão "Convidar" do
 * downwind (ver docs/AUDITORIA-EVENTOS-VELEJO-DOWNWIND.md). Pior aqui: cada
 * link novo apontaria para uma sessão diferente, então o amigo que recebeu o
 * primeiro veria uma trilha parada para sempre enquanto a pessoa velejava na
 * outra.
 */
export function devoReaproveitar(sessao: SessaoApoio | null, agora: Date): boolean {
  return sessao !== null && acompanhamentoAtivo(sessao, agora);
}

/** Texto do compartilhamento. Fica aqui porque é a única parte que se lê. */
export function textoDoConvite(args: { nome: string; spot: string | null }): string {
  const onde = args.spot ? ` em ${args.spot}` : '';
  return `${args.nome} está velejando${onde}. Acompanhe ao vivo:`;
}
