package br.com.kiteninja.app.tracking;

/**
 * Política pura de retentativa, classificação de status HTTP e cálculo de backoff
 * para o rastreamento em segundo plano.
 *
 * Desacoplada do framework Android para permitir testes unitários rápidos e determinísticos.
 */
public final class TrackingRetryPolicy {

    // Limite máximo de backoff entre tentativas quando a rede oscila (60 segundos)
    public static final long MAX_BACKOFF_MS = 60_000L;
    // Backoff inicial após a primeira falha temporária (5 segundos)
    public static final long INITIAL_BACKOFF_MS = 5_000L;

    private TrackingRetryPolicy() {
        // Utilitário estático
    }

    /**
     * Retorna true se o código HTTP indica envio bem-sucedido (2xx).
     */
    public static boolean isSuccess(int httpStatus) {
        return httpStatus >= 200 && httpStatus <= 299;
    }

    /**
     * Retorna true se o erro é TERMINAL e a credencial/downwind nunca mais voltará a funcionar:
     * - HTTP 401/403: credencial inválida/revogada.
     * - HTTP 409: o contrato de /posicoes usa este status exclusivamente quando
     *   a participação ou o próprio downwind já foram encerrados.
     *
     * Nestes casos, retentar é inútil: o serviço deve ser encerrado e a fila daquele
     * downwind descartada para não desperdiçar bateria.
     */
    public static boolean isTerminal(int httpStatus) {
        return httpStatus == 401 || httpStatus == 403 || httpStatus == 409;
    }

    /**
     * Retorna true se a falha é TEMPORÁRIA (deve manter o item na fila persistente e aplicar backoff):
     * - httpStatus <= 0: IOException, timeout de rede, ausência de sinal, DNS indisponível.
     * - HTTP 429: Rate limiting do servidor / proxy.
     * - HTTP 500..599: Erro interno temporário do servidor ou gateway (502/503/504).
     */
    public static boolean isTemporary(int httpStatus) {
        if (httpStatus <= 0) {
            return true;
        }
        if (httpStatus == 429) {
            return true;
        }
        return httpStatus >= 500 && httpStatus <= 599;
    }

    /**
     * Calcula o tempo de espera (backoff exponencial com teto) com base na contagem
     * de falhas consecutivas.
     */
    public static long calculateBackoffMs(int consecutiveFailures) {
        if (consecutiveFailures <= 0) {
            return 0L;
        }
        // 1 falha = 5s, 2 = 10s, 3 = 20s, 4 = 40s, 5+ = 60s
        long factor = 1L << Math.min(consecutiveFailures - 1, 4);
        long delay = INITIAL_BACKOFF_MS * factor;
        return Math.min(delay, MAX_BACKOFF_MS);
    }
}