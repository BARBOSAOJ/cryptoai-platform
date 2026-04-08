package com.crypto.platform.market.recursos;

import com.crypto.platform.market.entidades.Trade;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Endpoints de estadísticas avanzadas del portfolio.
 * Complementa OrderResource con la curva de equity diaria.
 */
@Path("/portfolio")
@Produces(MediaType.APPLICATION_JSON)
public class RecursoEstadisticas {

    @Inject
    JsonWebToken jwt;

    private String extractUserId() {
        Object idClaim = jwt.getClaim("id");
        if (idClaim != null) return String.valueOf(idClaim);
        String upn = jwt.getName();
        return (upn != null && !upn.isBlank()) ? upn : null;
    }

    /**
     * Devuelve la curva de equity diaria: saldo acumulado agrupado por día.
     * Parte de un saldo inicial de 10 000 USDT y aplica el PnL neto de cada día.
     *
     * @return array de { fecha: "2026-04-01", valor: 10500.0 }
     */
    @GET
    @Path("/equity-curve")
    @RolesAllowed("USER")
    public List<Map<String, Object>> getEquityCurve() {
        String userId = extractUserId();
        List<Trade> trades = Trade.findByUserId(userId);

        if (trades.isEmpty()) {
            return List.of();
        }

        // Agrupar trades por día (UTC)
        Map<LocalDate, List<Trade>> porDia = trades.stream()
            .collect(Collectors.groupingBy(
                t -> t.timestamp.atZone(ZoneOffset.UTC).toLocalDate()
            ));

        // Ordenar días
        List<LocalDate> dias = porDia.keySet().stream()
            .sorted()
            .collect(Collectors.toList());

        // Calcular PnL neto por día (BUY resta, SELL suma al valor total)
        // Usamos el total de cada trade con signo: BUY = gasto, SELL = ingreso
        double saldoAcumulado = 10_000.0;
        List<Map<String, Object>> resultado = new ArrayList<>();

        for (LocalDate dia : dias) {
            double flujoNeto = 0.0;
            for (Trade t : porDia.get(dia)) {
                if ("SELL".equals(t.side)) {
                    flujoNeto += t.total;   // ingreso
                } else {
                    flujoNeto -= t.total;   // gasto
                }
            }
            saldoAcumulado += flujoNeto;

            Map<String, Object> punto = new LinkedHashMap<>();
            punto.put("fecha", dia.toString());
            punto.put("valor", Math.round(saldoAcumulado * 100.0) / 100.0);
            resultado.add(punto);
        }

        return resultado;
    }
}
