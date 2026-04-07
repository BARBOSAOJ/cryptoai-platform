package com.crypto.platform.market;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.eclipse.microprofile.reactive.messaging.Channel;
import org.eclipse.microprofile.reactive.messaging.Emitter;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Path("/portfolio")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class OrderResource {

    private static final Logger LOG = Logger.getLogger(OrderResource.class);
    private static final int MAX_TRADE_LIMIT = 200;

    @Inject JsonWebToken jwt;
    @Inject BinanceSocketClient binanceClient;
    @Inject ObjectMapper mapper;
    @Inject BinanceOrderService binanceOrderService;
    @Inject @RestClient UserSettingsClient userSettingsClient;

    @Inject
    @Channel("orders")
    Emitter<String> ordersEmitter;

    // ─── DTOs ────────────────────────────────────────────────────────────────

    public static class OrderRequest {
        public String symbol;
        public double size;
        public double price;
        public String type;
        public String signal;
        public String confidence;
    }

    // ─── Ejecutar orden ──────────────────────────────────────────────────────

    @POST
    @Path("/execute")
    @RolesAllowed("USER")
    @Transactional
    public Response executeOrder(OrderRequest order) {
        if (order == null || order.symbol == null || order.symbol.isBlank()) {
            return Response.status(400).entity(Map.of("error", "El símbolo es obligatorio")).build();
        }
        if (order.size <= 0 || order.price <= 0) {
            return Response.status(400).entity(Map.of("error", "El tamaño y precio deben ser mayores que 0")).build();
        }

        // Usar 'sub' (subject) del JWT para el userId, más fiable que 'name'
        String userId = jwt.getSubject() != null ? jwt.getSubject() : jwt.getName();
        if (userId == null || userId.isBlank()) {
            return Response.status(401).entity(Map.of("error", "Token inválido")).build();
        }

        Trade trade = new Trade();
        trade.userId     = userId;
        trade.symbol     = order.symbol.toUpperCase().trim();
        trade.side       = order.type != null ? order.type.toUpperCase() : "BUY";
        trade.quantity   = order.size;
        trade.entryPrice = order.price;
        trade.total      = order.size * order.price;
        trade.signal     = order.signal;
        trade.confidence = order.confidence;
        trade.timestamp  = Instant.now();
        trade.persist();

        LOG.infof("Trade ejecutado: userId=%s symbol=%s side=%s qty=%.8f price=%.2f",
            userId, trade.symbol, trade.side, trade.quantity, trade.entryPrice);

        // Publicar evento en RabbitMQ (no crítico — fallo no cancela la orden)
        try {
            String event = mapper.writeValueAsString(Map.of(
                "tradeId",   trade.id,
                "userId",    trade.userId,
                "symbol",    trade.symbol,
                "side",      trade.side,
                "quantity",  trade.quantity,
                "price",     trade.entryPrice,
                "total",     trade.total,
                "timestamp", trade.timestamp.toString()
            ));
            ordersEmitter.send(event);
        } catch (Exception e) {
            LOG.warnf("No se pudo publicar evento en RabbitMQ (la orden sigue guardada): %s", e.getMessage());
        }

        return Response.ok(Map.of(
            "tradeId", trade.id,
            "message", "Orden ejecutada y registrada correctamente"
        )).build();
    }

    // ─── Historial de trades (con límite en base de datos) ───────────────────

    @GET
    @Path("/trades")
    @RolesAllowed("USER")
    public List<Trade> getMyTrades(
            @QueryParam("limit")  @DefaultValue("50")  int limit,
            @QueryParam("offset") @DefaultValue("0")   int offset) {
        String userId = jwt.getSubject() != null ? jwt.getSubject() : jwt.getName();
        int safeLimit = Math.min(Math.max(limit, 1), MAX_TRADE_LIMIT);
        int safeOffset = Math.max(offset, 0);
        return Trade.findByUserIdPaged(userId, safeLimit, safeOffset);
    }

    // ─── Ejecutar orden REAL en Binance ──────────────────────────────────────

    public static class RealOrderRequest {
        public String symbol;
        public double quoteQty;  // cantidad en USDT
        public String type;      // BUY o SELL
        public String signal;
        public String confidence;
    }

    @POST
    @Path("/execute-real")
    @RolesAllowed("USER")
    @Transactional
    public Response executeRealOrder(RealOrderRequest order,
            @jakarta.ws.rs.core.Context jakarta.ws.rs.core.HttpHeaders headers) {

        if (order == null || order.symbol == null || order.quoteQty <= 0) {
            return Response.status(400).entity(Map.of("error", "Parámetros inválidos")).build();
        }
        if (order.quoteQty < 5) {
            return Response.status(400).entity(Map.of("error", "La cantidad mínima es 5 USDT")).build();
        }

        String userId = jwt.getSubject() != null ? jwt.getSubject() : jwt.getName();
        String authHeader = headers.getHeaderString("Authorization");

        // Obtener settings del usuario desde user-service
        UserSettingsClient.UserSettingsDTO settings;
        try {
            settings = userSettingsClient.getSettings(authHeader);
        } catch (Exception e) {
            LOG.warnf("No se pudo obtener settings del usuario %s: %s", userId, e.getMessage());
            return Response.status(503).entity(Map.of("error", "No se pudo verificar configuración de trading")).build();
        }

        if (!settings.tradingEnabled()) {
            return Response.status(403).entity(Map.of("error", "El trading real no está activado. Actívalo en Configuración > API Binance")).build();
        }
        if (!settings.hasBinanceKeys()) {
            return Response.status(403).entity(Map.of("error", "Configura tus API Keys de Binance primero")).build();
        }
        if (order.quoteQty > settings.maxOrderSizeUsdt()) {
            return Response.status(400).entity(Map.of("error",
                "La cantidad supera el límite máximo configurado (" + settings.maxOrderSizeUsdt() + " USDT)")).build();
        }

        // Obtener keys descifradas
        UserSettingsClient.BinanceKeysDTO keys;
        try {
            keys = userSettingsClient.getBinanceKeys(authHeader);
        } catch (Exception e) {
            LOG.errorf("No se pudieron obtener keys Binance para %s: %s", userId, e.getMessage());
            return Response.status(503).entity(Map.of("error", "Error al obtener las API Keys")).build();
        }

        String side = order.type != null ? order.type.toUpperCase() : "BUY";
        BinanceOrderService.OrderResult result = binanceOrderService.executeMarketOrder(
            keys.apiKey(), keys.secret(), order.symbol.toUpperCase(), side, order.quoteQty
        );

        // Guardar en BD independientemente del resultado (para auditoría)
        BinanceSocketClient.MarketTick tick = binanceClient.getMarketTick(order.symbol.toUpperCase());
        double price = 0;
        try { price = Double.parseDouble(tick.price); } catch (Exception ignored) {}

        Trade trade = new Trade();
        trade.userId     = userId;
        trade.symbol     = order.symbol.toUpperCase();
        trade.side       = side;
        trade.quantity   = price > 0 ? order.quoteQty / price : 0;
        trade.entryPrice = price;
        trade.total      = order.quoteQty;
        trade.signal     = order.signal;
        trade.confidence = order.confidence;
        trade.timestamp  = Instant.now();
        trade.persist();

        if (!result.success()) {
            return Response.status(422).entity(Map.of(
                "error",   result.message(),
                "tradeId", trade.id,
                "note",    "La orden fue registrada localmente pero no se ejecutó en Binance"
            )).build();
        }

        LOG.infof("Orden real ejecutada: userId=%s %s %s %.2f USDT orderId=%s",
            userId, side, order.symbol, order.quoteQty, result.orderId());

        return Response.ok(Map.of(
            "tradeId",   trade.id,
            "binanceId", result.orderId(),
            "status",    result.status(),
            "message",   result.message()
        )).build();
    }

    // ─── Estadísticas de portfolio ───────────────────────────────────────────

    @GET
    @Path("/stats")
    @RolesAllowed("USER")
    public Map<String, Object> getStats() {
        String userId = jwt.getSubject() != null ? jwt.getSubject() : jwt.getName();
        List<Trade> trades = Trade.findByUserId(userId);

        if (trades.isEmpty()) {
            return Map.of(
                "totalTrades", 0,
                "wins",        0,
                "losses",      0,
                "winRate",     0.0,
                "totalPnl",    0.0,
                "positions",   List.of()
            );
        }

        Map<String, List<Trade>> bySymbol = trades.stream()
            .collect(Collectors.groupingBy(t -> t.symbol));

        long totalPairs = 0;
        long wins = 0;
        double totalPnl = 0.0;
        List<Map<String, Object>> positions = new ArrayList<>();

        for (Map.Entry<String, List<Trade>> entry : bySymbol.entrySet()) {
            String symbol = entry.getKey();
            List<Trade> symbolTrades = entry.getValue();

            List<Trade> buys = symbolTrades.stream()
                .filter(t -> "BUY".equals(t.side))
                .sorted(Comparator.comparing(t -> t.timestamp))
                .collect(Collectors.toList());

            List<Trade> sells = symbolTrades.stream()
                .filter(t -> "SELL".equals(t.side))
                .sorted(Comparator.comparing(t -> t.timestamp))
                .collect(Collectors.toList());

            int pairs = Math.min(buys.size(), sells.size());
            totalPairs += pairs;
            for (int i = 0; i < pairs; i++) {
                double pnl = (sells.get(i).entryPrice - buys.get(i).entryPrice) * buys.get(i).quantity;
                totalPnl += pnl;
                if (pnl > 0) wins++;
            }

            double totalBought = buys.stream().mapToDouble(t -> t.quantity).sum();
            double totalSold   = sells.stream().mapToDouble(t -> t.quantity).sum();
            double netQty = totalBought - totalSold;

            if (netQty > 1e-8) {
                double avgBuyPrice = buys.isEmpty() ? 0 :
                    buys.stream().mapToDouble(t -> t.entryPrice).average().orElse(0);

                double currentPrice;
                try {
                    BinanceSocketClient.MarketTick tick = binanceClient.getMarketTick(symbol);
                    double parsed = Double.parseDouble(tick.price);
                    currentPrice = (parsed > 0) ? parsed : avgBuyPrice;
                } catch (Exception e) {
                    LOG.debugf("No se pudo obtener precio actual para %s: %s", symbol, e.getMessage());
                    currentPrice = avgBuyPrice;
                }

                double pct = avgBuyPrice > 0
                    ? ((currentPrice - avgBuyPrice) / avgBuyPrice) * 100 : 0;

                Map<String, Object> pos = new LinkedHashMap<>();
                pos.put("symbol",       symbol);
                pos.put("coin",         symbol.replace("USDT", ""));
                pos.put("quantity",     Math.round(netQty * 1e8) / 1e8);
                pos.put("avgBuyPrice",  Math.round(avgBuyPrice * 100.0) / 100.0);
                pos.put("currentPrice", Math.round(currentPrice * 100.0) / 100.0);
                pos.put("pct",          Math.round(pct * 100.0) / 100.0);
                pos.put("value",        Math.round(netQty * currentPrice * 100.0) / 100.0);
                positions.add(pos);
            }
        }

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("totalTrades", trades.size());
        stats.put("wins",        wins);
        stats.put("losses",      totalPairs - wins);
        stats.put("winRate",     totalPairs > 0 ? Math.round((wins * 100.0 / totalPairs) * 10) / 10.0 : 0.0);
        stats.put("totalPnl",   Math.round(totalPnl * 100.0) / 100.0);
        stats.put("positions",  positions);
        return stats;
    }
}
