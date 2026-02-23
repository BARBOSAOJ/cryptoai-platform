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
    public Map<String, BinanceSocketClient.MarketTick> getAllPrices() {
        return binanceClient.getAllMarketData();
    }

    @GET
    @Path("/{symbol}")
    @Produces(MediaType.APPLICATION_JSON)
    public BinanceSocketClient.MarketTick getPrice(@PathParam("symbol") String symbol) {
        return binanceClient.getMarketTick(symbol.toUpperCase());
    }
}