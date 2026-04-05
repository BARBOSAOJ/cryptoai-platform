package com.crypto.platform.market;

import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

@Provider
public class RateLimitFilter implements ContainerRequestFilter {

    private static final int MAX_REQUESTS_PER_MINUTE = 120;

    private final ConcurrentHashMap<String, AtomicInteger> counters = new ConcurrentHashMap<>();
    private volatile long windowStart = System.currentTimeMillis();

    @Override
    public void filter(ContainerRequestContext ctx) {
        long now = System.currentTimeMillis();

        // Resetear ventana cada minuto
        if (now - windowStart > 60_000) {
            counters.clear();
            windowStart = now;
        }

        String ip = ctx.getHeaderString("X-Forwarded-For");
        if (ip == null || ip.isBlank()) {
            ip = "unknown";
        } else {
            // X-Forwarded-For puede tener múltiples IPs; tomar la primera
            ip = ip.split(",")[0].trim();
        }

        int count = counters.computeIfAbsent(ip, k -> new AtomicInteger(0)).incrementAndGet();

        if (count > MAX_REQUESTS_PER_MINUTE) {
            ctx.abortWith(Response.status(429)
                .entity("{\"error\":\"Rate limit superado. Máximo 120 peticiones por minuto.\"}")
                .type("application/json")
                .build());
        }
    }
}
