package com.crypto.platform.market.recursos;

import com.crypto.platform.market.servicios.BinanceSocketClient;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import java.util.List;

@Path("/ohlcv")
@Produces(MediaType.APPLICATION_JSON)
public class OhlcvResource {

    @Inject
    BinanceSocketClient binanceClient;

    @GET
    @Path("/{symbol}")
    public List<BinanceSocketClient.Candle> getCandles(@PathParam("symbol") String symbol) {
        return binanceClient.getCandles(symbol.toUpperCase());
    }
}