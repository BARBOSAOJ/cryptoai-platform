# AUTOWORK LOG — crypto-ai-platform

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
