package com.crypto.platform.user.entidades;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.List;

@Entity
@Table(name = "price_alerts", indexes = {
    @Index(name = "idx_alerts_user_id", columnList = "userId")
})
public class PriceAlert extends PanacheEntity {

    @Column(nullable = false)
    public Long userId;

    @Column(nullable = false)
    public String symbol;

    public double targetPrice;

    @Column(nullable = false)
    public String direction; // ABOVE | BELOW

    public String message;
    public boolean triggered = false;

    @Column(nullable = false)
    public Instant createdAt = Instant.now();

    public static List<PriceAlert> findActiveByUserId(Long userId) {
        return list("userId = ?1 and triggered = false order by createdAt desc", userId);
    }
}
