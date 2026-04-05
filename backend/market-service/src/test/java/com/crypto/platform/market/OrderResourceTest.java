package com.crypto.platform.market;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.*;

@QuarkusTest
class OrderResourceTest {

    // Sin JWT → 401
    @Test
    void testExecuteOrderRequiresAuth() {
        given()
            .contentType("application/json")
            .body("{\"symbol\":\"BTCUSDT\",\"size\":0.001,\"price\":50000,\"type\":\"BUY\"}")
            .when().post("/portfolio/execute")
            .then()
            .statusCode(401);
    }

    // Sin JWT → 401 para stats
    @Test
    void testPortfolioStatsRequiresAuth() {
        given()
            .when().get("/portfolio/stats")
            .then()
            .statusCode(401);
    }

    // Sin JWT → 401 para trades
    @Test
    void testPortfolioTradesRequiresAuth() {
        given()
            .when().get("/portfolio/trades")
            .then()
            .statusCode(401);
    }
}
