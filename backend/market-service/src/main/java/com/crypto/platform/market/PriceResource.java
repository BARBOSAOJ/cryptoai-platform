package com.crypto.platform.market;

import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import java.util.Map;

@Path("/prices")
public class PriceResource {

    @Inject
    BinanceSocketClient binanceClient;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Map<String, String> getAllPrices() {
        return binanceClient.getAllPrices();
    }

    @GET
    @Path("/{symbol}")
    @Produces(MediaType.TEXT_PLAIN)
    public String getPrice(@PathParam("symbol") String symbol) {
        String price = binanceClient.getPrice(symbol.toUpperCase());
        return (price != null) ? price : "0.00";
    }
}