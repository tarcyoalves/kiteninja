/**
 * Conversão da chave VAPID pública para o formato que a Push API exige.
 *
 * ISTO ERA O BUG que deixou `push_subscriptions` em ZERO com 9 usuários
 * cadastrados e as chaves corretamente configuradas na Vercel: o
 * `pushManager.subscribe()` recebia `applicationServerKey` como a STRING
 * base64url crua (`process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY`), mas a
 * especificação da Push API exige `BufferSource` — `Uint8Array` ou
 * `ArrayBuffer`. O Safari do iOS rejeita a string e a inscrição falha.
 *
 * Pior: o erro caía num `catch` que só fazia `console.error`, então a
 * interface mostrava "notificações ativadas" (a PERMISSÃO de fato foi
 * concedida) enquanto nenhuma inscrição chegava ao banco. Ninguém tinha como
 * perceber sem olhar o banco — e o SOS dependia disso para funcionar.
 *
 * base64url (o formato da chave VAPID) difere do base64 padrão em dois
 * pontos, ambos tratados aqui: usa `-`/`_` no lugar de `+`/`/`, e omite o
 * padding `=` do fim.
 */
export function urlBase64ToUint8Array(base64UrlString: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64UrlString.length % 4)) % 4);
  const base64 = (base64UrlString + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Buffer explícito em vez de `new Uint8Array(len)`: o tipo padrão é
  // `Uint8Array<ArrayBufferLike>`, que inclui `SharedArrayBuffer` e por isso
  // não satisfaz o `BufferSource` que `applicationServerKey` espera.
  const saida = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) saida[i] = raw.charCodeAt(i);
  return saida;
}
