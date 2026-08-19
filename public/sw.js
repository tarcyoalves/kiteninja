/**
 * Service Worker do KiteNinja — trata notificações push de SOS.
 *
 * Fica em public/ para ser servido na raiz do domínio, o que garante o escopo
 * máximo (controla todas as páginas). O Leaflet e demais assets não passam
 * por aqui: é propositalmente mínimo, só push e click.
 */

/* eslint-disable no-restricted-globals */
// @ts-nocheck — service worker global é `self`, não `window`

self.addEventListener('push', function onPush(event) {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Payload corrompido: melhor ignorar que crashar o SW inteiro.
    return;
  }

  const title = payload.title || 'KiteNinja';
  const options = {
    body: payload.body || '',
    // Tag própria para SOS: não agrupa com alerta de vento ou chat.
    tag: payload.tag || 'kiteninja-geral',
    icon: '/brand/logo-192.png',
    badge: '/brand/favicon-48.png',
    // SOS: fica na tela até o velejador interagir — não some depois de 4s.
    requireInteraction: payload.requireInteraction === true,
    // Vibração em padrão de urgência: longo-curto-longo (SOS em morse é
    // curto-curto-curto / longo-longo-longo, mas este padrão é mais sentido
    // no bolso da lycra).
    vibrate: payload.requireInteraction
      ? [500, 200, 500, 200, 500]
      : [200, 100, 200],
    // Dados para o handler de clique saber para onde navegar.
    data: {
      url: payload.url || '/',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function onClick(event) {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  // Foca na aba existente do KiteNinja, se houver. Se não, abre uma nova.
  // Isso evita abrir 5 abas se o velejador clicar em 5 notificações de SOS.
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});

// Ativa imediatamente sem esperar o próximo reload — em emergência,
// 30 segundos a mais podem fazer diferença.
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
