/**
 * Números de emergência — fonte única.
 *
 * POR QUE CENTRALIZAR: 193 e 185 estavam escritos à mão em quatro arquivos
 * (SosPanel, SidebarDrawer, ModoNavegacao, useSosHold). Número de emergência
 * errado ou desatualizado em um dos lugares é o tipo de defeito que só aparece
 * quando alguém precisa dele — exatamente quando não há chance de corrigir.
 *
 * REGRA DE PRODUTO: o KiteNinja avisa a comunidade, mas **não é serviço de
 * resgate**. A comunidade chega mais rápido; a autoridade tem barco, helicóptero
 * e mandato. As duas coisas são complementares, e a autoridade nunca pode ficar
 * escondida atrás de um fluxo do app.
 *
 * Ordem deliberada: quem está na água em apuros liga primeiro para Bombeiros
 * (193), que atende salvamento aquático em todo o litoral e tem a resposta mais
 * rápida na maioria das cidades. A Marinha (185 / Salvamar) coordena resgate
 * em mar aberto — é a certa quando o velejador foi levado para fora da costa.
 * SAMU (192) entra quando o velejador já está em terra e o problema é clínico
 * (trauma, afogamento recuperado). Polícia (190) é o fallback universal: atende
 * de qualquer lugar e redireciona.
 */

export interface NumeroEmergencia {
  /** O que se disca. Também usado no `tel:`. */
  numero: string;
  nome: string;
  /** Quando ligar para este, em uma linha — o velejador decide em segundos. */
  quando: string;
  /** Cor semântica do botão (classes Tailwind), do mais urgente ao apoio. */
  cor: string;
  /** Só a cor do texto — para o modo navegação, que usa link sobre fundo claro. */
  corTexto: string;
}

export const NUMEROS_EMERGENCIA: readonly NumeroEmergencia[] = [
  {
    numero: '193',
    nome: 'Bombeiros',
    quando: 'Salvamento na água — o primeiro a chamar',
    cor: 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30',
    corTexto: 'text-rose-300',
  },
  {
    numero: '185',
    nome: 'Marinha',
    quando: 'Resgate em mar aberto (Salvamar)',
    cor: 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30',
    corTexto: 'text-amber-300',
  },
  {
    numero: '192',
    nome: 'SAMU',
    quando: 'Já em terra, atendimento médico',
    cor: 'bg-sky-600 hover:bg-sky-500 shadow-sky-600/30',
    corTexto: 'text-sky-300',
  },
  {
    numero: '190',
    nome: 'Polícia',
    quando: 'Não sabe para quem ligar — eles redirecionam',
    cor: 'bg-slate-600 hover:bg-slate-500 shadow-slate-600/30',
    corTexto: 'text-slate-300',
  },
] as const;

/** Os dois primeiros: usados onde o espaço é curto (erro de rede, barra fixa). */
export const NUMEROS_PRIORITARIOS = NUMEROS_EMERGENCIA.slice(0, 2);

/**
 * Texto exibido quando o POST /api/sos não sai (sem rede, servidor fora).
 *
 * Diz explicitamente que a comunidade NÃO foi avisada — meia verdade aqui custa
 * vida: o velejador poderia esperar ajuda que nunca foi acionada. Quem exibe
 * este texto deve mostrar os botões de discagem ao lado.
 */
export const TEXTO_FALHA_REDE =
  'Não conseguimos avisar a comunidade. Ligue para a autoridade agora.';

/**
 * Monta a mensagem que o velejador manda para o contato de emergência.
 *
 * Texto pronto para WhatsApp/SMS: quem recebe precisa entender em um olhar e
 * conseguir repassar a posição para a autoridade por telefone. Por isso a
 * coordenada aparece também em números, não só no link — quem está no 193 vai
 * pedir "me passa a latitude".
 */
export function mensagemDeSocorro(args: {
  nome: string;
  lat: number | null;
  lng: number | null;
  spotNome: string | null;
}): string {
  const linhas = [`🆘 SOS KiteNinja — ${args.nome} precisa de ajuda!`];

  if (args.lat !== null && args.lng !== null) {
    linhas.push(`📍 ${args.lat.toFixed(5)}, ${args.lng.toFixed(5)}`);
    linhas.push(`🗺️ https://maps.google.com/?q=${args.lat},${args.lng}`);
  } else {
    linhas.push('📍 Posição NÃO confirmada (sem GPS no momento do pedido).');
  }

  if (args.spotNome) linhas.push(`🏖️ Perto de: ${args.spotNome}`);
  linhas.push('☎️ Acione 193 (Bombeiros) ou 185 (Marinha).');

  return linhas.join('\n');
}
