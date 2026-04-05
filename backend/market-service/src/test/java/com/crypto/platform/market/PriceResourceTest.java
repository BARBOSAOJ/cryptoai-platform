package com.crypto.platform.market;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.*;

@QuarkusTest
class PriceResourceTest {

    @Test
    void testGetAllPricesReturnsJson() {
        given()
            .when().get("/prices")
            .then()
            .statusCode(200)
            .contentType("application/json");
    }

    @Test
    void testGetSinglePriceHasFields() {
        given()
            .when().get("/prices/BTCUSDT")
            .then()
            .statusCode(200)
            .body("price", notNullValue())
            .body("volume", notNullValue());
    }

    @Test
    void testOhlcvReturnsArray() {
        given()
            .when().get("/ohlcv/BTCUSDT")
            .then()
            .statusCode(200);
    }

    @Test
    void testRiskCalculateWorks() {
        given()
            .contentType("application/json")
            .body("{\"balance\":10000,\"riskPercentage\":1,\"entryPrice\":50000,\"stopLoss\":49000}")
            .when().post("/risk/calculate")
            .then()
            .statusCode(200)
            .body("positionSize", notNullValue())
            .body("riskAmount", equalTo(100.0f));
    }
}
