package com.crypto.platform.market;

import jakarta.enterprise.context.ApplicationScoped;
import org.jboss.logging.Logger;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Map;

@ApplicationScoped
public class BinanceOrderService {

    private static final Logger LOG = Logger.getLogger(BinanceOrderService.class);
    private static final String BASE_URL = "https://api.binance.com";

    private final HttpClient http = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build();

    public record OrderResult(boolean success, String orderId, String status, String message) {}

    /**
     * Ejecuta una orden de mercado en Binance.
     * @param apiKey     API Key de Binance del usuario (texto plano, ya descifrado)
     * @param secretKey  Secret Key de Binance del usuario (texto plano, ya descifrado)
     * @param symbol     Ej: BTCUSDT
     * @param side       BUY o SELL
     * @param quoteQty   Cantidad en USDT (quoteOrderQty para órdenes de mercado)
     */
    public OrderResult executeMarketOrder(String apiKey, String secretKey,
                                          String symbol, String side, double quoteQty) {
        try {
            long timestamp = System.currentTimeMillis();

            String params = String.format(
                "symbol=%s&side=%s&type=MARKET&quoteOrderQty=%.2f&timestamp=%d",
                URLEncoder.encode(symbol, StandardCharsets.UTF_8),
                URLEncoder.encode(side, StandardCharsets.UTF_8),
                quoteQty,
                timestamp
            );

            String signature = hmacSha256(secretKey, params);
            String fullParams = params + "&signature=" + signature;

            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(BASE_URL + "/api/v3/order?" + fullParams))
                .timeout(Duration.ofSeconds(10))
                .header("X-MBX-APIKEY", apiKey)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.noBody())
                .build();

            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 200 || response.statusCode() == 201) {
                LOG.infof("Orden Binance ejecutada: %s %s %.2f USDT", side, symbol, quoteQty);
                return new OrderResult(true, extractField(response.body(), "orderId"), "FILLED", "Orden ejecutada en Binance");
            } else {
                String msg = extractField(response.body(), "msg");
                LOG.warnf("Error Binance al ejecutar orden: %s (HTTP %d)", msg, response.statusCode());
                return new OrderResult(false, null, "REJECTED", "Binance rechazó la orden: " + msg);
            }
        } catch (Exception e) {
            LOG.errorf("Excepción al ejecutar orden Binance: %s", e.getMessage());
            return new OrderResult(false, null, "ERROR", "Error de conexión con Binance: " + e.getMessage());
        }
    }

    /**
     * Verifica que las API keys son válidas consultando /api/v3/account
     */
    public boolean validateKeys(String apiKey, String secretKey) {
        try {
            long timestamp = System.currentTimeMillis();
            String params = "timestamp=" + timestamp;
            String signature = hmacSha256(secretKey, params);

            HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(BASE_URL + "/api/v3/account?" + params + "&signature=" + signature))
                .timeout(Duration.ofSeconds(8))
                .header("X-MBX-APIKEY", apiKey)
                .GET()
                .build();

            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            return response.statusCode() == 200;
        } catch (Exception e) {
            return false;
        }
    }

    private String hmacSha256(String secret, String data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(data.getBytes(StandardCharsets.UTF_8)));
    }

    private String extractField(String json, String field) {
        try {
            String search = "\"" + field + "\":";
            int idx = json.indexOf(search);
            if (idx < 0) return "";
            int start = idx + search.length();
            char c = json.charAt(start);
            if (c == '"') {
                int end = json.indexOf('"', start + 1);
                return json.substring(start + 1, end);
            } else {
                int end = json.indexOf(',', start);
                if (end < 0) end = json.indexOf('}', start);
                return json.substring(start, end).trim();
            }
        } catch (Exception e) {
            return "";
        }
    }
}
