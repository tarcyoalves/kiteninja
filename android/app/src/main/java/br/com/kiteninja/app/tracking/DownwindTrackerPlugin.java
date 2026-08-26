package br.com.kiteninja.app.tracking;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.ResultReceiver;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

import br.com.kiteninja.app.RastreioDownwindService;

/**
 * Plugin Capacitor para o rastreamento em segundo plano de downwind.
 *
 * Usa TrackingStateStore e TrackingQueueDatabase como fontes unificadas de verdade.
 * Comunica-se com RastreioDownwindService através de Intents e ResultReceiver.
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

    private TrackingStateStore stateStore;
    private TrackingQueueDatabase queueDb;
    private String pendingDownwindId;
    private String pendingAuthToken;
    private String pendingBaseUrl;

    @Override
    public void load() {
        stateStore = new TrackingStateStore(getContext());
        queueDb = TrackingQueueDatabase.getInstance(getContext());
        Log.i(TAG, "DownwindTrackerPlugin carregado com armazenamento persistente.");
    }

    private boolean validarBaseUrl(String baseUrl) {
        if (baseUrl == null || baseUrl.isEmpty()) {
            return false;
        }

        try {
            java.net.URL url = new java.net.URL(baseUrl);
            String protocol = url.getProtocol();
            String host = url.getHost();

            if (!isDebuggable()) {
                return "https".equalsIgnoreCase(protocol);
            }

            if ("http".equalsIgnoreCase(protocol)) {
                return "localhost".equalsIgnoreCase(host)
                    || host.matches("^127\\.\\d+\\.\\d+\\.\\d+$")
                    || host.matches("^10\\.\\d+\\.\\d+\\.\\d+$")
                    || host.matches("^192\\.168\\.\\d+\\.\\d+$");
            }

            return "https".equalsIgnoreCase(protocol);
        } catch (Exception e) {
            Log.e(TAG, "Erro ao validar URL base: " + baseUrl, e);
            return false;
        }
    }

    private boolean isDebuggable() {
        return (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /**
     * Inicia o rastreamento nativo com confirmação assíncrona do serviço.
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

        if (!validarBaseUrl(baseUrl)) {
            call.reject("URL inválida: use https em produção. HTTP só é permitido para localhost/dev em debug.");
            return;
        }

        // Idempotência: se já está rastreando o mesmo downwind com o serviço ativo, atualiza token e resolve
        if (isServicoRodando() && stateStore.isTrackingActive() && downwindId.equals(stateStore.getDownwindId())) {
            stateStore.saveConfig(downwindId, authToken, baseUrl);
            JSObject result = new JSObject();
            result.put("success", true);
            result.put("downwindId", downwindId);
            result.put("alreadyRunning", true);
            call.resolve(result);
            return;
        }

        if (getPermissionState(LOCATION) != PermissionState.GRANTED) {
            pendingDownwindId = downwindId;
            pendingAuthToken = authToken;
            pendingBaseUrl = baseUrl;
            requestPermissionForAlias(LOCATION, call, "onLocationPermissionResult");
            return;
        }

        startTrackingServiceWithConfirmation(call, downwindId, authToken, baseUrl);
    }

    @PermissionCallback
    private void onLocationPermissionResult(PluginCall call) {
        if (getPermissionState(LOCATION) == PermissionState.GRANTED) {
            String downwindId = pendingDownwindId;
            String authToken = pendingAuthToken;
            String baseUrl = pendingBaseUrl;
            pendingDownwindId = null;
            pendingAuthToken = null;
            pendingBaseUrl = null;

            if (downwindId != null && authToken != null && baseUrl != null) {
                startTrackingServiceWithConfirmation(call, downwindId, authToken, baseUrl);
            } else {
                call.reject("Configuração de rastreamento perdida durante o pedido de permissão.");
            }
        } else {
            pendingDownwindId = null;
            pendingAuthToken = null;
            pendingBaseUrl = null;
            call.reject("Permissão de localização negada");
        }
    }

    private void startTrackingServiceWithConfirmation(
            PluginCall call,
            String downwindId,
            String authToken,
            String baseUrl
    ) {
        try {
            AtomicBoolean resolved = new AtomicBoolean(false);
            Handler mainHandler = new Handler(Looper.getMainLooper());

            ResultReceiver receiver = new ResultReceiver(mainHandler) {
                @Override
                protected void onReceiveResult(int resultCode, Bundle resultData) {
                    if (resolved.compareAndSet(false, true)) {
                        if (resultCode == Activity.RESULT_OK) {
                            JSObject res = new JSObject();
                            res.put("success", true);
                            res.put("downwindId", downwindId);
                            call.resolve(res);
                        } else {
                            String err = resultData != null ? resultData.getString("error") : "Erro desconhecido ao iniciar serviço";
                            call.reject(err);
                        }
                    }
                }
            };

            // Timeout de segurança para não deixar a Promise do JavaScript pendente
            mainHandler.postDelayed(() -> {
                if (resolved.compareAndSet(false, true)) {
                    stateStore.clearConfig("service_start_timeout");
                    Intent stopIntent = new Intent(getContext(), RastreioDownwindService.class);
                    stopIntent.setAction(RastreioDownwindService.ACTION_STOP);
                    getContext().startService(stopIntent);
                    call.reject("Tempo limite esgotado antes da confirmação do GPS.");
                }
            }, 8000L);

            Intent intent = new Intent(getContext(), RastreioDownwindService.class);
            intent.putExtra(RastreioDownwindService.EXTRA_DOWNWIND_ID, downwindId);
            intent.putExtra(RastreioDownwindService.EXTRA_AUTH_TOKEN, authToken);
            intent.putExtra(RastreioDownwindService.EXTRA_API_BASE_URL, baseUrl);
            intent.putExtra(RastreioDownwindService.EXTRA_RESULT_RECEIVER, receiver);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }

            Log.i(TAG, "Solicitação de início do Foreground Service enviada.");

        } catch (Exception e) {
            Log.e(TAG, "Exceção ao iniciar RastreioDownwindService", e);
            // A configuração persistida pertence ao Service. Não a apague aqui:
            // uma tentativa de trocar/iniciar não pode invalidar uma execução
            // anterior que o Android ainda mantém viva.
            call.reject("Falha ao iniciar serviço: " + e.getMessage());
        }
    }

    /**
     * Encerra o rastreamento de downwind de forma explícita.
     */
    @PluginMethod
    public void stopTracking(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), RastreioDownwindService.class);
            intent.setAction(RastreioDownwindService.ACTION_STOP);
            getContext().startService(intent);

            stateStore.clearConfig("user_stopped");

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);

            Log.i(TAG, "Solicitação de parada enviada ao serviço.");
        } catch (Exception e) {
            Log.e(TAG, "Erro ao parar rastreamento", e);
            call.reject("Erro ao parar rastreamento: " + e.getMessage());
        }
    }

    /**
     * Verifica se o rastreamento está ativo no momento.
     */
    @PluginMethod
    public void isTracking(PluginCall call) {
        boolean servicoRodando = isServicoRodando();
        // Não apaga configuração ativa só porque ActivityManager ainda não
        // lista o serviço: durante START_STICKY/recriação existe uma janela em
        // que a configuração persistida é justamente o que permite recuperar.
        boolean trackingAtivo = stateStore.isTrackingActive();

        JSObject result = new JSObject();
        result.put("isTracking", servicoRodando && trackingAtivo);
        result.put("downwindId", (servicoRodando && trackingAtivo) ? stateStore.getDownwindId() : null);
        call.resolve(result);
    }

    /**
     * Retorna a telemetria operacional completa do rastreador (sem dados sensíveis).
     */
    @PluginMethod
    public void getTrackingStatus(PluginCall call) {
        boolean servicoRodando = isServicoRodando();
        String downwindId = stateStore.getDownwindId();
        int pendingCount = queueDb.getCount(downwindId);

        boolean batteryIgnored = false;
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                batteryIgnored = pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            }
        } catch (Exception ignored) {
        }

        boolean networkAvailable = false;
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                android.net.Network active = cm.getActiveNetwork();
                if (active != null) {
                    NetworkCapabilities caps = cm.getNetworkCapabilities(active);
                    networkAvailable = caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
                }
            }
        } catch (Exception ignored) {
        }

        Map<String, Object> telemetry = stateStore.toTelemetryMap(
                servicoRodando,
                pendingCount,
                batteryIgnored,
                networkAvailable
        );

        JSObject result = new JSObject();
        for (Map.Entry<String, Object> entry : telemetry.entrySet()) {
            result.put(entry.getKey(), entry.getValue());
        }

        call.resolve(result);
    }

    /**
     * Abre a tela de configurações do aplicativo / bateria para o usuário escolher 'Sem restrições'.
     */
    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        try {
            Intent intent = new Intent();
            String packageName = getContext().getPackageName();

            // Tenta abrir direto detalhes do aplicativo para bateria
            intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + packageName));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);

            JSObject res = new JSObject();
            res.put("success", true);
            call.resolve(res);
        } catch (Exception e) {
            try {
                // Fallback para configurações gerais de otimização de bateria
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);

                JSObject res = new JSObject();
                res.put("success", true);
                call.resolve(res);
            } catch (Exception ex) {
                Log.e(TAG, "Não foi possível abrir configurações de bateria", ex);
                call.reject("Não foi possível abrir configurações: " + ex.getMessage());
            }
        }
    }

    /**
     * Atualiza o token de autenticação em execução.
     */
    @PluginMethod
    public void setAuthToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isEmpty()) {
            call.reject("Token é obrigatório");
            return;
        }

        String downwindId = stateStore.getDownwindId();
        String baseUrl = stateStore.getApiBaseUrl();
        if (downwindId != null && baseUrl != null) {
            stateStore.saveConfig(downwindId, token, baseUrl);
        }

        JSObject result = new JSObject();
        result.put("success", true);
        call.resolve(result);
    }

    private boolean isServicoRodando() {
        try {
            ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (manager != null) {
                for (ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
                    if (RastreioDownwindService.class.getName().equals(service.service.getClassName())) {
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Erro ao verificar status do serviço", e);
        }
        return false;
    }
}