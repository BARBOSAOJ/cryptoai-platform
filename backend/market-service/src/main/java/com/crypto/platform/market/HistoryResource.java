package com.crypto.platform.market;

import jakarta.annotation.security.PermitAll;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Path("/history")
@Produces(MediaType.APPLICATION_JSON)
public class HistoryResource {

    private static final Logger LOG = Logger.getLogger(HistoryResource.class);
    private static final String BINANCE_KLINES = "https://api.binance.com/api/v3/klines";
    private static final long CACHE_DURATION_MS = 30_000; // 30s

    private record CachedHistory(List<Double> prices, List<Double> volumes, long timestamp) {}

    private final ConcurrentHashMap<String, CachedHistory> cache = new ConcurrentHashMap<>();
    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();

    @GET
    @Path("/{symbol}")
    @PermitAll
    public Response getHistory(
            @PathParam("symbol") String symbol,
            @QueryParam("limit")    @DefaultValue("100") int limit,
            @QueryParam("interval") @DefaultValue("1m")  String interval) {

        symbol = symbol.toUpperCase().trim();
        int safeLimit = Math.min(Math.max(limit, 10), 500);

        // Caché en memoria
        CachedHistory cached = cache.get(symbol);
        if (cached != null && System.currentTimeMillis() - cached.timestamp < CACHE_DURATION_MS) {
            return Response.ok(buildResponse(symbol, cached.prices, cached.volumes)).build();
        }

        try {
            String url = String.format("%s?symbol=%s&interval=%s&limit=%d",
                BINANCE_KLINES, symbol, interval, safeLimit);

            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .timeout(Duration.ofSeconds(8))
                .GET()
                .build();

            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                LOG.warnf("Binance klines devolvió %d para %s", response.statusCode(), symbol);
                return Response.status(502).entity(Map.of("error", "No se pudo obtener historial de Binance")).build();
            }

            // Parsear JSON manualmente: [[openTime, open, high, low, close, volume, ...], ...]
            String body = response.body().trim();
            List<Double> prices  = new ArrayList<>();
            List<Double> volumes = new ArrayList<>();

            // Parseo simple sin Jackson para arrays anidados
            String[] rows = body.substring(1, body.length() - 1).split("\\],\\[");
            for (String row : rows) {
                String cleaned = row.replace("[", "").replace("]", "");
                String[] fields = cleaned.split(",");
                if (fields.length >= 6) {
                    try {
                        double close  = Double.parseDouble(fields[4].replace("\"", "").trim());
                        double volume = Double.parseDouble(fields[5].replace("\"", "").trim());
                        if (close > 0) {
                            prices.add(close);
                            volumes.add(volume);
                        }
                    } catch (NumberFormatException ignored) {}
                }
            }

            if (prices.isEmpty()) {
                return Response.status(404).entity(Map.of("error", "Sin datos para " + symbol)).build();
            }

            CachedHistory newCache = new CachedHistory(prices, volumes, System.currentTimeMillis());
            cache.put(symbol, newCache);

            return Response.ok(buildResponse(symbol, prices, volumes)).build();

        } catch (Exception e) {
            LOG.errorf("Error obteniendo historial de %s: %s", symbol, e.getMessage());
            return Response.status(503).entity(Map.of("error", "Error de conexión con Binance")).build();
        }
    }

    private Map<String, Object> buildResponse(String symbol, List<Double> prices, List<Double> volumes) {
        return Map.of("symbol", symbol, "prices", prices, "volumes", volumes);
    }
}
