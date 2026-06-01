package com.crypto.platform.user;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.CoreMatchers.*;

@QuarkusTest
class AuthResourceTest {

    // ── Register ─────────────────────────────────────────────────────────────

    @Test
    void registerNewUserReturns201() {
        given()
            .contentType("application/json")
            .body("{\"email\":\"newuser@test.com\",\"password\":\"secret123\",\"fullName\":\"New User\"}")
            .when().post("/auth/register")
            .then()
            .statusCode(201)
            .body("email", equalTo("newuser@test.com"));
    }

    @Test
    void registerDuplicateEmailReturns409() {
        String body = "{\"email\":\"dup@test.com\",\"password\":\"secret123\",\"fullName\":\"Dup User\"}";
        // First registration succeeds
        given().contentType("application/json").body(body).post("/auth/register");

        // Second with same email must fail
        given()
            .contentType("application/json")
            .body(body)
            .when().post("/auth/register")
            .then()
            .statusCode(409);
    }

    // ── Login ─────────────────────────────────────────────────────────────────

    @Test
    void loginValidCredentialsReturnsToken() {
        // El usuario ya existe gracias al @BeforeAll
        given()
            .contentType("application/json")
            .body("{\"email\":\"loginok@test.com\",\"password\":\"pass1234\"}")
            .when().post("/auth/login")
            .then()
            .statusCode(200)
            .body("token", notNullValue());
    }

    @Test
    void loginWrongPasswordReturns401() {
        given()
            .contentType("application/json")
            .body("{\"email\":\"loginok@test.com\",\"password\":\"wrongpass\"}")
            .when().post("/auth/login")
            .then()
            .statusCode(401);
    }

    @Test
    void loginUnknownEmailReturns401() {
        given()
            .contentType("application/json")
            .body("{\"email\":\"nobody@test.com\",\"password\":\"anypass\"}")
            .when().post("/auth/login")
            .then()
            .statusCode(401);
    }

    @Test
    void loginResponseContainsOnlyTokenField() {
        // Test autocontenido: registro idempotente (409 si ya existe, ignorado)
        given()
            .contentType("application/json")
            .body("{\"email\":\"loginok@test.com\",\"password\":\"pass1234\",\"fullName\":\"Login User\"}")
            .post("/auth/register");

        given()
            .contentType("application/json")
            .body("{\"email\":\"loginok@test.com\",\"password\":\"pass1234\"}")
            .when().post("/auth/login")
            .then()
            .statusCode(200)
            .body("token", notNullValue())
            .body("password", nullValue());
    }
}
