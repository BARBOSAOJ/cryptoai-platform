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

    public static class MarketTick {
        public String price;
        public String volume;

        public MarketTick(String price, String volume) {
            this.price = price;
            this.volume = volume;
        }
    }

    private final ConcurrentHashMap<String, MarketTick> marketData = new ConcurrentHashMap<>();
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
                String volume = (String) ticker.get("v");

                if (symbol != null && price != null && volume != null) {
                    marketData.put(symbol.toUpperCase(), new MarketTick(price, volume));
                }
            }
        } catch (Exception e) {
        }
    }

    public MarketTick getMarketTick(String symbol) {
        return marketData.getOrDefault(symbol.toUpperCase(), new MarketTick("0.00", "0.00"));
    }

    public Map<String, MarketTick> getAllMarketData() {
        return marketData;
    }
}