# AUTOWORK LOG — crypto-ai-platform

## Issue #23 — Panel de posiciones activas en tiempo real y estadísticas de perfil
**Fecha:** 2026-04-08
**Commits:** ebc3057, caa659e

### Lo que se implementó

#### market-service — `OrderResource.java`
- `GET /portfolio/stats` ampliado con: `mejorTrade` (max PnL por operación), `peorTrade` (min PnL), `rachaGanadora` (max wins consecutivos), `diasActivo` (días distintos con trades).

#### market-service — `RecursoEstadisticas.java` (nuevo)
- `GET /portfolio/equity-curve`: agrupa trades por día UTC, calcula saldo acumulado neto partiendo de 10 000 USDT. Devuelve array `[{fecha, valor}]`.

#### Frontend — `Portfolio.tsx` (reescrito)
- Sistema de **3 tabs** interno: Resumen | Posiciones | Estadísticas.
- **Tab Resumen**: igual que antes, con tabla compacta de posiciones abiertas.
- **Tab Posiciones**: tabla detallada con columnas Precio entrada, Precio actual, P&L $, P&L %, Valor total, Acción. P&L recalculado en tiempo real con el prop `marketData` (SSE). Filas coloreadas verde/rojo. Botón "Cerrar" por fila (POST /portfolio/execute SELL). Ordenado por valor descendente.
- **Tab Estadísticas**: métricas mejorTrade/peorTrade/rachaGanadora/diasActivo; curva de equity con SVG inline (área + línea + puntos + ejes); comparativa portfolio vs BTC usando `marketData['BTCUSDT'].history`; botón "Exportar CSV" que descarga historial de trades.

#### Frontend — `App.tsx`
- Pasa `marketData={marketData}` al componente `<Portfolio>`.

---

## Issue #22 — Gestión de riesgo funcional con ATR, stop-loss automático y ratio R/B
**Fecha:** 2026-04-08
**Commits:** 455fc44, d8c3b85, 9593651

### Lo que se implementó

#### AI engine — `GET /risk/{symbol}?price=X&saldo=Y` (`ai-engine/main.py`)
- Descarga 100 velas 1h de Binance con OHLCV completo para el símbolo.
- Calcula ATR real (14 periodos) usando `IndicadoresTecnicos.atr`.
- Detecta régimen de mercado con `DetectorRegimen.detectar`.
- Devuelve: `symbol, price, stop_loss (price − 2×ATR), take_profit (price + 3×ATR), atr, tamano_posicion (saldo×0.01/ATR), importe_riesgo (saldo×0.01), ratio_rb (1.5), regimen`.
- Fallback para ATR=0: usa 0.5% del precio. Validación de price>0 y saldo>0.

#### market-service — `RecursoRiesgo.java`
- `POST /risk/calculate`: recibe `{symbol, saldo, price, stopLoss, entry, riskPercentage}` y calcula `positionSize, riskAmount, rewardAmount (×1.5), ratio`. Reemplaza `RiskResource` (conservada vacía y marcada @Deprecated).
- `GET /risk/live/{symbol}?price=X&saldo=Y`: llama al AI engine via `java.net.http.HttpClient` y devuelve la respuesta directamente. Gestiona errores de conexión con 503.

#### Frontend — `TradingTerminal.tsx`
- Botón "Calcular con IA" (icono Zap): llama a `GET http://localhost:8002/risk/{symbol}?price=X&saldo=Y` y rellena automáticamente entry, stop_loss, take_profit y tamaño posición.
- Muestra ATR actual del símbolo y badge de régimen (verde=TRENDING, rojo=VOLATILE, ámbar=otros).
- Ratio R/B dinámico ("1 : 1.5") en verde si >= 1.5, ámbar si <1.5.
- Barra visual del importe en riesgo vs saldo total; barra roja si supera el 5%.
- Badge "⚠ STOP" en el encabezado de la sección si el precio toca el stop-loss.
- Input de Take Profit aparece automáticamente cuando se calculan valores IA.

#### Frontend — `useAgenteAutonomo.ts` + `Header.tsx` + `App.tsx`
- `EstadoAgente` añade campo `alertasStopLoss: Set<string>`.
- En `procesarTick`: detecta si `precio <= posicion.stopLoss` y añade/elimina el símbolo del Set; limpia la alerta al cerrar posición.
- `Header.tsx` acepta prop `stopAlertCount: number` y muestra badge rojo animado "STOP ×N" cuando hay posiciones en zona de stop-loss.
- `App.tsx` pasa `alertasStopLoss.size` a `<Header>`.

---

## Issue #21 — Agente autónomo de trading impulsado por IA
**Fecha:** 2026-04-08
**Commit:** 458b3e5

### Lo que se implementó

#### Hook `useAgenteAutonomo` (frontend/src/hooks/useAgenteAutonomo.ts)
- Estado del agente: activo global, configuración por símbolo (toggle, cantidadMaxima, umbralConfianza), posicionesAbiertas, log (últimas 50 entradas), statsHoy (operaciones + pnlBot).
- `procesarTick(symbol, price, insight)`: lógica de decisión con cooldown 30 s, guarda COMPRAR si señal incluye COMPRAR AND confianza >= umbral AND régimen no VOLATILE AND confluencia MTF >= 0.5 AND sin posición abierta. Vende si precio >= targetPrice o <= stopLoss o señal VENDER con confianza suficiente. Stop-loss automático al 3%, targetPrice = insight.target_price ?? precio × 1.03.
- Persistencia de configuración en localStorage (`agente_autonomo_config`).
- Excepciones capturadas en try/catch para no bloquear el hilo principal.

#### Componente `AgentPanel` (frontend/src/components/AgentPanel.tsx)
- Toggle global ON/OFF con indicador pulsante CSS cuando activo.
- Stats del día: N operaciones + P&L del bot en $.
- Botón prominente "PARADA DE EMERGENCIA" en rojo.
- Fila por símbolo (BTCUSDT, ETHUSDT, SOLUSDT, TRUMPUSDT, PEPEUSDT, DOGEUSDT): toggle activar/desactivar, input cantidad USDT, slider umbral confianza 60–95%, badge VIGILANDO/EN_POSICIÓN/INACTIVO, detalle de posición abierta (entrada, stop, target).
- Log en tiempo real: últimas 10 entradas con timestamp, símbolo, acción coloreada, motivo, precio.

#### Integración en `App.tsx`
- Importa `useAgenteAutonomo` y `AgentPanel`.
- Tab type extendido a `'TRADE' | 'MEMES' | 'PORTFOLIO' | 'BOT' | 'CONFIG'`.
- Hook inicializado; `procesarTick` llamado dentro de `fetchAiInsight` tras recibir insight.
- Case `activeTab === 'BOT'` renderiza `<AgentPanel>` dentro de `<ErrorBoundary>`.

#### `Sidebar.tsx`
- Importa `Bot` de lucide-react.
- Añade `{ tab: 'BOT', icon: Bot }` al array NAV entre PORTFOLIO y CONFIG.

---

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
