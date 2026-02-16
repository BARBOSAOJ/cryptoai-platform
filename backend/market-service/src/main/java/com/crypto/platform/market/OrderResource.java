package com.crypto.platform.portfolio;

import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

@Path("/portfolio")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class OrderResource {

    public static class OrderRequest {
        public String symbol;
        public double size;
        public double price;
        public String type;
    }

    @POST
    @Path("/execute")
    public Response executeOrder(OrderRequest order) {

        System.out.println("Ejecutando orden: " + order.type + " " + order.size + " " + order.symbol);

        return Response.ok("{\"status\": \"SUCCESS\", \"message\": \"Orden ejecutada correctamente\"}").build();
    }
}