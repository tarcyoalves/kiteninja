package br.com.kiteninja.app.tracking;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/**
 * Fila SQLite persistente para posições offline do downwind.
 *
 * Características:
 * - FIFO estrito por timestamp de coleta original (registrado_em ASC, id ASC).
 * - Capacidade máxima segura: 800 posições (~10 horas a 45s/posição).
 * - Sobrevive a encerramento do processo, falta de bateria e reinício do serviço.
 * - Descarte FIFO dos itens mais antigos quando a capacidade máxima for atingida, com telemetria.
 */
public class TrackingQueueDatabase extends SQLiteOpenHelper {

    private static final String TAG = "TrackingQueueDatabase";
    private static final String DATABASE_NAME = "kiteninja_tracking_queue.db";
    private static final int DATABASE_VERSION = 1;

    public static final String TABLE_NAME = "pending_positions";
    public static final String COL_ID = "id";
    public static final String COL_DOWNWIND_ID = "downwind_id";
    public static final String COL_LAT = "lat";
    public static final String COL_LNG = "lng";
    public static final String COL_ACCURACY_M = "accuracy_m";
    public static final String COL_REGISTRADO_EM = "registrado_em";
    public static final String COL_CREATED_AT = "created_at";
    public static final String COL_ATTEMPTS = "attempts";
    public static final String COL_LAST_ERROR = "last_error";

    public static final int MAX_CAPACITY = 800;

    private static TrackingQueueDatabase instance;

    public static synchronized TrackingQueueDatabase getInstance(Context context) {
        if (instance == null) {
            instance = new TrackingQueueDatabase(context.getApplicationContext());
        }
        return instance;
    }

    private TrackingQueueDatabase(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE IF NOT EXISTS " + TABLE_NAME + " (" +
                COL_ID + " INTEGER PRIMARY KEY AUTOINCREMENT, " +
                COL_DOWNWIND_ID + " TEXT NOT NULL, " +
                COL_LAT + " REAL NOT NULL, " +
                COL_LNG + " REAL NOT NULL, " +
                COL_ACCURACY_M + " REAL NOT NULL, " +
                COL_REGISTRADO_EM + " INTEGER NOT NULL, " +
                COL_CREATED_AT + " INTEGER NOT NULL, " +
                COL_ATTEMPTS + " INTEGER NOT NULL DEFAULT 0, " +
                COL_LAST_ERROR + " TEXT" +
                ");");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_pending_downwind ON " + TABLE_NAME + " (" + COL_DOWNWIND_ID + ");");
        db.execSQL("CREATE INDEX IF NOT EXISTS idx_pending_timestamp ON " + TABLE_NAME + " (" + COL_REGISTRADO_EM + ");");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Versão inicial
    }

    /**
     * Enfileira uma nova posição capturada.
     * Se a capacidade máxima for atingida, purga as posições mais antigas e registra o descarte.
     */
    public synchronized long enqueue(
            String downwindId,
            double lat,
            double lng,
            float accuracyM,
            long registradoEm,
            TrackingStateStore stateStore
    ) {
        SQLiteDatabase db = getWritableDatabase();
        try {
            int currentCount = getCount(downwindId);
            if (currentCount >= MAX_CAPACITY) {
                int toDrop = (currentCount - MAX_CAPACITY) + 1;
                dropOldest(db, downwindId, toDrop);
                if (stateStore != null) {
                    stateStore.incrementDroppedCount(toDrop);
                }
                Log.w(TAG, "Capacidade máxima da fila atingida (" + MAX_CAPACITY + "). Descartados " + toDrop + " pontos antigos.");
            }

            ContentValues values = new ContentValues();
            values.put(COL_DOWNWIND_ID, downwindId);
            values.put(COL_LAT, lat);
            values.put(COL_LNG, lng);
            values.put(COL_ACCURACY_M, accuracyM);
            values.put(COL_REGISTRADO_EM, registradoEm);
            values.put(COL_CREATED_AT, System.currentTimeMillis());
            values.put(COL_ATTEMPTS, 0);

            return db.insert(TABLE_NAME, null, values);
        } catch (Exception e) {
            Log.e(TAG, "Erro ao enfileirar posição no SQLite", e);
            return -1L;
        }
    }

    private void dropOldest(SQLiteDatabase db, String downwindId, int count) {
        String sql = "DELETE FROM " + TABLE_NAME + " WHERE " + COL_ID + " IN (" +
                "SELECT " + COL_ID + " FROM " + TABLE_NAME +
                " WHERE " + COL_DOWNWIND_ID + " = ? " +
                " ORDER BY " + COL_REGISTRADO_EM + " ASC, " + COL_ID + " ASC LIMIT " + count + ")";
        db.execSQL(sql, new Object[]{downwindId});
    }

    /**
     * Retorna um lote ordenado por FIFO (mais antigos primeiro) para envio.
     */
    public synchronized List<PendingPosition> peekBatch(String downwindId, int limit) {
        List<PendingPosition> list = new ArrayList<>();
        if (downwindId == null) return list;

        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.query(
                    TABLE_NAME,
                    null,
                    COL_DOWNWIND_ID + " = ?",
                    new String[]{downwindId},
                    null,
                    null,
                    COL_REGISTRADO_EM + " ASC, " + COL_ID + " ASC",
                    String.valueOf(limit)
            );

            while (cursor != null && cursor.moveToNext()) {
                long id = cursor.getLong(cursor.getColumnIndexOrThrow(COL_ID));
                String dwId = cursor.getString(cursor.getColumnIndexOrThrow(COL_DOWNWIND_ID));
                double lat = cursor.getDouble(cursor.getColumnIndexOrThrow(COL_LAT));
                double lng = cursor.getDouble(cursor.getColumnIndexOrThrow(COL_LNG));
                float accuracyM = cursor.getFloat(cursor.getColumnIndexOrThrow(COL_ACCURACY_M));
                long registradoEm = cursor.getLong(cursor.getColumnIndexOrThrow(COL_REGISTRADO_EM));
                long createdAt = cursor.getLong(cursor.getColumnIndexOrThrow(COL_CREATED_AT));
                int attempts = cursor.getInt(cursor.getColumnIndexOrThrow(COL_ATTEMPTS));
                String lastError = cursor.getString(cursor.getColumnIndexOrThrow(COL_LAST_ERROR));

                list.add(new PendingPosition(id, dwId, lat, lng, accuracyM, registradoEm, createdAt, attempts, lastError));
            }
        } catch (Exception e) {
            Log.e(TAG, "Erro ao ler lote da fila SQLite", e);
        } finally {
            if (cursor != null) cursor.close();
        }
        return list;
    }

    /** Registra a falha da cabeça da fila sem removê-la. */
    public synchronized void recordAttemptFailure(long id, String error) {
        try {
            getWritableDatabase().execSQL(
                    "UPDATE " + TABLE_NAME + " SET " + COL_ATTEMPTS + " = " + COL_ATTEMPTS + " + 1, " +
                            COL_LAST_ERROR + " = ? WHERE " + COL_ID + " = ?",
                    new Object[]{error, id}
            );
        } catch (Exception e) {
            Log.e(TAG, "Erro ao registrar tentativa da posição id=" + id, e);
        }
    }

    /** Exclui uma posição da fila após confirmação HTTP 2xx do servidor. */
    public synchronized int delete(long id) {
        try {
            SQLiteDatabase db = getWritableDatabase();
            return db.delete(TABLE_NAME, COL_ID + " = ?", new String[]{String.valueOf(id)});
        } catch (Exception e) {
            Log.e(TAG, "Erro ao deletar posição confirmada id=" + id, e);
            return 0;
        }
    }

    /**
     * Limpa todas as posições de um downwind específico (quando encerrado ou token revogado).
     */
    public synchronized int clearForDownwind(String downwindId) {
        try {
            SQLiteDatabase db = getWritableDatabase();
            return db.delete(TABLE_NAME, COL_DOWNWIND_ID + " = ?", new String[]{downwindId});
        } catch (Exception e) {
            Log.e(TAG, "Erro ao limpar posições do downwind " + downwindId, e);
            return 0;
        }
    }

    /**
     * Retorna a quantidade de posições pendentes para o downwind ativo.
     */
    public synchronized int getCount(String downwindId) {
        if (downwindId == null) return 0;
        SQLiteDatabase db = getReadableDatabase();
        Cursor cursor = null;
        try {
            cursor = db.rawQuery(
                    "SELECT COUNT(*) FROM " + TABLE_NAME + " WHERE " + COL_DOWNWIND_ID + " = ?",
                    new String[]{downwindId}
            );
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getInt(0);
            }
        } catch (Exception e) {
            Log.e(TAG, "Erro ao contar posições na fila", e);
        } finally {
            if (cursor != null) cursor.close();
        }
        return 0;
    }

    public static class PendingPosition {
        public final long id;
        public final String downwindId;
        public final double lat;
        public final double lng;
        public final float accuracyM;
        public final long registradoEm;
        public final long createdAt;
        public final int attempts;
        public final String lastError;

        public PendingPosition(
                long id,
                String downwindId,
                double lat,
                double lng,
                float accuracyM,
                long registradoEm,
                long createdAt,
                int attempts,
                String lastError
        ) {
            this.id = id;
            this.downwindId = downwindId;
            this.lat = lat;
            this.lng = lng;
            this.accuracyM = accuracyM;
            this.registradoEm = registradoEm;
            this.createdAt = createdAt;
            this.attempts = attempts;
            this.lastError = lastError;
        }
    }
}