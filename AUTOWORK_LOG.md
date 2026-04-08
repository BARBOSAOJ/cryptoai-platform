# AUTOWORK LOG — crypto-ai-platform

## Issue #20 — Señales AI visibles en el gráfico (entrada y precio objetivo)
**Fecha:** 2026-04-08
**Commits:** e74b4b2, 5cfa9f6

### Lo que se implementó

#### AI Engine (ai-engine/main.py)
- `realizar_analisis` ahora calcula y devuelve `entry_price` y `target_price` en el dict `result`.
- `entry_price`: precio actual si RSI < 35 o bb_position < -0.4 o stoch_rsi < 0.25 (sobreventa), si no el mínimo de las últimas 5 velas.
- `target_price`: `predicted_next` si LSTM activo y predicción > precio actual, si no `price × (1 + |tech_score| × 0.02 + 0.005)`. Nunca < `price × 1.002`.

#### Frontend (frontend/src/components/ChartPanel.tsx)
- Nuevo estado `showAI` (por defecto `true`) controlado con botón "Overlays IA" en la cabecera del gráfico.
- `useEffect` que crea `PriceLine`s dashed en la serie activa (area/candle):
  - Verde `#2ebd85` → `entry_price` con label "Entrada IA"
  - Naranja `#f97316` → `target_price` con label "Objetivo IA"
  - Azul `#3b82f6` → `predicted_next` con label "LSTM"
- El badge de Señal IA en esquina inferior izquierda muestra los tres precios (entrada, objetivo, LSTM) cuando los overlays están activos.
- Las líneas se limpian y regeneran al cambiar `insight`, `showAI` o `type` (área/velas).

### Patrones seguidos
- Props `symbol` + `insight` ya existentes en ChartPanel, sin cambios en TradingTerminal ni App.tsx.
- lightweight-charts ya estaba instalado (v5.1.0), no se reinstala.
- TypeScript sin errores (`tsc --noEmit` limpio).

---

## Issue #19 — Cartera virtual con saldo ficticio y operaciones simuladas
**Fecha:** 2026-04-08  
**Commits:** 9cfb1b8, f34960e

### Lo que se implementó

#### Backend (market-service)
- **`CarteraVirtual.java`** — Entidad Panache con campos `userId` (unique), `saldoDisponible`, `depositoInicial`, `creadoEn`; método estático `findByUserId`.
- **`ServicioCartera.java`** — Service bean `@ApplicationScoped` con métodos: `obtenerOCrear`, `depositar`, `retirar`, `descontarSaldo`, `añadirSaldo`, `obtenerResumen` (calcula P&L y valor de posiciones en tiempo real desde trades + precios Binance).
- **`RecursoCartera.java`** — JAX-RS resource en `/cartera`:
  - `GET /cartera` — devuelve saldoDisponible, valorPosiciones, pnlTotal, patrimonioTotal, depositoInicial, creadoEn, tieneCartera
  - `POST /cartera/depositar` — añade saldo, crea cartera si no existe
  - `POST /cartera/retirar` — retira saldo si hay suficiente (400 si no)
- **`OrderResource.java`** — modificado `executeOrder` para:
  - BUY: llama `descontarSaldo`; devuelve HTTP 402 si saldo insuficiente
  - SELL: llama `añadirSaldo` con el importe de la venta

#### Frontend
- **`WalletPanel.tsx`** — Componente nuevo con: 3 métricas (saldo, posiciones, P&L), card de patrimonio total, botones Depositar/Retirar con modal de cantidad (validación, mensajes de feedback, cierre automático tras éxito).
- **`Portfolio.tsx`** — Integra `WalletPanel` arriba del grid de estadísticas; el card "Patrimonio total" renombrado a "Saldo disponible" y usa el saldo real de la cartera virtual.
- **`Header.tsx`** — Badge con icono Wallet y saldo disponible junto al avatar, se carga al montar el componente desde `GET /cartera`.

### Patrones seguidos
- Clases Java en español (CarteraVirtual, RecursoCartera, ServicioCartera)
- Panache `PanacheEntity`, `@Transactional`, `extractUserId()` desde JWT claim "id"
- `Response.ok()` / `Response.status(...)` en todos los endpoints
- `apiClient` de axios con token JWT inyectado automáticamente

---

## Issues anteriores

### Issues #2, #3, #4 — Implementaciones previas
- Indicadores técnicos extendidos (ATR, Stoch RSI, VWAP, OBV)
- Reentrenamiento automático LSTM + todos los pares USDT activos de Binance
- Detección de régimen de mercado con pesos dinámicos

### Mejoras 2026-04-05
- SSE para precios en tiempo real
- Persistencia de trades (PostgreSQL)
- RabbitMQ para eventos de órdenes
- Redis para caché
- JWT en market-service
- CI/CD pipeline
