package com.crypto.platform.user.recursos;

import com.crypto.platform.user.entidades.LoginDTO;
import com.crypto.platform.user.entidades.RegisterDTO;
import com.crypto.platform.user.entidades.User;
import io.quarkus.elytron.security.common.BcryptUtil;
import io.smallrye.jwt.build.Jwt;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.Map;

@Path("/auth")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AuthResource {

    @POST
    @Path("/register")
    @Transactional
    public Response register(RegisterDTO dto) {
        if (User.findByEmail(dto.email()) != null) {
            return Response.status(409).entity("El email ya está registrado").build();
        }

        User newUser = new User();
        newUser.email = dto.email();
        newUser.fullName = dto.fullName();
        newUser.password = BcryptUtil.bcryptHash(dto.password());
        newUser.roles.add("USER");
        newUser.persist();

        return Response.status(Response.Status.CREATED).entity(newUser).build();
    }

    @POST
    @Path("/login")
    public Response login(LoginDTO dto) {
        User user = User.findByEmail(dto.email());
        if (user == null || !BcryptUtil.matches(dto.password(), user.password)) {
            return Response.status(401).entity("Credenciales incorrectas").build();
        }

        String token = Jwt.issuer("https://crypto-ai-platform.com")
                .upn(user.email)
                .groups(user.roles)
                .claim("id", user.id)
                .expiresIn(3600)
                .sign();
        return Response.ok(Map.of("token", token)).build();
    }
}