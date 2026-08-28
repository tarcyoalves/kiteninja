import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/LandingPage';

export const metadata: Metadata = {
  title: 'Conheça o KiteNinja — Vento, rota e segurança para kitesurf',
  description:
    'Consulte vento e maré, acompanhe o downwind, compartilhe a rota com o apoio e acione SOS com localização.',
  alternates: { canonical: '/conheca' },
  openGraph: {
    title: 'KiteNinja — Entre na água sabendo',
    description:
      'Condição do spot, tracking, downwind, SOS georreferenciado e comunidade em um só lugar.',
    url: '/conheca',
    images: [{ url: '/brand/og.png', width: 1200, height: 630, alt: 'KiteNinja — vento, rota e segurança para kitesurf' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Conheça o KiteNinja',
    description: 'Vento, rota e segurança para quem vive o kitesurf.',
    images: ['/brand/og.png'],
  },
};

const softwareApplicationSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'KiteNinja',
  url: 'https://kiteninja.vercel.app/',
  applicationCategory: 'SportsApplication',
  operatingSystem: 'Web, iOS, Android',
  description:
    'Aplicativo web para consultar condições de kitesurf, acompanhar downwinds, registrar sessões e compartilhar localização com o grupo.',
  inLanguage: 'pt-BR',
};

export default function ConhecaPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationSchema).replace(/</g, '\\u003c') }}
      />
      <LandingPage />
    </>
  );
}
