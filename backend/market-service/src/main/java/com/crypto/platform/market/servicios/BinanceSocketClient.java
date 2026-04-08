package com.crypto.platform.market.servicios;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.runtime.Startup;
import jakarta.annotation.PostConstruct;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.websocket.*;
import org.jboss.logging.Logger;

import java.net.URI;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

@ApplicationScoped
@Startup
@ClientEndpoint
public class BinanceSocketClient {

    private static final Logger LOG = Logger.getLogger(BinanceSocketClient.class);
    private static final int CANDLE_INTERVAL_SECONDS = 60;
    private static final int MAX_CANDLES = 100;
    private static final int MAX_RECONNECT_ATTEMPTS = 10;
    private static final long BASE_RECONNECT_DELAY_MS = 3000;

    public static class MarketTick {
        public String price;
        public String volume;
        public MarketTick(String price, String volume) {
            this.price = price;
            this.volume = volume;
        }
    }

    public static class Candle {
        public long openTime;
        public double open;
        public double high;
        public double low;
        public double close;
        public double volume;
        public boolean closed;

        public Candle(long openTime, double open) {
            this.openTime = openTime;
            this.open = open;
            this.high = open;
            this.low = open;
            this.close = open;
            this.volume = 0;
            this.closed = false;
        }
    }

    private final ConcurrentHashMap<String, MarketTick> marketData = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, List<Candle>> ohlcvData = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Candle> currentCandle = new ConcurrentHashMap<>();
    private final ObjectMapper mapper = new ObjectMapper();
    private final AtomicInteger reconnectAttempts = new AtomicInteger(0);
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    @PostConstruct
    public void init() {
        connect();
    }

    public void connect() {
        try {
            URI uri = new URI("wss://stream.binance.com:9443/ws/!miniTicker@arr");
            ContainerProvider.getWebSocketContainer().connectToServer(this, uri);
            reconnectAttempts.set(0);
            LOG.info("Conectado al WebSocket de Binance");
        } catch (Exception e) {
            LOG.warnf("Error conectando al WebSocket de Binance: %s", e.getMessage());
            scheduleReconnect();
        }
    }

    @OnOpen
    public void onOpen(Session session) {
        reconnectAttempts.set(0);
        LOG.info("WebSocket Binance abierto — recibiendo ticks de mercado");
    }

    @OnClose
    public void onClose(Session session, CloseReason reason) {
        LOG.warnf("WebSocket Binance cerrado: %s — reintentando...", reason.getReasonPhrase());
        scheduleReconnect();
    }

    @OnError
    public void onError(Session session, Throwable t) {
        LOG.warnf("Error en WebSocket Binance: %s", t.getMessage());
    }

    private void scheduleReconnect() {
        int attempt = reconnectAttempts.incrementAndGet();
        if (attempt > MAX_RECONNECT_ATTEMPTS) {
            LOG.error("Se alcanzó el máximo de intentos de reconexión a Binance WebSocket");
            return;
        }
        long delay = Math.min(BASE_RECONNECT_DELAY_MS * attempt, 60_000);
        LOG.infof("Reintentando conexión Binance en %dms (intento %d/%d)", delay, attempt, MAX_RECONNECT_ATTEMPTS);
        scheduler.schedule(this::connect, delay, TimeUnit.MILLISECONDS);
    }

    @OnMessage
    public void onMessage(String message) {
        try {
            List<Map<String, Object>> tickers = mapper.readValue(message, new TypeReference<>() {});
            for (Map<String, Object> ticker : tickers) {
                String symbol = (String) ticker.get("s");
                String priceStr = (String) ticker.get("c");
                String volumeStr = (String) ticker.get("v");
                if (symbol == null || priceStr == null || volumeStr == null) continue;

                symbol = symbol.toUpperCase();
                double price = Double.parseDouble(priceStr);
                double volume = Double.parseDouble(volumeStr);

                if (Double.isNaN(price) || Double.isInfinite(price) || price <= 0) continue;
                if (Double.isNaN(volume) || Double.isInfinite(volume) || volume < 0) volume = 0;

                marketData.put(symbol, new MarketTick(priceStr, volumeStr));
                updateCandle(symbol, price, volume);
            }
        } catch (Exception e) {
            LOG.debugf("Error procesando mensaje de Binance: %s", e.getMessage());
        }
    }

    private void updateCandle(String symbol, double price, double volume) {
        long now = Instant.now().getEpochSecond();
        long candleTime = (now / CANDLE_INTERVAL_SECONDS) * CANDLE_INTERVAL_SECONDS;

        Candle active = currentCandle.get(symbol);

        if (active == null || active.openTime != candleTime) {
            if (active != null) {
                active.closed = true;
                ohlcvData.computeIfAbsent(symbol, k -> new ArrayList<>()).add(active);
                List<Candle> list = ohlcvData.get(symbol);
                if (list.size() > MAX_CANDLES) list.remove(0);
            }
            active = new Candle(candleTime, price);
            currentCandle.put(symbol, active);
        }

        active.close = price;
        active.high = Math.max(active.high, price);
        active.low = Math.min(active.low, price);
        active.volume += volume;
    }

    public List<Candle> getCandles(String symbol) {
        List<Candle> history = new ArrayList<>(ohlcvData.getOrDefault(symbol, new ArrayList<>()));
        Candle live = currentCandle.get(symbol);
        if (live != null) history.add(live);
        return history;
    }

    public MarketTick getMarketTick(String symbol) {
        return marketData.getOrDefault(symbol, new MarketTick("0.00", "0.00"));
    }

    public Map<String, MarketTick> getAllMarketData() {
        return marketData;
    }

    public boolean isConnected() {
        return !marketData.isEmpty();
    }
}
