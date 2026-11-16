/**
 * "Hoje" no calendário do APARELHO, como AAAA-MM-DD.
 *
 * `new Date().toISOString().split('T')[0]` devolve o dia em UTC. No Brasil
 * (UTC-3), depois das 21h isso já é o dia SEGUINTE: quem registrava o velejo à
 * noite via o campo de data preenchido com amanhã, e o velejo entrava no
 * diário e no feed com a data errada e fora de ordem.
 *
 * Aqui os três números vêm do relógio local — a mesma leitura que
 * `paraPrefillLogbook` (lib/trilhaSessao.ts) já fazia para o caminho do GPS.
 */
export function hojeLocal(agora: Date = new Date()): string {
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}
