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
/**
 * Pede permissão de notificação e registra a inscrição de Web Push no
 * servidor. Lança com mensagem legível em qualquer falha — o chamador
 * decide se mostra na tela (ver components/SidebarDrawer.tsx e
 * components/PermissoesOnboarding.tsx, que usam esta MESMA função em vez de
 * duplicar o fluxo: duas cópias divergindo é como a inscrição volta a
 * quebrar em um dos dois caminhos sem ninguém notar).
 *
 * Devolve `false` quando o usuário NEGA a permissão (caso legítimo, não é
 * erro); lança quando algo de fato falhou.
 */
export async function ativarWebPush(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    throw new Error('Notificações push não são suportadas neste navegador.');
  }

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;

  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapidKey) {
    throw new Error(
      'Chave VAPID pública ausente no build. Confira NEXT_PUBLIC_VAPID_PUBLIC_KEY na Vercel — variáveis NEXT_PUBLIC_* entram no bundle em tempo de BUILD, então mudá-la exige um redeploy.'
    );
  }

  // Reaproveita a inscrição existente quando já houver uma: `subscribe()` num
  // registro que já tem inscrição ativa pode rejeitar, e re-registrar à toa
  // gera endpoint novo (linha duplicada no banco para o mesmo aparelho).
  const existente = await reg.pushManager.getSubscription();
  const sub =
    existente ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      // PRECISA ser Uint8Array, não a string base64url crua — ver
      // urlBase64ToUint8Array abaixo.
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    }));

  const subJson = sub.toJSON();
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
    throw new Error('Inscrição de push veio incompleta do navegador.');
  }

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth: subJson.keys.auth,
    }),
  });
  // Sem checar `ok`, um 4xx/5xx passaria por sucesso: `fetch` só rejeita em
  // falha de rede. Foi assim que a inscrição pareceu funcionar por semanas
  // enquanto o banco seguia vazio.
  if (!res.ok) throw new Error(`Servidor recusou a inscrição (HTTP ${res.status}).`);

  return true;
}

/**
 * Pede a permissão de localização uma vez, de forma explícita.
 *
 * O app já usa `getCurrentPosition`/`watchPosition` em vários pontos
 * (lib/usePositionBeacon.ts, lib/trilhaSessao.ts, lib/useDownwindBeacon.ts) —
 * qualquer um deles dispara o prompt do navegador na primeira vez, mas de
 * forma imprevisível: o velejador recebia o pedido no meio de outra ação,
 * sem contexto de por que o app precisa disso. Pedir aqui, no onboarding,
 * é o mesmo prompt do sistema — só que num momento em que dá para explicar.
 *
 * Resolve `true`/`false` em vez de lançar: permissão negada é decisão
 * legítima do usuário, não erro de programa. O app continua funcionando sem
 * ela (só o SOS e o rastreio ficam cegos, e as telas já avisam isso).
 */
export function pedirLocalizacao(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => resolve(true),
      () => resolve(false),
      // Sem `enableHighAccuracy`: aqui só queremos DISPARAR o prompt e saber
      // a resposta, não obter um fix preciso — quem precisa de precisão
      // (lib/trilhaSessao.ts) pede do seu jeito depois. Alta precisão aqui
      // só acenderia o rádio de GPS à toa e demoraria mais para responder.
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 }
    );
  });
}

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
