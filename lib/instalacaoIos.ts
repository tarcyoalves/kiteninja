/**
 * A decisão de "este aparelho precisa instalar o app para receber push".
 *
 * Isolada aqui, sem tocar em `navigator`, por dois motivos. O primeiro é o de
 * sempre nesta base: a regra que pode estar errada mora numa função pura e
 * testada, e o componente só liga os fios. O segundo é específico do React
 * 19 — ler `navigator.userAgent` ou `matchMedia` durante o render é impuro e
 * não existe no servidor; quem lê essas coisas é `useSyncExternalStore`, que
 * entrega os valores prontos para esta função julgar.
 */

export type AmbienteInstalacao = {
  /** Rodando dentro do app nativo (Capacitor), não no navegador. */
  ehAppNativo: boolean;
  userAgent: string;
  /** `navigator.standalone` — o jeito antigo do iOS de dizer "instalado". */
  standalone: boolean;
  /** `matchMedia('(display-mode: standalone)')` — o jeito padronizado. */
  displayModeStandalone: boolean;
};

/**
 * O iPhone só entrega Web Push quando o site está instalado na tela de
 * início. No Safari comum o botão de ativar notificação existiria mas nunca
 * funcionaria, e o velejador concluiria que o app está quebrado — por isso
 * avisamos antes em vez de deixar tentar.
 *
 * Fora do iOS a resposta é sempre `false`: Android e desktop entregam push no
 * navegador normal, sem instalar nada.
 */
export function precisaInstalarParaPush(amb: AmbienteInstalacao): boolean {
  // No app nativo o push vem pelo FCM, não pelo Web Push do navegador — a
  // pergunta nem se aplica.
  if (amb.ehAppNativo) return false;

  const ehIos = /iPad|iPhone|iPod/.test(amb.userAgent);
  if (!ehIos) return false;

  return !(amb.standalone || amb.displayModeStandalone);
}
