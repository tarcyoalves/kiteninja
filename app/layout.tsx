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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0F172A" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" },
  ],
};

export const metadata: Metadata = {
  title: "KiteNinja",
  description:
    "Monitora condições de vento, marés e spots de kitesurf em tempo real. Descubra os melhores pontos do litoral, registre suas sessões e acompanhe alertas de segurança.",
  metadataBase: new URL("https://kiteninja.app"),
  openGraph: {
    title: "KiteNinja",
    description:
      "Monitora condições de vento, marés e spots de kitesurf em tempo real no Brasil.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${plusJakarta.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#0F172A] text-slate-100">
        {children}
      </body>
    </html>
  );
}
