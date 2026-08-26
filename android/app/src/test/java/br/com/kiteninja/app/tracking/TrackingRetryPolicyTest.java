package br.com.kiteninja.app.tracking;

import org.junit.Test;
import static org.junit.Assert.*;

/**
 * Testes unitários para TrackingRetryPolicy.
 */
public class TrackingRetryPolicyTest {

    @Test
    public void testIsSuccess() {
        assertTrue(TrackingRetryPolicy.isSuccess(200));
        assertTrue(TrackingRetryPolicy.isSuccess(201));
        assertTrue(TrackingRetryPolicy.isSuccess(204));
        assertFalse(TrackingRetryPolicy.isSuccess(400));
        assertFalse(TrackingRetryPolicy.isSuccess(401));
        assertFalse(TrackingRetryPolicy.isSuccess(403));
        assertFalse(TrackingRetryPolicy.isSuccess(500));
        assertFalse(TrackingRetryPolicy.isSuccess(-1));
    }

    @Test
    public void testIsTerminal() {
        assertTrue(TrackingRetryPolicy.isTerminal(401));
        assertTrue(TrackingRetryPolicy.isTerminal(403));
        assertTrue(TrackingRetryPolicy.isTerminal(409));
        assertFalse(TrackingRetryPolicy.isTerminal(200));
        assertFalse(TrackingRetryPolicy.isTerminal(400));
        assertFalse(TrackingRetryPolicy.isTerminal(404));
        assertFalse(TrackingRetryPolicy.isTerminal(429));
        assertFalse(TrackingRetryPolicy.isTerminal(500));
        assertFalse(TrackingRetryPolicy.isTerminal(-1));
    }

    @Test
    public void testIsTemporary() {
        assertTrue(TrackingRetryPolicy.isTemporary(-1));
        assertTrue(TrackingRetryPolicy.isTemporary(0));
        assertTrue(TrackingRetryPolicy.isTemporary(429));
        assertTrue(TrackingRetryPolicy.isTemporary(500));
        assertTrue(TrackingRetryPolicy.isTemporary(502));
        assertTrue(TrackingRetryPolicy.isTemporary(503));
        assertTrue(TrackingRetryPolicy.isTemporary(504));
        assertFalse(TrackingRetryPolicy.isTemporary(200));
        assertFalse(TrackingRetryPolicy.isTemporary(401));
        assertFalse(TrackingRetryPolicy.isTemporary(403));
    }

    @Test
    public void testCalculateBackoffMs() {
        assertEquals(0L, TrackingRetryPolicy.calculateBackoffMs(0));
        assertEquals(5_000L, TrackingRetryPolicy.calculateBackoffMs(1));
        assertEquals(10_000L, TrackingRetryPolicy.calculateBackoffMs(2));
        assertEquals(20_000L, TrackingRetryPolicy.calculateBackoffMs(3));
        assertEquals(40_000L, TrackingRetryPolicy.calculateBackoffMs(4));
        assertEquals(60_000L, TrackingRetryPolicy.calculateBackoffMs(5));
        assertEquals(60_000L, TrackingRetryPolicy.calculateBackoffMs(10));
    }
}