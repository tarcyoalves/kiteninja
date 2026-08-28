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
      'Condição do spot, downwind ao vivo, SOS georreferenciado e comunidade em um só lugar.',
    url: '/conheca',
    images: [{ url: '/brand/og.png', width: 1200, height: 630, alt: 'KiteNinja' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Conheça o KiteNinja',
    description: 'Vento, rota e segurança para quem vive o kitesurf.',
    images: ['/brand/og.png'],
  },
};

export default function ConhecaPage() {
  return <LandingPage />;
}
