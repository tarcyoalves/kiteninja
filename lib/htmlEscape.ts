/**
 * Escapa texto para interpolação segura dentro de HTML.
 *
 * Existe por causa dos marcadores do Leaflet: `L.divIcon({ html })` recebe uma
 * STRING de HTML cru, montada por template string, e é onde o mapa do downwind
 * interpola `users.name` — campo livre, preenchido pelo próprio velejador. Sem
 * escapar, um nome com `<img onerror=...>` viraria execução de script no mapa
 * de todo mundo do grupo.
 *
 * Não usamos `textContent` (que escaparia de graça) porque o `divIcon` do
 * Leaflet não aceita nó do DOM na opção `html` — só string. Então o escape
 * tem que ser explícito, e por isso mora numa função testada em vez de num
 * `.replace()` repetido em cada ícone.
 *
 * `&` vem primeiro de propósito: escapá-lo depois dos outros re-escaparia os
 * `&` que os próprios escapes acabaram de introduzir (`&lt;` viraria
 * `&amp;lt;`).
 */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Iniciais para o marcador de quem não tem foto: uma ou duas letras, sempre já
 * escapadas (o nome é campo livre e entra em `html` do `divIcon` igual ao
 * resto). Nome vazio devolve '?' em vez de string vazia — um marcador sem
 * nenhum caractere vira uma bolinha muda no mapa, e nesse mapa cada bolinha é
 * uma pessoa que alguém pode precisar achar.
 */
export function iniciaisDoNome(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0][0] ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1][0] ?? '') : '';
  return escaparHtml((primeira + ultima).toUpperCase());
}
