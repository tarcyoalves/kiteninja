package br.com.kiteninja.app.tracking;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import br.com.kiteninja.app.RastreioDownwindService;

/**
 * Plugin Capacitor para gerenciar o rastreamento de downwind.
 *
 * Permite que o app web (JavaScript) inicie e pare o Foreground Service
 * de rastreamento, e recebe eventos do serviço.
 *
 * Usa o sistema de permissões do Capacitor 8 com @Permission e @PermissionCallback.
 */
@CapacitorPlugin(
    name = "DownwindTracker",
    permissions = {
        @Permission(
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            },
            alias = DownwindTrackerPlugin.LOCATION
        )
    }
)
public class DownwindTrackerPlugin extends Plugin {

    static final String LOCATION = "location";

    private static final String TAG = "DownwindTrackerPlugin";

    // SharedPreferences para estado persistente do tracking (sobrevive a plugin recreation)
    private static final String PREFS_NAME = "downwind_tracker_prefs";
    private static final String KEY_IS_TRACKING = "is_tracking";
    private static final String KEY_DOWNWIND_ID = "downwind_id";

    private String currentDownwindId = null;
    private String currentAuthToken = null;
    private String apiBaseUrl = null;

    @Override
    public void load() {
        Log.i(TAG, "DownwindTrackerPlugin carregado");
    }

    /**
     * Valida a URL base para garantir segurança em produção.
     *
     * Em produção (BuildConfig.DEBUG == false): só aceita https://
     * Em desenvolvimento (debuggable): aceita http://localhost* e http://10.* (rede local)
     */
    private boolean validarBaseUrl(String baseUrl) {
        if (baseUrl == null || baseUrl.isEmpty()) {
            return false;
        }

        try {
            java.net.URL url = new java.net.URL(baseUrl);
            String protocol = url.getProtocol();
            String host = url.getHost();

            // Produção: só HTTPS
            if (!isDebuggable()) {
                return "https".equalsIgnoreCase(protocol);
            }

            // Desenvolvimento: permite HTTP para localhost e redes locais
            if ("http".equalsIgnoreCase(protocol)) {
                // localhost ou IP de rede local (10.x.x.x, 192.168.x.x)
                return "localhost".equalsIgnoreCase(host)
                    || host.matches("^127\\.\\d+\\.\\d+\\.\\d+$")  // 127.x.x.x
                    || host.matches("^10\\.\\d+\\.\\d+\\.\\d+$")  // 10.x.x.x
                    || host.matches("^192\\.168\\.\\d+\\.\\d+$"); // 192.168.x.x
            }

            return "https".equalsIgnoreCase(protocol);
        } catch (Exception e) {
            Log.e(TAG, "Erro ao validar URL: " + baseUrl, e);
            return false;
        }
    }

    /**
     * Verifica se o app está em modo debugável.
     */
    private boolean isDebuggable() {
        return (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /**
     * Salva o estado de tracking no SharedPreferences.
     * Usa SharedPreferences pois sobrevive a plugin recreation.
     */
    private void saveTrackingState(boolean isTracking, String downwindId) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putBoolean(KEY_IS_TRACKING, isTracking)
            .putString(KEY_DOWNWIND_ID, isTracking ? downwindId : null)
            .apply();
    }

    /**
     * Lê o estado de tracking do SharedPreferences.
     * Retorna true se há um tracking ativo persistido.
     */
    private boolean isTrackingPersisted() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_IS_TRACKING, false);
    }

    /**
     * Lê o downwindId persistido.
     */
    private String getPersistedDownwindId() {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_DOWNWIND_ID, null);
    }

    /**
     * Inicia o rastreamento de downwind.
     *
     * Requer que o app esteja em primeiro plano para iniciar o Foreground Service.
     * A permissão de localização é solicitada de forma contextual usando o sistema
     * do Capacitor 8.
     */
    @PluginMethod
    public void startTracking(PluginCall call) {
        String downwindId = call.getString("downwindId");
        String authToken = call.getString("authToken");
        String baseUrl = call.getString("baseUrl");

        if (downwindId == null || authToken == null || baseUrl == null) {
            call.reject("Parâmetros inválidos: downwindId, authToken e baseUrl são obrigatórios");
            return;
        }

        // Valida URL: só aceita https em produção, http apenas para localhost/dev em debug
        if (!validarBaseUrl(baseUrl)) {
            call.reject("URL inválida: use https em produção. HTTP só é permitido para localhost ou quando debuggable.");
            return;
        }

        // Salva os dados para usar no callback de permissão
        this.currentDownwindId = downwindId;
        this.currentAuthToken = authToken;
        this.apiBaseUrl = baseUrl;

        // Verifica permissão de localização usando a API do Capacitor 8
        if (getPermissionState(LOCATION) != PermissionState.GRANTED) {
            // Solicita permissão usando o sistema do Capacitor
            requestPermissionForAlias(LOCATION, call, "onLocationPermissionResult");
            // NÃO chama call.resolve() aqui - o callback faz isso
            return;
        }

        // Já tem permissão, inicia o serviço
        startTrackingService(call);
    }

    /**
     * Callback após a permissão de localização ser concedida.
     * Usa @PermissionCallback conforme Capacitor 8.
     */
    @PermissionCallback
    private void onLocationPermissionResult(PluginCall call) {
        if (getPermissionState(LOCATION) == PermissionState.GRANTED) {
            startTrackingService(call);
        } else {
            call.reject("Permissão de localização negada");
        }
    }

    /**
     * Inicia o Foreground Service de rastreamento.
     */
    private void startTrackingService(PluginCall call) {
        try {
            Intent serviceIntent = new Intent(getContext(), RastreioDownwindService.class);
            // A configuração vai como extras do Intent, não por uma chamada de
            // método: o Android instancia o Service sozinho ao processar
            // startForegroundService(), então uma instância criada aqui com
            // `new RastreioDownwindService()` nunca seria a mesma que roda de
            // fato — RastreioDownwindService.onStartCommand() lê estes extras.
            serviceIntent.putExtra(RastreioDownwindService.EXTRA_DOWNWIND_ID, currentDownwindId);
            serviceIntent.putExtra(RastreioDownwindService.EXTRA_AUTH_TOKEN, currentAuthToken);
            serviceIntent.putExtra(RastreioDownwindService.EXTRA_API_BASE_URL, apiBaseUrl);

            // Inicia o serviço
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(serviceIntent);
            } else {
                getContext().startService(serviceIntent);
            }

            // Salva estado persistente (sobrevive a plugin recreation)
            saveTrackingState(true, currentDownwindId);

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("downwindId", currentDownwindId);
            call.resolve(result);

            Log.i(TAG, "Rastreamento iniciado para downwind: " + currentDownwindId);

        } catch (Exception e) {
            Log.e(TAG, "Erro ao iniciar rastreamento", e);
            call.reject("Erro ao iniciar rastreamento: " + e.getMessage());
        }
    }

    /**
     * Para o rastreamento de downwind.
     */
    @PluginMethod
    public void stopTracking(PluginCall call) {
        try {
            Intent serviceIntent = new Intent(getContext(), RastreioDownwindService.class);
            serviceIntent.setAction(RastreioDownwindService.ACTION_STOP);
            getContext().startService(serviceIntent);

            // Limpa estado persistente
            saveTrackingState(false, null);

            currentDownwindId = null;
            currentAuthToken = null;

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);

            Log.i(TAG, "Rastreamento parado");

        } catch (Exception e) {
            Log.e(TAG, "Erro ao parar rastreamento", e);
            call.reject("Erro ao parar rastreamento: " + e.getMessage());
        }
    }

    /**
     * Verifica se o rastreamento está ativo.
     */
    @PluginMethod
    public void isTracking(PluginCall call) {
        // Fonte de verdade é o serviço realmente rodando (via ActivityManager),
        // não apenas o SharedPreferences: o serviço pode ter se autoencerrado
        // (teto de 8h, token inválido, falhas consecutivas — ver
        // RastreioDownwindService.stopSelfService()) sem que o plugin fosse
        // avisado, o que deixaria o estado persistido obsoleto.
        boolean servicoRodando = isServicoRodando();

        if (!servicoRodando && isTrackingPersisted()) {
            // Autocura: o serviço parou por conta própria, mas o estado
            // persistido ainda dizia "rastreando". Corrige para não reportar
            // um tracking que não existe mais.
            saveTrackingState(false, null);
        }

        JSObject result = new JSObject();
        result.put("isTracking", servicoRodando);
        result.put("downwindId", servicoRodando ? getPersistedDownwindId() : null);
        call.resolve(result);
    }

    /**
     * Verifica se o serviço de rastreamento está rodando.
     */
    private boolean isServicoRodando() {
        android.app.ActivityManager manager = (android.app.ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        for (android.app.ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
            if (RastreioDownwindService.class.getName().equals(service.service.getClassName())) {
                return true;
            }
        }
        return false;
    }

    /**
     * Recebe o token de rastreio do servidor (via FCM ou API).
     *
     * O app web chama este método para passar o token recebido do servidor
     * quando o usuário inicia o downwind.
     */
    @PluginMethod
    public void setAuthToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isEmpty()) {
            call.reject("Token é obrigatório");
            return;
        }

        // O token será usado nas próximas chamadas de localização
        this.currentAuthToken = token;

        JSObject result = new JSObject();
        result.put("success", true);
        call.resolve(result);
    }
}
