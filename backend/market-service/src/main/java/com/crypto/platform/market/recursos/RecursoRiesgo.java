package com.crypto.platform.market.recursos;

import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.inject.RestClient;
import org.jboss.logging.Logger;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

/**
 * RecursoRiesgo — Gestión de riesgo funcional.
 *
 * POST /risk/calculate  — cálculo local: positionSize, riskAmount, rewardAmount, ratio
 * GET  /risk/live/{symbol} — delega al AI engine /risk/{symbol}?price=X&saldo=Y
 *
 * Implementado para issue #22.
 */
@Path("/risk")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class RecursoRiesgo {

    private static final Logger LOG = Logger.getLogger(RecursoRiesgo.class);

    private static final String AI_ENGINE_URL =
            System.getenv().getOrDefault("AI_ENGINE_URL", "http://localhost:8002");

    // ─── Modelos de datos ─────────────────────────────────────────────────────

    public static class PeticionRiesgo {
        public String symbol;
        public double saldo;
        public double price;
        public double stopLoss;
        public double entry;
        /** Porcentaje de riesgo sobre el saldo (default 1.0) */
        public double riskPercentage = 1.0;
    }

    public static class RespuestaRiesgo {
        public double positionSize;
        public double riskAmount;
        public double rewardAmount;
        public double ratio;

        public RespuestaRiesgo(double positionSize, double riskAmount, double rewardAmount, double ratio) {
            this.positionSize = positionSize;
            this.riskAmount   = riskAmount;
            this.rewardAmount = rewardAmount;
            this.ratio        = ratio;
        }
    }

    // ─── Endpoints ────────────────────────────────────────────────────────────

    /**
     * POST /risk/calculate
     * Recibe {symbol, saldo, price, stopLoss, entry} y calcula tamaño de posición,
     * importe en riesgo, recompensa potencial y ratio R/B.
     */
    @POST
    @Path("/calculate")
    public Response calculate(PeticionRiesgo req) {
        if (req == null) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("{\"error\":\"Cuerpo de la petición vacío\"}").build();
        }

        double entryPrice = req.entry > 0 ? req.entry : req.price;
        double stopPrice  = req.stopLoss;

        if (entryPrice <= 0 || stopPrice <= 0) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("{\"error\":\"entry y stopLoss deben ser > 0\"}").build();
        }

        double riskPct     = req.riskPercentage > 0 ? req.riskPercentage : 1.0;
        double riskAmount  = req.saldo * (riskPct / 100.0);
        double priceDiff   = Math.abs(entryPrice - stopPrice);

        double positionSize  = priceDiff > 0 ? riskAmount / priceDiff : 0.0;
        // Recompensa potencial usando ratio estándar 1.5 (como el AI engine)
        double rewardAmount  = riskAmount * 1.5;
        double ratio         = riskAmount > 0 ? rewardAmount / riskAmount : 0.0;

        return Response.ok(new RespuestaRiesgo(positionSize, riskAmount, rewardAmount, ratio)).build();
    }

    /**
     * GET /risk/live/{symbol}?price=X&saldo=Y
     * Llama al AI engine /risk/{symbol}?price=X&saldo=Y y devuelve el resultado directamente.
     */
    @GET
    @Path("/live/{symbol}")
    public Response live(
            @PathParam("symbol") String symbol,
            @QueryParam("price")  double price,
            @QueryParam("saldo")  @DefaultValue("1000") double saldo
    ) {
        if (price <= 0) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("{\"error\":\"El parámetro price debe ser > 0\"}").build();
        }

        String url = String.format("%s/risk/%s?price=%s&saldo=%s",
                AI_ENGINE_URL, symbol.toUpperCase(), price, saldo);

        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(8))
                    .build();

            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(10))
                    .GET()
                    .build();

            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 200) {
                return Response.ok(response.body())
                        .type(MediaType.APPLICATION_JSON)
                        .build();
            } else {
                LOG.warnf("AI engine devolvió %d para %s", response.statusCode(), symbol);
                return Response.status(response.statusCode())
                        .entity(response.body())
                        .type(MediaType.APPLICATION_JSON)
                        .build();
            }
        } catch (Exception e) {
            LOG.errorf("Error llamando al AI engine para riesgo de %s: %s", symbol, e.getMessage());
            return Response.status(Response.Status.SERVICE_UNAVAILABLE)
                    .entity("{\"error\":\"AI engine no disponible: " + e.getMessage() + "\"}")
                    .build();
        }
    }
}
