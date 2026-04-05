package com.crypto.platform.market;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import io.quarkus.panache.common.Page;
import jakarta.persistence.*;
import java.time.Instant;
import java.util.List;

@Entity
@Table(name = "trades", indexes = {
    @Index(name = "idx_trades_user_id",  columnList = "userId"),
    @Index(name = "idx_trades_symbol",   columnList = "symbol"),
    @Index(name = "idx_trades_timestamp",columnList = "timestamp")
})
public class Trade extends PanacheEntity {

    @Column(nullable = false)
    public String userId;

    @Column(nullable = false)
    public String symbol;

    @Column(nullable = false)
    public String side; // BUY o SELL

    public double quantity;
    public double entryPrice;
    public double total;
    public String signal;
    public String confidence;

    @Column(nullable = false)
    public Instant timestamp;

    /** Todos los trades del usuario, orden descendente por timestamp */
    public static List<Trade> findByUserId(String userId) {
        return list("userId = ?1 order by timestamp desc", userId);
    }

    /** Paginado a nivel de base de datos — evita cargar toda la tabla en memoria */
    public static List<Trade> findByUserIdPaged(String userId, int limit, int offset) {
        return find("userId = ?1 order by timestamp desc", userId)
            .page(Page.of(offset / Math.max(limit, 1), limit))
            .list();
    }

    public static List<Trade> findByUserIdAndSymbol(String userId, String symbol) {
        return list("userId = ?1 and symbol = ?2 order by timestamp asc", userId, symbol);
    }

    public static long countByUserId(String userId) {
        return count("userId", userId);
    }
}
