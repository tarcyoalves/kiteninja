import type { NextConfig } from "next";

const buildCommit =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  "local";

const nextConfig: NextConfig = {
  // Congela no bundle o commit que o usuário abriu. A rota /api/version lê o
  // commit do deploy atual; comparar os dois detecta atualização mesmo quando
  // a primeira checagem só acontece depois de um novo deploy.
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: buildCommit,
  },

  /**
   * Cabeçalhos de segurança, em todas as rotas (T05).
   *
   * POR QUE: sem `X-Frame-Options`/`frame-ancestors`, o painel /admin podia ser
   * carregado dentro de um iframe de outro site (clickjacking: induzir o admin
   * a tocar "Suspender" ou "Nova senha" sem ver). E o app carrega tokens na
   * própria URL — /recuperar-senha/<token>, /convite/<token>,
   * /velejo-apoio/<token>, /dw-motorista/<token> — que dependiam do padrão do
   * navegador para não vazar no `Referer`. Conferido: nenhuma tela do app
   * embute página própria em iframe (grep -rni iframe em app, components,
   * views, lib e context volta vazio), então bloquear o enquadramento não
   * tira nada de ninguém, nem o Telão /dw-live.
   *
   * O QUE FICOU DE FORA DE PROPÓSITO: `script-src`, `img-src`, `default-src`.
   * O app carrega tiles de mapa, fontes e imagens do Vercel Blob e roda dentro
   * do WebView do Capacitor (server.url aponta para este site). Uma CSP
   * completa precisa de inventário próprio e quebra coisa em silêncio; aqui só
   * entra a diretiva `frame-ancestors`, que não restringe o que a página
   * carrega, só quem pode enquadrá-la. `X-Frame-Options` fica junto para
   * navegador antigo que não entende `frame-ancestors`.
   *
   * `Permissions-Policy`: geolocalização liberada só para a própria origem,
   * porque é o coração do app (beacon de posição, SOS, mapa).
   *
   * `camera=()` e `microphone=()` foram propostos e TIRADOS na integração. O
   * app não usa getUserMedia, e o seletor de arquivo das fotos não deveria
   * depender desta política — mas isso não foi verificado num aparelho
   * Android, dentro do WebView do Capacitor. O ganho de bloquear uma câmera
   * que o app nunca pede é quase nenhum; o custo de errar seria o velejador
   * não conseguir anexar foto ao velejo. Regra do dono: não quebrar nada.
   * Se alguém confirmar no aparelho que o envio de foto segue funcionando,
   * pode voltar com as duas diretivas.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
