package com.crypto.platform.market;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.websocket.*;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@ApplicationScoped
@Startup
@ClientEndpoint
public class BinanceSocketClient {

    private final ConcurrentHashMap<String, String> latestPrices = new ConcurrentHashMap<>();
    private final ObjectMapper mapper = new ObjectMapper();
    private Session session;

    @PostConstruct
    public void init() {
        connect();
    }

    public void connect() {
        try {
            URI uri = new URI("wss://stream.binance.com:9443/ws/!miniTicker@arr");
            ContainerProvider.getWebSocketContainer().connectToServer(this, uri);
        } catch (Exception e) {
        }
    }

    @OnMessage
    public void onMessage(String message) {
        try {
            List<Map<String, Object>> tickers = mapper.readValue(message, new TypeReference<>() {});
            for (Map<String, Object> ticker : tickers) {
                String symbol = (String) ticker.get("s");
                String price = (String) ticker.get("c");
                if (symbol != null && price != null) {
                    latestPrices.put(symbol.toUpperCase(), price);
                }
            }
        } catch (Exception e) {
        }
    }

    public String getPrice(String symbol) {
        return latestPrices.getOrDefault(symbol.toUpperCase(), "0.00");
    }

    public Map<String, String> getAllPrices() {
        return latestPrices;
    }
}