package com.crypto.platform.user.recursos;

import com.crypto.platform.user.entidades.PriceAlert;
import com.crypto.platform.user.entidades.User;
import com.crypto.platform.user.entidades.UserSettings;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Path("/admin")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RolesAllowed("ADMIN")
public class RecursoAdmin {

    @Inject
    JsonWebToken jwt;

    private Map<String, Object> usuarioAMapa(User u) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", u.id);
        m.put("email", u.email);
        m.put("fullName", u.fullName != null ? u.fullName : "");
        m.put("roles", u.roles);
        m.put("createdAt", u.createdAt != null ? u.createdAt.toString() : "");
        return m;
    }

    // ─── GET /admin/users — lista paginada de usuarios ─────────────────────────

    @GET
    @Path("/users")
    public Response listarUsuarios(
            @QueryParam("page") @DefaultValue("0") int page,
            @QueryParam("size") @DefaultValue("20") int size) {

        long total = User.count();
        List<User> usuarios = User.findAll()
                .page(page, size)
                .list();

        List<Map<String, Object>> datos = usuarios.stream()
                .map(this::usuarioAMapa)
                .collect(Collectors.toList());

        Map<String, Object> respuesta = new LinkedHashMap<>();
        respuesta.put("content", datos);
        respuesta.put("page", page);
        respuesta.put("size", size);
        respuesta.put("total", total);
        respuesta.put("totalPages", (int) Math.ceil((double) total / size));

        return Response.ok(respuesta).build();
    }

    // ─── PUT /admin/users/{id}/rol — cambia el rol del usuario ─────────────────

    @PUT
    @Path("/users/{id}/rol")
    @Transactional
    public Response cambiarRol(@PathParam("id") Long id, Map<String, String> body) {
        String nuevoRol = body.get("rol");
        if (nuevoRol == null || nuevoRol.isBlank()) {
            return Response.status(400)
                    .entity(Map.of("error", "El campo 'rol' es obligatorio"))
                    .build();
        }
        if (!nuevoRol.equals("ADMIN") && !nuevoRol.equals("USER")) {
            return Response.status(400)
                    .entity(Map.of("error", "Rol no válido. Use 'ADMIN' o 'USER'"))
                    .build();
        }

        // Evitar que el admin se quite su propio rol
        Object claimId = jwt.getClaim("id");
        Long adminId = claimId instanceof Number ? ((Number) claimId).longValue() : null;
        if (adminId != null && adminId.equals(id) && nuevoRol.equals("USER")) {
            return Response.status(400)
                    .entity(Map.of("error", "No puedes quitarte el rol ADMIN a ti mismo"))
                    .build();
        }

        User usuario = User.findById(id);
        if (usuario == null) {
            return Response.status(404).entity(Map.of("error", "Usuario no encontrado")).build();
        }

        usuario.roles.clear();
        usuario.roles.add(nuevoRol);

        return Response.ok(Map.of(
                "message", "Rol actualizado a " + nuevoRol,
                "user", usuarioAMapa(usuario)
        )).build();
    }

    // ─── DELETE /admin/users/{id} — elimina un usuario ─────────────────────────

    @DELETE
    @Path("/users/{id}")
    @Transactional
    public Response eliminarUsuario(@PathParam("id") Long id) {
        // Evitar auto-eliminación
        Object claimId = jwt.getClaim("id");
        Long adminId = claimId instanceof Number ? ((Number) claimId).longValue() : null;
        if (adminId != null && adminId.equals(id)) {
            return Response.status(400)
                    .entity(Map.of("error", "No puedes eliminarte a ti mismo"))
                    .build();
        }

        User usuario = User.findById(id);
        if (usuario == null) {
            return Response.status(404).entity(Map.of("error", "Usuario no encontrado")).build();
        }

        // Eliminar settings y alertas asociados
        UserSettings settings = UserSettings.find("userId", id).firstResult();
        if (settings != null) settings.delete();

        PriceAlert.delete("userId", id);

        usuario.delete();

        return Response.ok(Map.of("message", "Usuario eliminado correctamente")).build();
    }
}
