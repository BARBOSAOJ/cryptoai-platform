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
    @Inject ServicioCartera servicioCartera;

    @Inject
    @Channel("orders")
    Emitter<String> ordersEmitter;

    // ─── Extracción de userId desde JWT ──────────────────────────────────────

    /**
     * El token se genera con .upn(user.email) y .claim("id", user.id).
     * Usamos el claim "id" (clave primaria de BD) como userId canónico.
     * Fallback a upn (email) si "id" no está presente.
     */
    private String extractUserId() {
        Object idClaim = jwt.getClaim("id");
        if (idClaim != null) return String.valueOf(idClaim);
        String upn = jwt.getName();   // upn → getName() en MicroProfile JWT
        return (upn != null && !upn.isBlank()) ? upn : null;
    }

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

        String userId = extractUserId();
        if (userId == null) {
            return Response.status(401).entity(Map.of("error", "Token inválido")).build();
        }

        String side   = order.type != null ? order.type.toUpperCase() : "BUY";
        double importe = order.size * order.price;

        // Validar y actualizar saldo de la cartera virtual
        if ("BUY".equals(side)) {
            boolean saldoOk = servicioCartera.descontarSaldo(userId, importe);
            if (!saldoOk) {
                return Response.status(402).entity(Map.of(
                    "error", "Saldo insuficiente en la cartera virtual. Deposita fondos antes de operar."
                )).build();
            }
        } else if ("SELL".equals(side)) {
            servicioCartera.añadirSaldo(userId, importe);
        }

        Trade trade = new Trade();
        trade.userId     = userId;
        trade.symbol     = order.symbol.toUpperCase().trim();
        trade.side       = side;
        trade.quantity   = order.size;
        trade.entryPrice = order.price;
        trade.total      = importe;
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
        String userId = extractUserId();
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

        String userId = extractUserId();
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
        String userId = extractUserId();
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

        // Mejor trade, peor trade, racha ganadora, días activo
        double mejorTrade = 0.0;
        double peorTrade  = 0.0;
        int rachaGanadora = 0;
        int rachaActual   = 0;
        List<Double> pnlPorPar = new ArrayList<>();

        for (Map.Entry<String, List<Trade>> entry : bySymbol.entrySet()) {
            List<Trade> buys  = entry.getValue().stream().filter(t -> "BUY".equals(t.side))
                .sorted(Comparator.comparing(t -> t.timestamp)).collect(Collectors.toList());
            List<Trade> sells = entry.getValue().stream().filter(t -> "SELL".equals(t.side))
                .sorted(Comparator.comparing(t -> t.timestamp)).collect(Collectors.toList());
            int pairs = Math.min(buys.size(), sells.size());
            for (int i = 0; i < pairs; i++) {
                double pnl = (sells.get(i).entryPrice - buys.get(i).entryPrice) * buys.get(i).quantity;
                pnlPorPar.add(pnl);
            }
        }

        // Ordenar por timestamp para calcular racha correctamente
        // (ya tenemos la lista global de PnL por orden de ejecución; aproximamos con la lista tal cual)
        for (double pnl : pnlPorPar) {
            if (pnl > mejorTrade) mejorTrade = pnl;
            if (pnl < peorTrade)  peorTrade  = pnl;
            if (pnl > 0) {
                rachaActual++;
                if (rachaActual > rachaGanadora) rachaGanadora = rachaActual;
            } else {
                rachaActual = 0;
            }
        }

        // Días distintos con trades
        long diasActivo = trades.stream()
            .map(t -> t.timestamp.atZone(java.time.ZoneOffset.UTC).toLocalDate())
            .distinct().count();

        Map<String, Object> stats = new LinkedHashMap<>();
        stats.put("totalTrades",   trades.size());
        stats.put("wins",          wins);
        stats.put("losses",        totalPairs - wins);
        stats.put("winRate",       totalPairs > 0 ? Math.round((wins * 100.0 / totalPairs) * 10) / 10.0 : 0.0);
        stats.put("totalPnl",      Math.round(totalPnl * 100.0) / 100.0);
        stats.put("positions",     positions);
        stats.put("mejorTrade",    Math.round(mejorTrade * 100.0) / 100.0);
        stats.put("peorTrade",     Math.round(peorTrade  * 100.0) / 100.0);
        stats.put("rachaGanadora", rachaGanadora);
        stats.put("diasActivo",    diasActivo);
        return stats;
    }
}
