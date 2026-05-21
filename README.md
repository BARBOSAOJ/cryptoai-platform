# CryptoAI Platform

Plataforma de análisis de criptomonedas con IA. Combina un modelo LSTM de predicción de precios, análisis técnico multi-indicador, sentimiento de noticias (FinBERT), Fear & Greed Index y sentimiento Reddit para generar señales de trading con conviction score. El asistente BT (Gemma2:27b vía Ollama) integra todo en un chat en tiempo real con ejecución directa de órdenes.

## Arquitectura

```
frontend (React/Vite)   :5173
    │
    ├─ user-service  (Quarkus)   :8080  — auth, JWT, gestión de usuarios
    ├─ market-service (Quarkus)  :8081  — cartera virtual, órdenes, historial
    └─ ai-engine     (FastAPI)   :8002  — LSTM, análisis, chat BT

Infraestructura (Docker):
    PostgreSQL  :5432
    RabbitMQ    :5672  (management UI :15672)
    Redis       :6379
```

## Requisitos

| Herramienta | Versión mínima |
|-------------|---------------|
| Docker + Compose | 24.x |
| Java (JDK) | 17 |
| Python | 3.11 |
| Node.js | 20 |
| Ollama | 0.3+ |

## Arranque rápido

```bash
# 1. Infraestructura Docker (PostgreSQL, Redis, RabbitMQ)
docker compose -f infrastructure/docker-compose.yml up -d

# 2. Modelo de lenguaje (necesario para el chat BT)
ollama pull gemma2:27b

# 3. Toda la plataforma en un solo comando
./start.sh

# Verificar que todo está en pie
./start.sh status
```

## Arranque manual (servicio a servicio)

```bash
# user-service
cd infrastructure/user-service
./mvnw quarkus:dev

# market-service
cd infrastructure/market-service
./mvnw quarkus:dev

# ai-engine
cd ai-engine
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8002 --reload

# frontend
cd frontend
npm install
npm run dev
```

## Parar la plataforma

```bash
./stop.sh
```

## AI Engine

### API principal

| Endpoint | Descripción |
|----------|-------------|
| `GET  /analizar/{symbol}` | Análisis LSTM + indicadores técnicos + señal |
| `POST /chat/stream` | Chat BT con streaming SSE |
| `GET  /chat/alertas` | Suscripción SSE a alertas proactivas |
| `GET  /mercado/{symbol}` | Datos de mercado en tiempo real |
| `GET  /sistema/health` | Estado del sistema y modelo |

### Probar BT desde la terminal

```bash
cd ai-engine
source .venv/bin/activate

# Modo interactivo
python chat_cli.py

# Mensaje único
python chat_cli.py "analiza bitcoin"
python chat_cli.py "¿debo comprar ETH ahora?"
python chat_cli.py "compra 100 dólares de solana"
```

### Reentrenar el modelo LSTM

```bash
cd ai-engine
source .venv/bin/activate
python -c "from app.reentrenamiento import reentrenar_modelo; import asyncio; asyncio.run(reentrenar_modelo())"
```

> Los modelos entrenados (`models/*.keras`, `models/*.gz`) no se incluyen en el repositorio y se regeneran automáticamente en el primer arranque si no existen.

## Variables de entorno

Crea un `.env` en la raíz del proyecto (no se commitea):

```env
# PostgreSQL
POSTGRES_USER=admin
POSTGRES_PASSWORD=adminpassword
POSTGRES_DB=crypto_platform

# RabbitMQ
RABBITMQ_DEFAULT_USER=admin
RABBITMQ_DEFAULT_PASS=adminpassword

# JWT (user-service)
JWT_SECRET=cambia_esto_en_produccion

# CORS (ai-engine)
CORS_ORIGINS=http://localhost:5173
```

## Estructura del proyecto

```
├── ai-engine/              # Motor de IA (Python/FastAPI)
│   ├── app/
│   │   ├── bt/             # Sistema BT: config, chat, memoria, alertas, trades
│   │   ├── fuentes/        # Fuentes externas: Fear & Greed, Reddit
│   │   ├── rutas/          # Routers FastAPI
│   │   ├── analisis.py     # Núcleo: realizar_analisis()
│   │   ├── calibracion.py  # Backtest y calibración de confianza
│   │   ├── indicadores.py  # RSI, MACD, Bollinger, ATR, VWAP…
│   │   ├── regimen.py      # Detector de régimen de mercado
│   │   └── sentimiento.py  # FinBERT para noticias
│   ├── models/             # Modelos entrenados (ignorados en git)
│   └── chat_cli.py         # CLI interactiva para probar BT
├── infrastructure/
│   ├── docker-compose.yml
│   ├── user-service/       # Quarkus: auth + JWT
│   └── market-service/     # Quarkus: cartera + órdenes
├── frontend/               # React + TypeScript + Vite
└── start.sh / stop.sh
```

## Logs

```bash
# Logs en tiempo real de cada servicio
tail -f .logs/ai-engine.log
tail -f .logs/user-service.log
tail -f .logs/market-service.log
tail -f .logs/frontend.log
```
