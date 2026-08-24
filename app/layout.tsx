import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  /*
   * Precisa ser IGUAL a --app-bg do globals.css (#0F172A). Estava #0B1220, um
   * tom diferente do que o app realmente pinta: no iOS instalado o theme-color
   * é usado nas áreas de chrome, então a divergência aparecia como faixa de
   * outra cor. Se mudar --app-bg, mude aqui — app/globals.layout.test.ts checa.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0F172A" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" },
  ],
};

/**
 * Domínio real do app. Estava apontando para "kiteninja.app", que não é nosso —
 * isso fazia as URLs absolutas de Open Graph nascerem erradas e a prévia do link
 * quebrar quando o app é compartilhado no WhatsApp.
 */
const SITE_URL = process.env.APP_URL ?? "https://kiteninja.vercel.app";

export const metadata: Metadata = {
  title: "KiteNinja",
  description:
    "Monitora condições de vento, marés e spots de kitesurf em tempo real. Descubra os melhores pontos do litoral, registre suas sessões e acompanhe alertas de segurança.",
  metadataBase: new URL(SITE_URL),
  applicationName: "KiteNinja",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/brand/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/brand/logo-192.png", type: "image/png", sizes: "192x192" },
    ],
    // O iOS ignora o manifest para o ícone do atalho e usa só este.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "KiteNinja",
    /*
     * NÃO volte para "black-translucent". Ele foi a causa REAL da "tarja
     * escura no rodapé" que sobreviveu a sete tentativas de correção
     * (ver docs/DEBUG-TARJA-RODAPE.md).
     *
     * O que ele deveria fazer: deixar a barra de status transparente e dar ao
     * app a tela inteira, com o conteúdo passando por baixo dela.
     *
     * O que o iOS faz de verdade: dimensiona a janela como *tela menos a
     * altura da barra de status*, mas posiciona essa janela em y=0 — então a
     * diferença sobra como uma faixa no RODAPÉ, fora da página. Medido no
     * aparelho do dono (iPhone 16 Pro Max) com o painel de diagnóstico que
     * existia em components/DiagTela.tsx (removido depois que o bug morreu;
     * está no histórico do git se precisar medir de novo):
     *
     *   screen.height ............ 956px
     *   window.innerHeight ....... 894px
     *   window.screenY ........... 0     (janela colada no topo)
     *   safe-area-inset-top ...... 62px
     *   sobra descoberta embaixo . 62px  <- exatamente a tarja
     *
     * A sobra bate AO PIXEL com o inset superior — é a assinatura do bug. E
     * como esses 62px estão fora da viewport, nenhuma regra de CSS, cor de
     * fundo ou padding pode alcançá-los: era por isso que as correções
     * anteriores (todas dentro da página) não mudavam nada.
     *
     * Com "black" o iOS dimensiona E posiciona a janela corretamente: ela
     * passa a começar abaixo da barra de status e a terminar na base da tela.
     * Não se perde área útil — a janela já era 894px de qualquer forma —, só
     * deixa de sobrar tela descoberta. A barra de status fica opaca; contra o
     * --app-bg (#0F172A, azul-marinho quase preto) a diferença é imperceptível,
     * e o `themeColor` acima já declara essa mesma cor.
     */
    statusBarStyle: "black",
  },
  /*
   * `appleWebApp.capable: true` acima só gera `mobile-web-app-capable`
   * (verificado em node_modules/next/dist/lib/metadata/metadata.js:603-606,
   * Next 16.3.1) — a tag PADRÃO, que o WebKit só passou a honrar a partir do
   * iOS 17.4. Em qualquer iPhone com iOS anterior, SEM a tag legada
   * `apple-mobile-web-app-capable`, o Safari não sabe que deve abrir o ícone
   * da tela de início em modo standalone: ele abre como uma aba comum, com a
   * barra de ferramentas do próprio Safari embaixo. Essa barra — fora da
   * página, imune a qualquer CSS do app — é indistinguível de uma "tarja
   * escura no rodapé" e explica sozinha por que nenhuma correção de cor ou
   * geometria dentro do app jamais a teria afetado.
   *
   * Next.js não expõe essa tag pela API tipada; `other` é o escape hatch
   * documentado para meta tags arbitrárias.
   */
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
  openGraph: {
    title: "KiteNinja",
    description:
      "Monitora condições de vento, marés e spots de kitesurf em tempo real no Brasil.",
    type: "website",
    siteName: "KiteNinja",
    locale: "pt_BR",
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "KiteNinja" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "KiteNinja",
    images: ["/brand/og.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${plusJakarta.variable} h-full antialiased`}>
      {/*
        Sem `bg-*` aqui. A cor vem de `--app-bg` (globals.css), a mesma do
        `.app-shell`. Este `bg-[#0B1220]` foi a razão de a correção de cor do
        commit e53cada não surtir efeito nenhum: utility do Tailwind não está em
        `@layer base`, então vencia o `background-color: var(--app-bg)` do CSS e
        o body continuava num tom diferente do shell — que é exatamente a tarja.
      */}
      <body className="min-h-full flex flex-col text-slate-100">
        {children}
      </body>
    </html>
  );
}
