package br.com.kiteninja.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import br.com.kiteninja.app.tracking.DownwindTrackerPlugin;

/**
 * A permissão de localização NÃO é solicitada aqui no primeiro launch.
 *
 * DECISÃO: pedir ACCESS_FINE_LOCATION/ACCESS_COARSE_LOCATION assim que o app
 * abre — antes de o usuário saber por quê — é o padrão que mais gera negação
 * permanente ("não perguntar novamente") em pesquisas de UX de permissão.
 * Este app só precisa de localização em dois momentos concretos e tardios:
 * (1) o navegador/WebView pede via navigator.geolocation quando alguém abre
 * o mapa ou o Modo Navegação (o próprio BridgeWebChromeClient do Capacitor
 * cuida disso), e (2) DownwindTrackerPlugin.startTracking() pede via
 * requestPermissionForAlias() no exato instante em que o velejador confirma
 * que vai rastrear uma travessia (ver lib/downwindTracker.ts). Os dois casos
 * já são contextuais por natureza — não há necessidade de um terceiro pedido
 * genérico aqui.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Registrado antes de super.onCreate(): BridgeActivity.onCreate() é
        // quem monta a Bridge e carrega os plugins (initialPlugins). Chamar
        // registerPlugin() depois disso não teria efeito — a lista de plugins
        // já teria sido consumida. Sem isso, Capacitor.Plugins.DownwindTracker
        // não existe do lado JS, mesmo com o plugin compilado no APK.
        registerPlugin(DownwindTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
