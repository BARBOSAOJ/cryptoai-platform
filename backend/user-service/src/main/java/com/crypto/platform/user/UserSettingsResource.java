package com.crypto.platform.user;

import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.jboss.logging.Logger;

import java.util.LinkedHashMap;
import java.util.Map;

@Path("/user")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RolesAllowed({"USER", "ADMIN"})
public class UserSettingsResource {

    private static final Logger LOG = Logger.getLogger(UserSettingsResource.class);

    @Inject JsonWebToken jwt;
    @Inject AesEncryptionService aes;

    private Long getUserId() {
        User user = User.findByEmail(jwt.getName());
        return user != null ? user.id : null;
    }

    // ─── Perfil ──────────────────────────────────────────────────────────────

    @GET
    @Path("/profile")
    public Response getProfile() {
        User user = User.findByEmail(jwt.getName());
        if (user == null) return Response.status(404).build();

        Map<String, Object> profile = new LinkedHashMap<>();
        profile.put("id", user.id);
        profile.put("email", user.email);
        profile.put("fullName", user.fullName != null ? user.fullName : "");
        profile.put("avatarInitials", user.avatarInitials != null ? user.avatarInitials
            : user.fullName != null && !user.fullName.isBlank()
                ? user.fullName.trim().substring(0, Math.min(2, user.fullName.trim().length())).toUpperCase()
                : user.email.substring(0, 2).toUpperCase());
        profile.put("bio", user.bio != null ? user.bio : "");
        profile.put("createdAt", user.createdAt != null ? user.createdAt.toString() : "");
        return Response.ok(profile).build();
    }

    @PUT
    @Path("/profile")
    @Transactional
    public Response updateProfile(Map<String, String> body) {
        User user = User.findByEmail(jwt.getName());
        if (user == null) return Response.status(404).build();

        if (body.containsKey("fullName") && body.get("fullName") != null) {
            user.fullName = body.get("fullName").trim();
        }
        if (body.containsKey("bio")) {
            user.bio = body.get("bio");
        }
        if (body.containsKey("avatarInitials") && body.get("avatarInitials") != null) {
            String initials = body.get("avatarInitials").trim().toUpperCase();
            user.avatarInitials = initials.substring(0, Math.min(2, initials.length()));
        }
        return Response.ok(Map.of("message", "Perfil actualizado")).build();
    }

    // ─── Cambio de contraseña ─────────────────────────────────────────────────

    @POST
    @Path("/change-password")
    @Transactional
    public Response changePassword(Map<String, String> body) {
        String currentPw = body.get("currentPassword");
        String newPw = body.get("newPassword");

        if (currentPw == null || newPw == null || newPw.length() < 6) {
            return Response.status(400).entity(Map.of("error", "La nueva contraseña debe tener al menos 6 caracteres")).build();
        }

        User user = User.findByEmail(jwt.getName());
        if (user == null) return Response.status(404).build();

        if (!io.quarkus.elytron.security.common.BcryptUtil.matches(currentPw, user.password)) {
            return Response.status(400).entity(Map.of("error", "Contraseña actual incorrecta")).build();
        }

        user.password = io.quarkus.elytron.security.common.BcryptUtil.bcryptHash(newPw);
        return Response.ok(Map.of("message", "Contraseña actualizada correctamente")).build();
    }

    // ─── Settings generales ───────────────────────────────────────────────────

    @GET
    @Path("/settings")
    public Response getSettings() {
        Long userId = getUserId();
        if (userId == null) return Response.status(404).build();

        UserSettings s = UserSettings.getOrCreate(userId);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("theme", s.theme);
        result.put("notificationsEnabled", s.notificationsEnabled);
        result.put("alertThreshold", s.alertThreshold);
        result.put("defaultInterval", s.defaultInterval);
        result.put("tradingEnabled", s.tradingEnabled);
        result.put("maxOrderSizeUsdt", s.maxOrderSizeUsdt);
        result.put("hasBinanceKeys",
            s.binanceApiKeyCiphertext != null && !s.binanceApiKeyCiphertext.isBlank());
        result.put("watchlistSymbols", s.watchlistSymbols);
        return Response.ok(result).build();
    }

    @PUT
    @Path("/settings")
    @Transactional
    public Response updateSettings(Map<String, Object> body) {
        Long userId = getUserId();
        if (userId == null) return Response.status(404).build();

        UserSettings s = UserSettings.getOrCreate(userId);

        if (body.containsKey("theme"))               s.theme = (String) body.get("theme");
        if (body.containsKey("notificationsEnabled")) s.notificationsEnabled = Boolean.TRUE.equals(body.get("notificationsEnabled"));
        if (body.containsKey("alertThreshold"))       s.alertThreshold = ((Number) body.get("alertThreshold")).intValue();
        if (body.containsKey("defaultInterval"))      s.defaultInterval = ((Number) body.get("defaultInterval")).intValue();
        if (body.containsKey("maxOrderSizeUsdt"))     s.maxOrderSizeUsdt = ((Number) body.get("maxOrderSizeUsdt")).doubleValue();
        if (body.containsKey("watchlistSymbols"))     s.watchlistSymbols = (String) body.get("watchlistSymbols");

        // tradingEnabled solo se activa si tiene keys configuradas
        if (body.containsKey("tradingEnabled")) {
            boolean wantsEnabled = Boolean.TRUE.equals(body.get("tradingEnabled"));
            if (wantsEnabled && (s.binanceApiKeyCiphertext == null || s.binanceApiKeyCiphertext.isBlank())) {
                return Response.status(400).entity(Map.of("error", "Configura las API Keys de Binance antes de activar el trading real")).build();
            }
            s.tradingEnabled = wantsEnabled;
        }

        return Response.ok(Map.of("message", "Configuración guardada")).build();
    }

    // ─── Binance API Keys ─────────────────────────────────────────────────────

    @POST
    @Path("/settings/binance-keys")
    @Transactional
    public Response saveBinanceKeys(Map<String, String> body) {
        String apiKey = body.get("apiKey");
        String secret = body.get("secret");

        if (apiKey == null || apiKey.isBlank() || secret == null || secret.isBlank()) {
            return Response.status(400).entity(Map.of("error", "API Key y Secret son obligatorios")).build();
        }
        if (apiKey.length() < 10 || secret.length() < 10) {
            return Response.status(400).entity(Map.of("error", "Las claves no parecen válidas")).build();
        }

        Long userId = getUserId();
        if (userId == null) return Response.status(404).build();

        UserSettings s = UserSettings.getOrCreate(userId);
        try {
            s.binanceApiKeyCiphertext    = aes.encrypt(apiKey);
            s.binanceSecretKeyCiphertext = aes.encrypt(secret);
        } catch (Exception e) {
            LOG.errorf("Error cifrando keys Binance para usuario %d: %s", userId, e.getMessage());
            return Response.status(500).entity(Map.of("error", "Error al guardar las claves")).build();
        }

        return Response.ok(Map.of("message", "API Keys guardadas de forma cifrada")).build();
    }

    @GET
    @Path("/settings/binance-has-keys")
    public Response hasBinanceKeys() {
        Long userId = getUserId();
        if (userId == null) return Response.status(404).build();
        UserSettings s = UserSettings.getOrCreate(userId);
        boolean hasKeys = s.binanceApiKeyCiphertext != null && !s.binanceApiKeyCiphertext.isBlank();
        return Response.ok(Map.of("hasKeys", hasKeys)).build();
    }

    /** Solo para uso interno entre microservicios — devuelve las keys descifradas */
    @GET
    @Path("/settings/binance-keys-decrypted")
    public Response getBinanceKeysDecrypted() {
        Long userId = getUserId();
        if (userId == null) return Response.status(404).build();
        UserSettings s = UserSettings.getOrCreate(userId);
        if (s.binanceApiKeyCiphertext == null || s.binanceApiKeyCiphertext.isBlank()) {
            return Response.status(404).entity(Map.of("error", "No hay keys configuradas")).build();
        }
        try {
            return Response.ok(Map.of(
                "apiKey", aes.decrypt(s.binanceApiKeyCiphertext),
                "secret", aes.decrypt(s.binanceSecretKeyCiphertext)
            )).build();
        } catch (Exception e) {
            LOG.errorf("Error descifrando keys para usuario %d: %s", userId, e.getMessage());
            return Response.status(500).entity(Map.of("error", "Error al obtener las claves")).build();
        }
    }

    @DELETE
    @Path("/settings/binance-keys")
    @Transactional
    public Response deleteBinanceKeys() {
        Long userId = getUserId();
        if (userId == null) return Response.status(404).build();
        UserSettings s = UserSettings.getOrCreate(userId);
        s.binanceApiKeyCiphertext    = null;
        s.binanceSecretKeyCiphertext = null;
        s.tradingEnabled             = false;
        return Response.ok(Map.of("message", "API Keys eliminadas")).build();
    }

    // ─── Alertas de precio ────────────────────────────────────────────────────

    @GET
    @Path("/alerts")
    public Response getAlerts() {
        Long userId = getUserId();
        if (userId == null) return Response.status(404).build();
        return Response.ok(PriceAlert.findActiveByUserId(userId)).build();
    }

    @POST
    @Path("/alerts")
    @Transactional
    public Response createAlert(Map<String, Object> body) {
        Long userId = getUserId();
        if (userId == null) return Response.status(404).build();

        String symbol = (String) body.get("symbol");
        String direction = (String) body.get("direction");
        if (symbol == null || direction == null || body.get("targetPrice") == null) {
            return Response.status(400).entity(Map.of("error", "symbol, targetPrice y direction son obligatorios")).build();
        }
        if (!direction.equals("ABOVE") && !direction.equals("BELOW")) {
            return Response.status(400).entity(Map.of("error", "direction debe ser ABOVE o BELOW")).build();
        }

        PriceAlert alert = new PriceAlert();
        alert.userId      = userId;
        alert.symbol      = symbol.toUpperCase();
        alert.targetPrice = ((Number) body.get("targetPrice")).doubleValue();
        alert.direction   = direction;
        alert.message     = (String) body.getOrDefault("message", null);
        alert.persist();

        return Response.status(201).entity(alert).build();
    }

    @DELETE
    @Path("/alerts/{id}")
    @Transactional
    public Response deleteAlert(@PathParam("id") Long id) {
        Long userId = getUserId();
        if (userId == null) return Response.status(404).build();

        PriceAlert alert = PriceAlert.findById(id);
        if (alert == null || !alert.userId.equals(userId)) {
            return Response.status(404).entity(Map.of("error", "Alerta no encontrada")).build();
        }
        alert.delete();
        return Response.ok(Map.of("message", "Alerta eliminada")).build();
    }

    @PUT
    @Path("/alerts/{id}/trigger")
    @Transactional
    public Response triggerAlert(@PathParam("id") Long id) {
        Long userId = getUserId();
        PriceAlert alert = PriceAlert.findById(id);
        if (alert == null || !alert.userId.equals(userId)) {
            return Response.status(404).build();
        }
        alert.triggered = true;
        return Response.ok(Map.of("message", "Alerta disparada")).build();
    }
}
