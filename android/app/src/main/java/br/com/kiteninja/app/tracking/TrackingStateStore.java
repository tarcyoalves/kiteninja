package br.com.kiteninja.app.tracking;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.HashMap;
import java.util.Map;

/**
 * Armazenamento persistente seguro para o estado e telemetria do rastreador.
 *
 * Salvo em SharedPreferences privado (Context.MODE_PRIVATE).
 * Excluído do Android Auto Backup via regras de backup XML para preservar a segurança do token.
 *
 * CUIDADOS DE SEGURANÇA:
 * - Nunca logar authToken.
 * - Nunca expor authToken na telemetria ou UI.
 */
public class TrackingStateStore {

    public static final String PREFS_NAME = "kiteninja_tracking_state";

    private static final String KEY_TRACKING_ACTIVE = "tracking_active";
    private static final String KEY_DOWNWIND_ID = "downwind_id";
    private static final String KEY_AUTH_TOKEN = "auth_token";
    private static final String KEY_API_BASE_URL = "api_base_url";
    private static final String KEY_STARTED_AT = "started_at";
    private static final String KEY_LAST_LOCATION_AT = "last_location_at";
    private static final String KEY_LAST_SEND_ATTEMPT_AT = "last_send_attempt_at";
    private static final String KEY_LAST_SUCCESSFUL_SEND_AT = "last_successful_send_at";
    private static final String KEY_LAST_HTTP_STATUS = "last_http_status";
    private static final String KEY_LAST_ERROR = "last_error";
    private static final String KEY_CONSECUTIVE_FAILURES = "consecutive_failures";
    private static final String KEY_DROPPED_COUNT = "dropped_count";
    private static final String KEY_LAST_STOP_REASON = "last_stop_reason";

    private final SharedPreferences prefs;

    public TrackingStateStore(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    /**
     * Salva a configuração de rastreamento e marca como ativo.
     * Se o mesmo downwind já estava ativo, preserva o startedAt original para o teto de 8h.
     */
    public synchronized void saveConfig(String downwindId, String authToken, String baseUrl) {
        long now = System.currentTimeMillis();
        long originalStartedAt = prefs.getLong(KEY_STARTED_AT, 0L);
        String previousId = prefs.getString(KEY_DOWNWIND_ID, null);
        boolean mesmaExecucaoAtiva = prefs.getBoolean(KEY_TRACKING_ACTIVE, false)
                && originalStartedAt > 0
                && downwindId != null
                && downwindId.equals(previousId);

        SharedPreferences.Editor editor = prefs.edit()
                .putBoolean(KEY_TRACKING_ACTIVE, true)
                .putString(KEY_DOWNWIND_ID, downwindId)
                .putString(KEY_AUTH_TOKEN, authToken)
                .putString(KEY_API_BASE_URL, baseUrl)
                .putLong(KEY_STARTED_AT, mesmaExecucaoAtiva ? originalStartedAt : now)
                .putInt(KEY_CONSECUTIVE_FAILURES, 0)
                .putString(KEY_LAST_ERROR, null)
                .putString(KEY_LAST_STOP_REASON, null);

        // Uma nova execução (inclusive do mesmo downwind depois de uma parada)
        // não pode herdar timestamps/contadores da anterior nem o teto de 8h.
        if (!mesmaExecucaoAtiva) {
            editor.putLong(KEY_LAST_LOCATION_AT, 0L)
                    .putLong(KEY_LAST_SEND_ATTEMPT_AT, 0L)
                    .putLong(KEY_LAST_SUCCESSFUL_SEND_AT, 0L)
                    .putInt(KEY_LAST_HTTP_STATUS, 0)
                    .putInt(KEY_DROPPED_COUNT, 0);
        }
        editor.apply();
    }

    public synchronized boolean isTrackingActive() {
        return prefs.getBoolean(KEY_TRACKING_ACTIVE, false);
    }

    public synchronized String getDownwindId() {
        return prefs.getString(KEY_DOWNWIND_ID, null);
    }

    public synchronized String getAuthToken() {
        return prefs.getString(KEY_AUTH_TOKEN, null);
    }

    public synchronized String getApiBaseUrl() {
        return prefs.getString(KEY_API_BASE_URL, null);
    }

    public synchronized long getStartedAt() {
        return prefs.getLong(KEY_STARTED_AT, 0L);
    }

    public synchronized void setLastLocationAt(long timestamp) {
        prefs.edit().putLong(KEY_LAST_LOCATION_AT, timestamp).apply();
    }

    public synchronized void recordSendAttempt(long timestamp) {
        prefs.edit().putLong(KEY_LAST_SEND_ATTEMPT_AT, timestamp).apply();
    }

    public synchronized void recordSuccess(int httpStatus) {
        prefs.edit()
                .putLong(KEY_LAST_SUCCESSFUL_SEND_AT, System.currentTimeMillis())
                .putInt(KEY_LAST_HTTP_STATUS, httpStatus)
                .putInt(KEY_CONSECUTIVE_FAILURES, 0)
                .putString(KEY_LAST_ERROR, null)
                .apply();
    }

    public synchronized void recordFailure(int httpStatus, String error) {
        int failures = prefs.getInt(KEY_CONSECUTIVE_FAILURES, 0) + 1;
        prefs.edit()
                .putInt(KEY_LAST_HTTP_STATUS, httpStatus)
                .putInt(KEY_CONSECUTIVE_FAILURES, failures)
                .putString(KEY_LAST_ERROR, error)
                .apply();
    }

    public synchronized void incrementDroppedCount(int count) {
        int dropped = prefs.getInt(KEY_DROPPED_COUNT, 0) + count;
        prefs.edit().putInt(KEY_DROPPED_COUNT, dropped).apply();
    }

    public synchronized int getConsecutiveFailures() {
        return prefs.getInt(KEY_CONSECUTIVE_FAILURES, 0);
    }

    /**
     * Limpa o token e marca como inativo quando o rastreamento termina legitimamente
     * ou é revogado. Preserva a telemetria diagnóstica para consulta pela UI.
     */
    public synchronized void clearConfig(String stopReason) {
        prefs.edit()
                .putBoolean(KEY_TRACKING_ACTIVE, false)
                .putString(KEY_AUTH_TOKEN, null)
                .putString(KEY_LAST_STOP_REASON, stopReason)
                .apply();
    }

    /**
     * Monta o mapa de telemetria operacional sem vazar segredos nem coordenadas.
     */
    public synchronized Map<String, Object> toTelemetryMap(
            boolean isServiceRunning,
            int pendingCount,
            boolean batteryOptimizationIgnored,
            boolean networkAvailable
    ) {
        Map<String, Object> map = new HashMap<>();
        map.put("isServiceRunning", isServiceRunning);
        map.put("isTrackingConfigured", isTrackingActive());
        map.put("downwindId", isTrackingActive() ? getDownwindId() : null);
        map.put("startedAt", prefs.getLong(KEY_STARTED_AT, 0L));
        map.put("lastLocationAt", prefs.getLong(KEY_LAST_LOCATION_AT, 0L));
        map.put("lastSendAttemptAt", prefs.getLong(KEY_LAST_SEND_ATTEMPT_AT, 0L));
        map.put("lastSuccessfulSendAt", prefs.getLong(KEY_LAST_SUCCESSFUL_SEND_AT, 0L));
        map.put("lastHttpStatus", prefs.getInt(KEY_LAST_HTTP_STATUS, 0));
        map.put("lastError", prefs.getString(KEY_LAST_ERROR, null));
        map.put("pendingCount", pendingCount);
        map.put("consecutiveFailures", prefs.getInt(KEY_CONSECUTIVE_FAILURES, 0));
        map.put("droppedCount", prefs.getInt(KEY_DROPPED_COUNT, 0));
        map.put("lastStopReason", prefs.getString(KEY_LAST_STOP_REASON, null));
        map.put("batteryOptimizationIgnored", batteryOptimizationIgnored);
        map.put("networkAvailable", networkAvailable);
        return map;
    }
}