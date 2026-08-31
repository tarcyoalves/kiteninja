import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.kiteninja.app',
  appName: 'KiteNinja',
  webDir: 'mobile-shell',
  server: {
    url: 'https://kiteninja.vercel.app',
    cleartext: false,
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#07111f',
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: {
      // Android 15+ é sempre edge-to-edge. O Capacitor injeta os insets reais
      // em --safe-area-inset-*; o CSS global os consome antes do fallback env().
      insetsHandling: 'css',
      style: 'DARK',
      hidden: false,
    },
  },
};

export default config;
