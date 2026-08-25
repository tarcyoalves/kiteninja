package br.com.kiteninja.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
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
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Foreground Service para rastreamento de downwind com o app fechado.
 *
 * Este serviço coleta a localização do usuário a cada 45 segundos (mesma cadência
 * do beacon web) e a envia para o servidor. Continua funcionando mesmo quando o
 * app é removido dos recentes.
 *
 * O serviço é iniciado pelo app web quando o usuário inicia um downwind em primeiro
 * plano. O token de autenticação é recebido via FCM.
 *
 * Limitações:
 * - Não funciona após force-stop do app (padrão do Android)
 * - Pode ser morto por fabricantes agressivos (Xiaomi, Samsung, etc)
 * - Requer que o app esteja em primeiro plano ao iniciar
 */
public class RastreioDownwindService extends Service {

    private static final String TAG = "RastreioDownwindService";
    private static final String CHANNEL_ID = "rastreio_downwind";
    private static final int NOTIFICATION_ID = 1001;

    // Intervalo de coleta de GPS (45 segundos, mesma cadência do beacon web)
    private static final long LOCATION_INTERVAL_MS = 45_000;
    private static final long FASTEST_INTERVAL_MS = 30_000;

    // Rede de segurança independente do FCM: nenhuma travessia dura mais que
    // isso, então o serviço se desliga sozinho mesmo se a mensagem de
    // encerramento (FCM) se perder — o cenário exatamente descrito no plano
    // como "o serviço nunca ficar preso caso a mensagem se perca". Sem este
    // teto, um downwind cujo FCM de encerramento falhar deixaria o GPS e a
    // notificação ligados indefinidamente, drenando bateria sem propósito.
    private static final long MAX_SERVICE_DURATION_MS = 8 * 60 * 60 * 1000; // 8h

    // Depois de N falhas consecutivas de rede/servidor ao enviar posição, para
    // de tentar. Cobre o caso do token ter sido revogado/expirado (downwind
    // encerrou e o FCM de aviso não chegou) ou o app ter sido desautorizado —
    // continuar batendo num endpoint que sempre rejeita só gasta bateria e
    // dados do usuário sem nenhuma chance de sucesso.
    private static final int MAX_CONSECUTIVE_FAILURES = 10;

    /** Ação enviada pelo plugin/notificação para encerrar o rastreamento. */
    public static final String ACTION_STOP = "ACTION_STOP";
    /** Chaves dos extras do Intent que inicia o serviço (ver DownwindTrackerPlugin). */
    public static final String EXTRA_DOWNWIND_ID = "downwindId";
    public static final String EXTRA_AUTH_TOKEN = "authToken";
    public static final String EXTRA_API_BASE_URL = "apiBaseUrl";

    // Configuração do serviço
    private String downwindId;
    private String authToken;
    private String apiBaseUrl;

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private ExecutorService executor;
    private boolean isRunning = false;
    private int consecutiveFailures = 0;

    private final Handler timeoutHandler = new Handler(Looper.getMainLooper());
    private final Runnable maxDurationRunnable = () -> {
        Log.w(TAG, "Teto de duração atingido (" + MAX_SERVICE_DURATION_MS + "ms). Encerrando por segurança.");
        stopSelfService();
    };

    // Fila local para posições offline
    private final List<PendingLocation> pendingLocations = new ArrayList<>();

    private final IBinder binder = new LocalBinder();

    public class LocalBinder extends Binder {
        public RastreioDownwindService getService() {
            return RastreioDownwindService.this;
        }
    }


    @Override
    public void onCreate() {
        super.onCreate();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        executor = Executors.newSingleThreadExecutor();

        createNotificationChannel();
        setupLocationCallback();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // A notificação (ação "Parar") e o plugin (stopTracking) enviam este
        // Intent para a MESMA instância de serviço que o Android já mantém
        // rodando. Precisa ser verificado antes de qualquer outra coisa: se
        // não checarmos a ação aqui, "Parar" reinicia o rastreamento em vez
        // de encerrá-lo, porque cai direto no startForeground() abaixo.
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelfService();
            return START_NOT_STICKY;
        }

        // Os dados de configuração chegam como extras do Intent, não por uma
        // chamada de método em outra instância — o Android instancia este
        // Service sozinho ao processar startForegroundService(); qualquer
        // `new RastreioDownwindService()` criado fora daqui é descartado e
        // nunca recebe eventos do sistema.
        if (intent != null) {
            String id = intent.getStringExtra(EXTRA_DOWNWIND_ID);
            String token = intent.getStringExtra(EXTRA_AUTH_TOKEN);
            String base = intent.getStringExtra(EXTRA_API_BASE_URL);
            if (id != null) downwindId = id;
            if (token != null) authToken = token;
            if (base != null) apiBaseUrl = base;
        }

        if (downwindId == null || authToken == null || apiBaseUrl == null) {
            Log.e(TAG, "Serviço não configurado. Encerrando.");
            stopSelf();
            return START_NOT_STICKY;
        }

        // Inicia como foreground service com notificação
        Notification notification = buildNotification();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        if (!isRunning) {
            startLocationUpdates();
            isRunning = true;
            consecutiveFailures = 0;
            // Agenda o desligamento de segurança independente do FCM — ver
            // MAX_SERVICE_DURATION_MS. Reagendar aqui (não só no onCreate)
            // garante que um reinício do serviço (START_NOT_STICKY após o
            // sistema matá-lo) também ganhe um teto novo, em vez de herdar
            // um relógio que já tinha zerado.
            timeoutHandler.removeCallbacks(maxDurationRunnable);
            timeoutHandler.postDelayed(maxDurationRunnable, MAX_SERVICE_DURATION_MS);
        }

        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    @Override
    public void onDestroy() {
        stopLocationUpdates();
        isRunning = false;
        timeoutHandler.removeCallbacks(maxDurationRunnable);
        if (executor != null) {
            executor.shutdown();
        }
        super.onDestroy();
    }

    /**
     * Cria o canal de notificação (obrigatório no Android 8+).
     */
    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Rastreamento de Downwind",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Notificação persistente durante o rastreamento de travessia");
        channel.setShowBadge(false);

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    /**
     * Constrói a notificação persistente do foreground service.
     */
    private Notification buildNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Ação para encerrar o rastreamento
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

    /**
     * Configura o callback de localização.
     */
    private void setupLocationCallback() {
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(@NonNull LocationResult locationResult) {
                Location location = locationResult.getLastLocation();
                if (location != null) {
                    Log.d(TAG, "Localização obtida: " + location.getLatitude() + ", " + location.getLongitude());
                    sendLocation(location);
                }
            }
        };
    }

    /**
     * Inicia as atualizações de localização.
     */
    private void startLocationUpdates() {
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Permissão de localização não concedida");
            stopSelf();
            return;
        }

        LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, LOCATION_INTERVAL_MS)
            .setMinUpdateIntervalMillis(FASTEST_INTERVAL_MS)
            .build();

        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            locationCallback,
            Looper.getMainLooper()
        );

        Log.i(TAG, "Atualizações de localização iniciadas");
    }

    /**
     * Para as atualizações de localização.
     */
    private void stopLocationUpdates() {
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
            Log.i(TAG, "Atualizações de localização paradas");
        }
    }

    /**
     * Envia a localização para o servidor.
     */
    private void sendLocation(Location location) {
        executor.execute(() -> {
            try {
                JSONObject json = new JSONObject();
                json.put("lat", location.getLatitude());
                json.put("lng", location.getLongitude());
                json.put("accuracyM", location.getAccuracy());
                // Enviamos o timestamp de quando a posição foi coletada,
                // não de quando está sendo enviada (importante para offline)
                json.put("registradoEm", location.getTime());

                String urlString = apiBaseUrl + "/api/downwind/" + downwindId + "/posicoes";
                URL url = new URL(urlString);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();

                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + authToken);
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);  // 15s - tempo razoável para rede móvil
                conn.setReadTimeout(15000);     // 15s - tempo para resposta do servidor

                try (OutputStream os = conn.getOutputStream()) {
                    byte[] input = json.toString().getBytes(StandardCharsets.UTF_8);
                    os.write(input, 0, input.length);
                }

                int responseCode;
                try {
                    responseCode = conn.getResponseCode();
                } finally {
                    conn.disconnect();  // Sempre desconecta, mesmo em caso de exceção
                }

                if (responseCode == 200 || responseCode == 201) {
                    Log.d(TAG, "Posição enviada com sucesso");
                    consecutiveFailures = 0;
                    // Se havia posições na fila offline, tenta enviar agora
                    flushPendingLocations();
                } else if (responseCode == 401 || responseCode == 403) {
                    // Token revogado/expirado (downwind encerrou e o FCM de
                    // aviso não chegou, ou o token venceu). Retentar é inútil:
                    // esta credencial nunca vai voltar a funcionar. Encerra
                    // já, sem enfileirar — não há como "reenviar depois" uma
                    // posição que nenhum token vai conseguir autenticar.
                    Log.w(TAG, "Token de rastreio inválido (HTTP " + responseCode + "). Encerrando serviço.");
                    stopSelfService();
                } else {
                    Log.w(TAG, "Falha ao enviar posição: " + responseCode);
                    addToPending(location);
                    registrarFalhaEChecarTeto();
                }

            } catch (Exception e) {
                Log.e(TAG, "Erro ao enviar posição", e);
                addToPending(location);
                registrarFalhaEChecarTeto();
            }
        });
    }

    /**
     * Conta falhas consecutivas de envio (rede instável, servidor fora do
     * ar) e encerra o serviço se passar do teto — ver MAX_CONSECUTIVE_FAILURES.
     * Sem isso, uma queda de sinal prolongada mantém o GPS ligado e a fila
     * offline crescendo indefinidamente (até o limite de 100 itens) sem
     * nenhum sinal para quem está em terra de que o rastreio parou de valer.
     */
    private synchronized void registrarFalhaEChecarTeto() {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            Log.w(TAG, consecutiveFailures + " falhas consecutivas. Encerrando serviço.");
            stopSelfService();
        }
    }

    /**
     * Adiciona posição à fila offline.
     */
    private synchronized void addToPending(Location location) {
        if (pendingLocations.size() < 100) { // Limite para não usar muita memória
            pendingLocations.add(new PendingLocation(
                location.getLatitude(),
                location.getLongitude(),
                location.getAccuracy(),
                location.getTime()
            ));
        }
    }

    /**
     * Tenta enviar posições offline que estão na fila.
     */
    private synchronized void flushPendingLocations() {
        if (pendingLocations.isEmpty()) return;

        List<PendingLocation> toSend = new ArrayList<>(pendingLocations);
        pendingLocations.clear();

        for (PendingLocation pending : toSend) {
            try {
                JSONObject json = new JSONObject();
                json.put("lat", pending.lat);
                json.put("lng", pending.lng);
                json.put("accuracyM", pending.accuracy);
                json.put("registradoEm", pending.timestamp);

                String urlString = apiBaseUrl + "/api/downwind/" + downwindId + "/posicoes";
                URL url = new URL(urlString);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();

                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Authorization", "Bearer " + authToken);
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);  // 15s - tempo razoável para rede móvil
                conn.setReadTimeout(15000);     // 15s - tempo para resposta do servidor

                try (OutputStream os = conn.getOutputStream()) {
                    byte[] input = json.toString().getBytes(StandardCharsets.UTF_8);
                    os.write(input, 0, input.length);
                }

                int responseCode;
                try {
                    responseCode = conn.getResponseCode();
                } finally {
                    conn.disconnect();  // Sempre desconecta, mesmo em caso de exceção
                }

                if (responseCode == 200 || responseCode == 201) {
                    Log.d(TAG, "Posição offline enviada");
                } else if (responseCode == 401 || responseCode == 403) {
                    // Mesmo raciocínio de sendLocation(): token morto, nenhum
                    // reenvio vai funcionar. Descarta o restante da fila (não
                    // há para onde mandar) e encerra.
                    Log.w(TAG, "Token de rastreio inválido ao esvaziar fila (HTTP " + responseCode + "). Encerrando serviço.");
                    stopSelfService();
                    return;
                } else {
                    // Se falhar, adiciona de volta
                    pendingLocations.add(pending);
                }

            } catch (Exception e) {
                Log.e(TAG, "Erro ao enviar posição offline", e);
                pendingLocations.add(pending);
                break; // Para não sobrecarregar
            }
        }
    }

    /**
     * Para o serviço (ação da notificação).
     */
    public void stopSelfService() {
        Log.i(TAG, "Encerrando serviço (ação do usuário, FCM, teto de tempo ou token inválido)");
        stopLocationUpdates();
        isRunning = false;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    /**
     * Retorna se o serviço está rodando.
     */
    public boolean isRunning() {
        return isRunning;
    }

    /**
     * Classe auxiliar para posição offline.
     */
    private static class PendingLocation {
        double lat;
        double lng;
        float accuracy;
        long timestamp;

        PendingLocation(double lat, double lng, float accuracy, long timestamp) {
            this.lat = lat;
            this.lng = lng;
            this.accuracy = accuracy;
            this.timestamp = timestamp;
        }
    }
}
