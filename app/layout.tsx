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
    // O header do app já é escuro; translucent deixa a barra de status somar
    // com ele em vez de criar uma faixa preta separada.
    statusBarStyle: "black-translucent",
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
      <body className="min-h-full flex flex-col bg-[#0B1220] text-slate-100">
        {children}
      </body>
    </html>
  );
}
