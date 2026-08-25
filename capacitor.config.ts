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
};

export default config;
