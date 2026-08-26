package br.com.kiteninja.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Binder;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.ResultReceiver;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import br.com.kiteninja.app.tracking.TrackingQueueDatabase;
import br.com.kiteninja.app.tracking.TrackingQueueDatabase.PendingPosition;
import br.com.kiteninja.app.tracking.TrackingRetryPolicy;
import br.com.kiteninja.app.tracking.TrackingStateStore;

/**
 * Foreground Service resiliente para rastreamento de downwind com o app fechado.
 *
 * Características de Resiliência:
 * 1. START_STICKY com recuperação automática do estado persistido em TrackingStateStore.
 * 2. Fila SQLite persistente (TrackingQueueDatabase) que sobrevive a morte do processo e offline prolongado.
 * 3. Drenagem automática e FIFO da fila quando a conectividade é restaurada (ConnectivityManager.NetworkCallback).
 * 4. Backoff exponencial e tolerância a quedas normais de sinal no mar (NÃO encerra por 10 falhas comuns).
 * 5. Encerramento automático apenas em causas estritamente terminais:
 *    - Ação explícita do usuário (botão "Parar" na notificação ou no app).
 *    - Token revogado ou expirado (HTTP 401/403 do backend).
 *    - Teto de segurança de 8 horas baseado no startedAt original.
 * 6. Confirmação explícita de inicialização para o plugin via ResultReceiver.
 */
public class RastreioDownwindService extends Service {

    private static final String TAG = "RastreioDownwindService";
    private static final String CHANNEL_ID = "rastreio_downwind";
    private static final int NOTIFICATION_ID = 1001;

    // Intervalo de coleta de GPS (45s normal, 30s fastest)
    private static final long LOCATION_INTERVAL_MS = 45_000L;
    private static final long FASTEST_INTERVAL_MS = 30_000L;

    // Teto máximo de segurança: 8 horas a partir do startedAt original
    public static final long MAX_SERVICE_DURATION_MS = 8 * 60 * 60 * 1000L; // 8h

    public static final String ACTION_STOP = "ACTION_STOP";
    public static final String EXTRA_DOWNWIND_ID = "downwindId";
    public static final String EXTRA_AUTH_TOKEN = "authToken";
    public static final String EXTRA_API_BASE_URL = "apiBaseUrl";
    public static final String EXTRA_RESULT_RECEIVER = "resultReceiver";

    private TrackingStateStore stateStore;
    private TrackingQueueDatabase queueDb;

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    private ExecutorService executor;
    /** true desde o agendamento até o fim do flush; impede acumular tarefas no executor. */
    private final AtomicBoolean flushScheduledOrRunning = new AtomicBoolean(false);
    private final Handler retryHandler = new Handler(Looper.getMainLooper());
    private long nextFlushAllowedAt = 0L;
    private final Runnable retryFlushRunnable = () -> {
        nextFlushAllowedAt = 0L;
        triggerFlush();
    };
    private boolean isRunning = false;

    private final Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private final Runnable maxDurationRunnable = () -> {
        Log.w(TAG, "Teto de duração de 8 horas atingido. Encerrando serviço por segurança.");
        stopSelfService("duration_limit_reached");
    };

    private final IBinder binder = new LocalBinder();

    public class LocalBinder extends Binder {
        public RastreioDownwindService getService() {
            return RastreioDownwindService.this;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        stateStore = new TrackingStateStore(this);
        queueDb = TrackingQueueDatabase.getInstance(this);

        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        executor = Executors.newSingleThreadExecutor();

        createNotificationChannel();
        setupLocationCallback();
        setupNetworkCallback();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Ação explícita de parada (notificação ou plugin)
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelfService("user_stopped");
            return START_NOT_STICKY;
        }

        ResultReceiver receiver = intent != null ? intent.getParcelableExtra(EXTRA_RESULT_RECEIVER) : null;

        // Atualiza configuração se veio no Intent
        if (intent != null) {
            String id = intent.getStringExtra(EXTRA_DOWNWIND_ID);
            String token = intent.getStringExtra(EXTRA_AUTH_TOKEN);
            String base = intent.getStringExtra(EXTRA_API_BASE_URL);

            if (id != null && token != null && base != null) {
                String previousId = stateStore.isTrackingActive() ? stateStore.getDownwindId() : null;
                if (previousId != null && !previousId.equals(id)) {
                    // Troca atômica de travessia na mesma instância do Service.
                    // Mandar ACTION_STOP antes do novo start criava uma corrida:
                    // a parada antiga podia apagar a configuração recém-salva.
                    stopLocationUpdates();
                    queueDb.clearForDownwind(previousId);
                    isRunning = false;
                }
                stateStore.saveConfig(id, token, base);
            }
        }

        // Se o serviço foi recriado pelo sistema (intent == null ou sem extras), restaura da store
        String downwindId = stateStore.getDownwindId();
        String authToken = stateStore.getAuthToken();
        String apiBaseUrl = stateStore.getApiBaseUrl();

        if (downwindId == null || authToken == null || apiBaseUrl == null || !stateStore.isTrackingActive()) {
            Log.w(TAG, "Serviço iniciado sem configuração ativa válida. Encerrando.");
            if (receiver != null) {
                Bundle b = new Bundle();
                b.putString("error", "Configuração de rastreamento ausente ou inativa.");
                receiver.send(Activity.RESULT_CANCELED, b);
            }
            stopSelf();
            return START_NOT_STICKY;
        }

        // Valida teto de 8 horas baseado no startedAt original
        long startedAt = stateStore.getStartedAt();
        long now = System.currentTimeMillis();
        long elapsed = now - startedAt;
        long remaining = MAX_SERVICE_DURATION_MS - elapsed;

        if (remaining <= 0) {
            Log.w(TAG, "Teto de 8 horas já expirou desde o início do rastreamento (" + elapsed + "ms decorridos).");
            if (receiver != null) {
                Bundle b = new Bundle();
                b.putString("error", "Teto máximo de 8 horas já foi atingido.");
                receiver.send(Activity.RESULT_CANCELED, b);
            }
            stopSelfService("duration_limit_reached");
            return START_NOT_STICKY;
        }

        // Inicia Foreground Service imediatamente com notificação
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // Agenda o timer de segurança para o tempo restante das 8 horas originais
        timeoutHandler.removeCallbacks(maxDurationRunnable);
        timeoutHandler.postDelayed(maxDurationRunnable, remaining);

        if (!isRunning) {
            startLocationUpdates(receiver);
            isRunning = true;
        } else {
            if (receiver != null) {
                receiver.send(Activity.RESULT_OK, null);
            }
            // Dispara tentativa de drenagem da fila existente
            triggerFlush();
        }

        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // App foi removido dos recentes. O serviço DEVE continuar ativo.
        Log.i(TAG, "Activity removida dos recentes. RastreioDownwindService continua em execução.");
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        stopLocationUpdates();
        unregisterNetworkCallback();
        timeoutHandler.removeCallbacks(maxDurationRunnable);
        retryHandler.removeCallbacks(retryFlushRunnable);
        isRunning = false;

        if (executor != null) {
            executor.shutdown();
        }
        super.onDestroy();
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Rastreamento de Downwind",
                NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Notificação persistente durante o rastreamento da travessia");
        channel.setShowBadge(false);

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                notificationIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent stopIntent = new Intent(this, RastreioDownwindService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getService(
                this,
                1,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Rastreando downwind")
                .setContentText("Sua localização está sendo compartilhada com o grupo")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(pendingIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Parar", stopPendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void setupLocationCallback() {
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult locationResult) {
                Location location = locationResult.getLastLocation();
                if (location != null) {
                    onNewLocationCaptured(location);
                }
            }
        };
    }

    private void setupNetworkCallback() {
        try {
            connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (connectivityManager != null) {
                networkCallback = new ConnectivityManager.NetworkCallback() {
                    @Override
                    public void onAvailable(@NonNull Network network) {
                        Log.i(TAG, "Conectividade de rede restabelecida. Disparando drenagem da fila.");
                        triggerFlush();
                    }
                };

                NetworkRequest request = new NetworkRequest.Builder()
                        .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                        .build();

                connectivityManager.registerNetworkCallback(request, networkCallback);
            }
        } catch (Exception e) {
            Log.e(TAG, "Erro ao registrar NetworkCallback", e);
        }
    }

    private void unregisterNetworkCallback() {
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {
            }
            networkCallback = null;
        }
    }

    private void startLocationUpdates(ResultReceiver receiver) {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Permissão de localização não concedida");
            stateStore.recordFailure(0, "Permissão de localização não concedida");
            if (receiver != null) {
                Bundle b = new Bundle();
                b.putString("error", "Permissão de localização não concedida");
                receiver.send(Activity.RESULT_CANCELED, b);
            }
            stopSelfService("permission_missing");
            return;
        }

        LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, LOCATION_INTERVAL_MS)
                .setMinUpdateIntervalMillis(FASTEST_INTERVAL_MS)
                .build();

        fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                Looper.getMainLooper()
        ).addOnSuccessListener(aVoid -> {
            Log.i(TAG, "Registro de atualizações de localização concluído com sucesso");
            if (receiver != null) {
                receiver.send(Activity.RESULT_OK, null);
            }
            triggerFlush();
        }).addOnFailureListener(e -> {
            Log.e(TAG, "Falha ao registrar atualizações de localização", e);
            stateStore.recordFailure(0, "Falha ao registrar GPS: " + e.getMessage());
            if (receiver != null) {
                Bundle b = new Bundle();
                b.putString("error", e.getMessage());
                receiver.send(Activity.RESULT_CANCELED, b);
            }
            stopSelfService("gps_registration_failed");
        });
    }

    private void stopLocationUpdates() {
        if (fusedLocationClient != null && locationCallback != null) {
            try {
                fusedLocationClient.removeLocationUpdates(locationCallback);
                Log.i(TAG, "Atualizações de localização encerradas");
            } catch (Exception ignored) {
            }
        }
    }

    private void onNewLocationCaptured(Location location) {
        String downwindId = stateStore.getDownwindId();
        if (downwindId == null || !stateStore.isTrackingActive()) {
            return;
        }

        long timestamp = location.getTime();
        stateStore.setLastLocationAt(System.currentTimeMillis());

        // Enfileira no SQLite persistente
        long rowId = queueDb.enqueue(
                downwindId,
                location.getLatitude(),
                location.getLongitude(),
                location.getAccuracy(),
                timestamp,
                stateStore
        );

        if (rowId < 0) {
            stateStore.recordFailure(0, "Não foi possível preservar a posição no armazenamento local.");
            Log.e(TAG, "Falha ao persistir posição no SQLite; envio não será tentado sem cópia durável.");
            return;
        }

        Log.d(TAG, "Posição capturada e enfileirada no SQLite (timestamp: " + timestamp + ")");

        // Tenta enviar o lote pendente
        triggerFlush();
    }

    private void triggerFlush() {
        if (executor == null || executor.isShutdown() || !stateStore.isTrackingActive()) return;

        long delayMs = Math.max(0L, nextFlushAllowedAt - System.currentTimeMillis());
        if (delayMs > 0L) {
            retryHandler.removeCallbacks(retryFlushRunnable);
            retryHandler.postDelayed(retryFlushRunnable, delayMs);
            return;
        }

        // Marca antes de enfileirar: chamadas de GPS/conectividade não podem
        // acumular dezenas de no-ops atrás de um HTTP lento no executor único.
        if (!flushScheduledOrRunning.compareAndSet(false, true)) return;

        executor.execute(() -> {
            try {
                flushPendingQueue();
            } finally {
                flushScheduledOrRunning.set(false);
            }
        });
    }

    /**
     * Drena as posições pendentes em FIFO estrito.
     * Interrompe o envio e preserva a fila em caso de erro temporário (aplicando backoff).
     * Encerra o serviço apenas se o token for terminalmente inválido (401/403).
     */
    private void flushPendingQueue() {
        String downwindId = stateStore.getDownwindId();
        String authToken = stateStore.getAuthToken();
        String apiBaseUrl = stateStore.getApiBaseUrl();

        if (downwindId == null || authToken == null || apiBaseUrl == null || !stateStore.isTrackingActive()) {
            return;
        }

        // Verifica se há rede disponível antes de tentar requisições HTTP
        if (!isNetworkAvailable()) {
            Log.d(TAG, "Sem rede ativa no momento. Posições permanecem salvas no SQLite.");
            return;
        }

        // Drena em lotes de até 20 posições
        while (true) {
            List<PendingPosition> batch = queueDb.peekBatch(downwindId, 20);
            if (batch.isEmpty()) {
                break;
            }

            boolean abortBatch = false;

            for (PendingPosition item : batch) {
                int status = sendPositionHttp(item, downwindId, authToken, apiBaseUrl);

                if (TrackingRetryPolicy.isSuccess(status)) {
                    queueDb.delete(item.id);
                    stateStore.recordSuccess(status);
                    nextFlushAllowedAt = 0L;
                } else if (TrackingRetryPolicy.isTerminal(status)) {
                    Log.w(TAG, "Token de rastreio inválido/revogado (HTTP " + status + "). Limpando e encerrando serviço.");
                    stateStore.clearConfig("token_invalid_or_revoked");
                    queueDb.clearForDownwind(downwindId);
                    stopSelfService("token_invalid_or_revoked");
                    return;
                } else {
                    // Qualquer resposta não terminal permanece na fila. Em
                    // especial, 409/422 podem refletir estado transitório do
                    // backend e não autorizam perder pontos localmente.
                    String error = "Falha de envio temporária (HTTP " + status + ")";
                    queueDb.recordAttemptFailure(item.id, error);
                    stateStore.recordFailure(status, error);
                    long backoff = TrackingRetryPolicy.calculateBackoffMs(stateStore.getConsecutiveFailures());
                    nextFlushAllowedAt = System.currentTimeMillis() + backoff;
                    retryHandler.removeCallbacks(retryFlushRunnable);
                    retryHandler.postDelayed(retryFlushRunnable, backoff);
                    Log.w(TAG, "Envio adiado por " + backoff + "ms após HTTP " + status + ".");
                    abortBatch = true;
                    break;
                }
            }

            if (abortBatch) {
                break;
            }
        }
    }

    /**
     * Executa o POST HTTP de uma posição.
     */
    private int sendPositionHttp(PendingPosition item, String downwindId, String authToken, String apiBaseUrl) {
        stateStore.recordSendAttempt(System.currentTimeMillis());
        HttpURLConnection conn = null;
        PowerManager.WakeLock wakeLock = null;
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        getPackageName() + ":tracking-upload"
                );
                // A soma dos timeouts HTTP é 30s; 35s evita lock órfão mesmo
                // se o fluxo de exceção falhar antes do finally.
                wakeLock.acquire(35_000L);
            }

            JSONObject json = new JSONObject();
            json.put("lat", item.lat);
            json.put("lng", item.lng);
            json.put("accuracyM", item.accuracyM);
            json.put("registradoEm", item.registradoEm);

            String urlString = apiBaseUrl + "/api/downwind/" + downwindId + "/posicoes";
            URL url = new URL(urlString);
            conn = (HttpURLConnection) url.openConnection();

            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + authToken);
            conn.setDoOutput(true);
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(15_000);

            try (OutputStream os = conn.getOutputStream()) {
                byte[] input = json.toString().getBytes(StandardCharsets.UTF_8);
                os.write(input, 0, input.length);
            }

            return conn.getResponseCode();
        } catch (Exception e) {
            Log.w(TAG, "Exceção de rede ao enviar posição: " + e.getMessage());
            return -1;
        } finally {
            if (conn != null) {
                try {
                    conn.disconnect();
                } catch (Exception ignored) {
                }
            }
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        }
    }

    private boolean isNetworkAvailable() {
        if (connectivityManager == null) return false;
        try {
            Network activeNetwork = connectivityManager.getActiveNetwork();
            if (activeNetwork == null) return false;
            NetworkCapabilities caps = connectivityManager.getNetworkCapabilities(activeNetwork);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) {
            return false;
        }
    }

    public void stopSelfService(String reason) {
        Log.i(TAG, "Encerrando RastreioDownwindService. Motivo: " + reason);
        stopLocationUpdates();
        unregisterNetworkCallback();
        timeoutHandler.removeCallbacks(maxDurationRunnable);
        retryHandler.removeCallbacks(retryFlushRunnable);
        isRunning = false;

        String activeDownwindId = stateStore.getDownwindId();
        if (activeDownwindId != null) {
            // Toda chamada a este método representa parada explícita/terminal.
            // onDestroy(), usado numa morte recuperável do processo, NÃO passa
            // aqui e portanto preserva configuração e fila para START_STICKY.
            queueDb.clearForDownwind(activeDownwindId);
        }
        stateStore.clearConfig(reason);

        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }
}