package com.crypto.platform.market;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.Optional;

@Entity
@Table(name = "cartera_virtual", indexes = {
    @Index(name = "idx_cartera_user_id", columnList = "userId", unique = true)
})
public class CarteraVirtual extends PanacheEntity {

    @Column(nullable = false, unique = true)
    public String userId;

    @Column(nullable = false)
    public Double saldoDisponible;

    @Column(nullable = false)
    public Double depositoInicial;

    @Column(nullable = false)
    public Instant creadoEn;

    /** Busca la cartera del usuario, o vacío si no existe */
    public static Optional<CarteraVirtual> findByUserId(String userId) {
        return find("userId", userId).firstResultOptional();
    }
}
