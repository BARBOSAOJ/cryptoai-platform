package com.crypto.platform.market;

import io.quarkus.vertx.web.RouteFilter;
import io.vertx.ext.web.RoutingContext;

/**
 * Filtro CORS a nivel Vert.x — cubre SSE, errores 4xx/5xx y cualquier
 * respuesta que el ContainerResponseFilter de JAX-RS no alcanza.
 */
public class CorsFilter {

    @RouteFilter(401)
    void cors(RoutingContext rc) {
        String origin = rc.request().getHeader("Origin");
        if (origin != null && !origin.isBlank()) {
            rc.response()
                .putHeader("Access-Control-Allow-Origin",  origin)
                .putHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
                .putHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,Cache-Control")
                .putHeader("Access-Control-Max-Age",       "86400");
        }

        if ("OPTIONS".equalsIgnoreCase(rc.request().method().name())) {
            rc.response().setStatusCode(204).end();
            return;
        }

        rc.next();
    }
}
