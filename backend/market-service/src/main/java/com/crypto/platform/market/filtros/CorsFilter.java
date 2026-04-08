package com.crypto.platform.market.filtros;

import io.quarkus.vertx.web.RouteFilter;
import io.vertx.ext.web.RoutingContext;
import org.eclipse.microprofile.config.ConfigProvider;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Filtro CORS a nivel Vert.x — cubre SSE, errores 4xx/5xx y cualquier
 * respuesta que el ContainerResponseFilter de JAX-RS no alcanza.
 * Solo refleja orígenes configurados en CORS_ORIGINS / quarkus.http.cors.origins.
 */
public class CorsFilter {

    @RouteFilter(401)
    void cors(RoutingContext rc) {
        String origin = rc.request().getHeader("Origin");
        if (origin != null && !origin.isBlank()) {
            String raw = ConfigProvider.getConfig()
                    .getOptionalValue("quarkus.http.cors.origins", String.class)
                    .orElse("http://localhost:5173");
            Set<String> allowed = Arrays.stream(raw.split(","))
                    .map(String::trim).collect(Collectors.toSet());

            if (allowed.contains(origin)) {
                rc.response()
                    .putHeader("Access-Control-Allow-Origin",  origin)
                    .putHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
                    .putHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Cache-Control")
                    .putHeader("Access-Control-Max-Age",       "86400");
            }
        }

        if ("OPTIONS".equalsIgnoreCase(rc.request().method().name())) {
            rc.response().setStatusCode(204).end();
            return;
        }

        rc.next();
    }
}
