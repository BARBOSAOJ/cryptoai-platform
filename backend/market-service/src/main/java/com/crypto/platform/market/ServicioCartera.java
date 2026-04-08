package com.crypto.platform.market;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@ApplicationScoped
public class ServicioCartera {

    private static final Logger LOG = Logger.getLogger(ServicioCartera.class);

    @Inject
    BinanceSocketClient binanceClient;

    // ─── Obtener o crear cartera ──────────────────────────────────────────────

    @Transactional
    public CarteraVirtual obtenerOCrear(String userId, double deposito) {
        Optional<CarteraVirtual> opt = CarteraVirtual.findByUserId(userId);
        if (opt.isPresent()) return opt.get();

        CarteraVirtual cartera = new CarteraVirtual();
        cartera.userId           = userId;
        cartera.saldoDisponible  = deposito;
        cartera.depositoInicial  = deposito;
        cartera.creadoEn         = Instant.now();
        cartera.persist();
        LOG.infof("Cartera creada: userId=%s deposito=%.2f", userId, deposito);
        return cartera;
    }

    // ─── Depositar ────────────────────────────────────────────────────────────

    @Transactional
    public CarteraVirtual depositar(String userId, double cantidad) {
        CarteraVirtual cartera = obtenerOCrear(userId, 0.0);
        cartera.saldoDisponible  += cantidad;
        cartera.depositoInicial  += cantidad;
        LOG.infof("Depósito: userId=%s cantidad=%.2f nuevoSaldo=%.2f", userId, cantidad, cartera.saldoDisponible);
        return cartera;
    }

    // ─── Retirar ──────────────────────────────────────────────────────────────

    @Transactional
    public Optional<CarteraVirtual> retirar(String userId, double cantidad) {
        Optional<CarteraVirtual> opt = CarteraVirtual.findByUserId(userId);
        if (opt.isEmpty()) return Optional.empty();
        CarteraVirtual cartera = opt.get();
        if (cartera.saldoDisponible < cantidad) return Optional.empty();
        cartera.saldoDisponible -= cantidad;
        LOG.infof("Retiro: userId=%s cantidad=%.2f nuevoSaldo=%.2f", userId, cantidad, cartera.saldoDisponible);
        return Optional.of(cartera);
    }

    // ─── Descontar saldo (BUY) ────────────────────────────────────────────────

    @Transactional
    public boolean descontarSaldo(String userId, double importe) {
        Optional<CarteraVirtual> opt = CarteraVirtual.findByUserId(userId);
        if (opt.isEmpty()) return false;
        CarteraVirtual cartera = opt.get();
        if (cartera.saldoDisponible < importe) return false;
        cartera.saldoDisponible -= importe;
        return true;
    }

    // ─── Añadir saldo (SELL) ──────────────────────────────────────────────────

    @Transactional
    public void añadirSaldo(String userId, double importe) {
        Optional<CarteraVirtual> opt = CarteraVirtual.findByUserId(userId);
        if (opt.isPresent()) {
            opt.get().saldoDisponible += importe;
        }
    }

    // ─── Resumen completo ─────────────────────────────────────────────────────

    public Map<String, Object> obtenerResumen(String userId) {
        Optional<CarteraVirtual> opt = CarteraVirtual.findByUserId(userId);
        double saldoDisponible = opt.map(c -> c.saldoDisponible).orElse(0.0);
        Instant creadoEn       = opt.map(c -> c.creadoEn).orElse(null);
        double depositoInicial = opt.map(c -> c.depositoInicial).orElse(0.0);

        // Calcular valor de posiciones y P&L desde trades
        List<Trade> trades = Trade.findByUserId(userId);
        double valorPosiciones = 0.0;
        double pnlTotal        = 0.0;

        if (!trades.isEmpty()) {
            Map<String, List<Trade>> bySymbol = trades.stream()
                .collect(Collectors.groupingBy(t -> t.symbol));

            for (Map.Entry<String, List<Trade>> entry : bySymbol.entrySet()) {
                String symbol       = entry.getKey();
                List<Trade> list    = entry.getValue();

                List<Trade> buys  = list.stream().filter(t -> "BUY".equals(t.side))
                    .sorted(Comparator.comparing(t -> t.timestamp)).collect(Collectors.toList());
                List<Trade> sells = list.stream().filter(t -> "SELL".equals(t.side))
                    .sorted(Comparator.comparing(t -> t.timestamp)).collect(Collectors.toList());

                // P&L de pares cerrados
                int pares = Math.min(buys.size(), sells.size());
                for (int i = 0; i < pares; i++) {
                    pnlTotal += (sells.get(i).entryPrice - buys.get(i).entryPrice) * buys.get(i).quantity;
                }

                // Valor de posiciones abiertas
                double totalComprado = buys.stream().mapToDouble(t -> t.quantity).sum();
                double totalVendido  = sells.stream().mapToDouble(t -> t.quantity).sum();
                double netQty        = totalComprado - totalVendido;

                if (netQty > 1e-8) {
                    double precioActual;
                    try {
                        BinanceSocketClient.MarketTick tick = binanceClient.getMarketTick(symbol);
                        precioActual = Double.parseDouble(tick.price);
                    } catch (Exception e) {
                        precioActual = buys.isEmpty() ? 0 :
                            buys.stream().mapToDouble(t -> t.entryPrice).average().orElse(0);
                    }
                    valorPosiciones += netQty * precioActual;
                }
            }
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("saldoDisponible",  round2(saldoDisponible));
        res.put("valorPosiciones",  round2(valorPosiciones));
        res.put("pnlTotal",         round2(pnlTotal));
        res.put("patrimonioTotal",  round2(saldoDisponible + valorPosiciones));
        res.put("depositoInicial",  round2(depositoInicial));
        res.put("creadoEn",         creadoEn != null ? creadoEn.toString() : null);
        res.put("tieneCartera",     opt.isPresent());
        return res;
    }

    private static double round2(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
