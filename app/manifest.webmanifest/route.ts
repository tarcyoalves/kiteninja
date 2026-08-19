/**
 * Manifest do PWA — é o que faz "Adicionar à tela de início" virar um atalho
 * com a logo do KiteNinja em vez de um print da página.
 *
 * Servido por rota (e não como arquivo estático) para o Content-Type sair como
 * application/manifest+json; alguns Android ignoram o manifest quando ele vem
 * como text/plain.
 */
export const dynamic = 'force-static';

export function GET() {
  const manifest = {
    name: 'KiteNinja — Vento, Marés e Spots',
    short_name: 'KiteNinja',
    description:
      'Condições de vento, marés e spots de kitesurf em tempo real. Registre seus velejos e acompanhe alertas de segurança.',
    lang: 'pt-BR',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    // standalone remove a barra de endereço: aberto pelo atalho, parece app.
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B1220',
    theme_color: '#0B1220',
    categories: ['sports', 'weather', 'travel'],
    icons: [
      { src: '/brand/logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      /**
       * O Android recorta o ícone em círculo/squircle conforme o launcher. O
       * "maskable" tem folga extra para o emblema não perder as bordas nesse
       * corte — sem ele a logo circular fica com as pontas cortadas.
       */
      { src: '/brand/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Mapa de vento', short_name: 'Mapa', url: '/?tab=mapa' },
      { name: 'Meu logbook', short_name: 'Logbook', url: '/?tab=sessoes' },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
