package com.crypto.platform.user;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.*;

@Entity
@Table(name = "user_settings")
public class UserSettings extends PanacheEntity {

    @Column(nullable = false, unique = true)
    public Long userId;

    public String theme = "dark";
    public boolean notificationsEnabled = false;
    public int alertThreshold = 65;
    public int defaultInterval = 3000;

    // Trading real
    public boolean tradingEnabled = false;
    public double maxOrderSizeUsdt = 100.0;

    @Column(columnDefinition = "TEXT")
    public String binanceApiKeyCiphertext;

    @Column(columnDefinition = "TEXT")
    public String binanceSecretKeyCiphertext;

    @Column(columnDefinition = "TEXT")
    public String watchlistSymbols = "[\"BTCUSDT\",\"ETHUSDT\",\"SOLUSDT\",\"DOGEUSDT\",\"PEPEUSDT\"]";

    public static UserSettings findByUserId(Long userId) {
        return find("userId", userId).firstResult();
    }

    public static UserSettings getOrCreate(Long userId) {
        UserSettings s = findByUserId(userId);
        if (s == null) {
            s = new UserSettings();
            s.userId = userId;
            s.persist();
        }
        return s;
    }
}
