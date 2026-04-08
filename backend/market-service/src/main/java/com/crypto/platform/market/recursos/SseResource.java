package com.crypto.platform.market.recursos;

import com.crypto.platform.market.servicios.BinanceSocketClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.smallrye.mutiny.Multi;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import org.jboss.resteasy.reactive.RestStreamElementType;

import java.time.Duration;

@Path("/sse")
public class SseResource {

    @Inject
    BinanceSocketClient binanceClient;

    @Inject
    ObjectMapper mapper;

    @GET
    @Path("/prices")
    @Produces(MediaType.SERVER_SENT_EVENTS)
    @RestStreamElementType(MediaType.APPLICATION_JSON)
    public Multi<String> streamPrices() {
        return Multi.createFrom().ticks().every(Duration.ofSeconds(1))
            .map(tick -> {
                try {
                    return mapper.writeValueAsString(binanceClient.getAllMarketData());
                } catch (Exception e) {
                    return "{}";
                }
            });
    }
}
