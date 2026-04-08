package com.crypto.platform.user;

import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.io.IOException;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

@Provider
public class CorsFilter implements ContainerResponseFilter {

    @ConfigProperty(name = "quarkus.http.cors.origins", defaultValue = "http://localhost:5173")
    String allowedOriginsRaw;

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) throws IOException {
        String origin = req.getHeaderString("Origin");
        if (origin == null) return;

        Set<String> allowed = Arrays.stream(allowedOriginsRaw.split(","))
                .map(String::trim).collect(Collectors.toSet());

        if (allowed.contains(origin)) {
            res.getHeaders().putSingle("Access-Control-Allow-Origin",      origin);
            res.getHeaders().putSingle("Access-Control-Allow-Credentials", "true");
            res.getHeaders().putSingle("Access-Control-Allow-Headers",     "origin, content-type, accept, authorization");
            res.getHeaders().putSingle("Access-Control-Allow-Methods",     "GET, POST, PUT, DELETE, OPTIONS, HEAD");
        }
    }
}
