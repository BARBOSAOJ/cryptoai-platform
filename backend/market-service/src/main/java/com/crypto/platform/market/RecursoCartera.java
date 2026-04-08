package com.crypto.platform.market;

import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.jboss.logging.Logger;

import java.util.Map;
import java.util.Optional;

@Path("/cartera")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class RecursoCartera {

    private static final Logger LOG = Logger.getLogger(RecursoCartera.class);

    @Inject JsonWebToken jwt;
    @Inject ServicioCartera servicioCartera;

    // ─── DTOs ────────────────────────────────────────────────────────────────

    public static class PeticionCantidad {
        public Double cantidad;
    }

    // ─── Extracción de userId desde JWT ──────────────────────────────────────

    private String extractUserId() {
        Object idClaim = jwt.getClaim("id");
        if (idClaim != null) return String.valueOf(idClaim);
        String upn = jwt.getName();
        return (upn != null && !upn.isBlank()) ? upn : null;
    }

    // ─── GET /cartera ─────────────────────────────────────────────────────────

    @GET
    @RolesAllowed("USER")
    public Response obtenerCartera() {
        String userId = extractUserId();
        if (userId == null) {
            return Response.status(401).entity(Map.of("error", "Token inválido")).build();
        }
        return Response.ok(servicioCartera.obtenerResumen(userId)).build();
    }

    // ─── POST /cartera/depositar ──────────────────────────────────────────────

    @POST
    @Path("/depositar")
    @RolesAllowed("USER")
    @Transactional
    public Response depositar(PeticionCantidad peticion) {
        String userId = extractUserId();
        if (userId == null) {
            return Response.status(401).entity(Map.of("error", "Token inválido")).build();
        }
        if (peticion == null || peticion.cantidad == null || peticion.cantidad <= 0) {
            return Response.status(400).entity(Map.of("error", "La cantidad debe ser mayor que 0")).build();
        }

        CarteraVirtual cartera = servicioCartera.depositar(userId, peticion.cantidad);
        LOG.infof("Depósito realizado: userId=%s cantidad=%.2f", userId, peticion.cantidad);
        return Response.ok(Map.of(
            "mensaje",          "Depósito realizado correctamente",
            "saldoDisponible",  Math.round(cartera.saldoDisponible * 100.0) / 100.0,
            "cantidad",         peticion.cantidad
        )).build();
    }

    // ─── POST /cartera/retirar ────────────────────────────────────────────────

    @POST
    @Path("/retirar")
    @RolesAllowed("USER")
    @Transactional
    public Response retirar(PeticionCantidad peticion) {
        String userId = extractUserId();
        if (userId == null) {
            return Response.status(401).entity(Map.of("error", "Token inválido")).build();
        }
        if (peticion == null || peticion.cantidad == null || peticion.cantidad <= 0) {
            return Response.status(400).entity(Map.of("error", "La cantidad debe ser mayor que 0")).build();
        }

        Optional<CarteraVirtual> resultado = servicioCartera.retirar(userId, peticion.cantidad);
        if (resultado.isEmpty()) {
            return Response.status(400).entity(Map.of(
                "error", "Saldo insuficiente o cartera no encontrada"
            )).build();
        }

        CarteraVirtual cartera = resultado.get();
        LOG.infof("Retiro realizado: userId=%s cantidad=%.2f", userId, peticion.cantidad);
        return Response.ok(Map.of(
            "mensaje",          "Retiro realizado correctamente",
            "saldoDisponible",  Math.round(cartera.saldoDisponible * 100.0) / 100.0,
            "cantidad",         peticion.cantidad
        )).build();
    }
}
