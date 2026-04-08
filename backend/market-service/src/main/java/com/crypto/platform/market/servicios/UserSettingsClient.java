package com.crypto.platform.market.servicios;

import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

/**
 * REST Client para comunicación interna con user-service.
 * Obtiene settings y keys Binance descifradas del usuario autenticado.
 */
@RegisterRestClient(configKey = "user-service")
@Path("/user")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public interface UserSettingsClient {

    record UserSettingsDTO(
        boolean tradingEnabled,
        double maxOrderSizeUsdt,
        boolean hasBinanceKeys,
        String theme,
        boolean notificationsEnabled,
        int alertThreshold,
        int defaultInterval,
        String watchlistSymbols
    ) {}

    record BinanceKeysDTO(String apiKey, String secret) {}

    @GET
    @Path("/settings")
    UserSettingsDTO getSettings(@HeaderParam("Authorization") String authHeader);

    @GET
    @Path("/settings/binance-keys-decrypted")
    BinanceKeysDTO getBinanceKeys(@HeaderParam("Authorization") String authHeader);
}
