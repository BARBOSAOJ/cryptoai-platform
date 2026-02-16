package com.crypto.platform.market;

import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;

@Path("/risk")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class RiskResource {

    public static class RiskRequest {
        public double balance;
        public double riskPercentage;
        public double entryPrice;
        public double stopLoss;
    }

    public static class RiskResponse {
        public double positionSize;
        public double riskAmount;
    }

    @POST
    @Path("/calculate")
    public RiskResponse calculate(RiskRequest request) {
        RiskResponse response = new RiskResponse();

        double riskUsd = request.balance * (request.riskPercentage / 100);
        double priceDiff = Math.abs(request.entryPrice - request.stopLoss);

        response.riskAmount = riskUsd;
        response.positionSize = (priceDiff > 0) ? (riskUsd / priceDiff) : 0;

        return response;
    }
}