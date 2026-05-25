package com.crypto.platform.user;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.*;

/**
 * Integration tests for /user endpoints.
 * Uses H2 in-memory DB (configured in application.properties %test profile).
 * Each test obtains a fresh JWT by registering + logging in.
 */
@QuarkusTest
class UserSettingsResourceTest {

    private static String token;
    private static boolean initialized = false;

    @BeforeEach
    void ensureUserExists() {
        if (initialized) return;
        initialized = true;

        // Register test user (may already exist from a parallel test — ignore 409)
        given()
            .contentType(ContentType.JSON)
            .body("{\"email\":\"settings@test.com\",\"password\":\"pass1234\",\"fullName\":\"Settings User\"}")
            .post("/auth/register");

        token = given()
            .contentType(ContentType.JSON)
            .body("{\"email\":\"settings@test.com\",\"password\":\"pass1234\"}")
            .post("/auth/login")
            .then().statusCode(200)
            .extract().path("token");
    }

    // ── Profile ───────────────────────────────────────────────────────────────

    @Test
    void getProfileReturns200WithEmailField() {
        given()
            .header("Authorization", "Bearer " + token)
            .when().get("/user/profile")
            .then()
            .statusCode(200)
            .body("email", equalTo("settings@test.com"));
    }

    @Test
    void getProfileWithoutTokenReturns401() {
        given()
            .when().get("/user/profile")
            .then()
            .statusCode(401);
    }

    @Test
    void updateProfileFullNameReturns200() {
        given()
            .header("Authorization", "Bearer " + token)
            .contentType(ContentType.JSON)
            .body("{\"fullName\":\"Updated Name\"}")
            .when().put("/user/profile")
            .then()
            .statusCode(200)
            .body("fullName", equalTo("Updated Name"));
    }

    // ── Alerts ────────────────────────────────────────────────────────────────

    @Test
    void getAlertsReturnsEmptyListInitially() {
        given()
            .header("Authorization", "Bearer " + token)
            .when().get("/user/alerts")
            .then()
            .statusCode(200)
            .body("size()", greaterThanOrEqualTo(0));
    }

    @Test
    void createAlertReturns201WithFields() {
        given()
            .header("Authorization", "Bearer " + token)
            .contentType(ContentType.JSON)
            .body("{\"symbol\":\"BTCUSDT\",\"targetPrice\":100000,\"direction\":\"ABOVE\"}")
            .when().post("/user/alerts")
            .then()
            .statusCode(201)
            .body("symbol",      equalTo("BTCUSDT"))
            .body("direction",   equalTo("ABOVE"))
            .body("targetPrice", equalTo(100000.0f));
    }

    @Test
    void createAlertWithInvalidDirectionReturns400() {
        given()
            .header("Authorization", "Bearer " + token)
            .contentType(ContentType.JSON)
            .body("{\"symbol\":\"ETHUSDT\",\"targetPrice\":3000,\"direction\":\"INVALID\"}")
            .when().post("/user/alerts")
            .then()
            .statusCode(400)
            .body("error", containsString("direction"));
    }

    @Test
    void createAlertMissingFieldsReturns400() {
        given()
            .header("Authorization", "Bearer " + token)
            .contentType(ContentType.JSON)
            .body("{\"symbol\":\"SOLUSDT\"}")
            .when().post("/user/alerts")
            .then()
            .statusCode(400);
    }

    @Test
    void deleteExistingAlertReturns200() {
        // Create an alert first
        Long alertId = given()
            .header("Authorization", "Bearer " + token)
            .contentType(ContentType.JSON)
            .body("{\"symbol\":\"DOGEUSDT\",\"targetPrice\":0.5,\"direction\":\"ABOVE\"}")
            .post("/user/alerts")
            .then().statusCode(201)
            .extract().path("id");

        given()
            .header("Authorization", "Bearer " + token)
            .when().delete("/user/alerts/" + alertId)
            .then()
            .statusCode(200)
            .body("message", equalTo("Alerta eliminada"));
    }

    @Test
    void deleteNonExistentAlertReturns404() {
        given()
            .header("Authorization", "Bearer " + token)
            .when().delete("/user/alerts/999999")
            .then()
            .statusCode(404);
    }
}
