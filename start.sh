#!/bin/bash
# Arranca toda la plataforma CryptoAI
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG="$ROOT/.logs"
mkdir -p "$LOG"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC} $1"; }
info() { echo -e "${YELLOW}[..] $1${NC}"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; }

wait_for_port() {
  local port=$1 name=$2 retries=30
  info "Esperando $name en :$port..."
  while ! nc -z localhost "$port" 2>/dev/null; do
    sleep 2
    retries=$((retries - 1))
    [ $retries -eq 0 ] && { err "$name no levantó en :$port"; return 1; }
  done
  ok "$name listo en :$port"
}

echo ""
echo "  CryptoAI Platform — Startup"
echo "  ────────────────────────────"
echo ""

# 1. Infraestructura (Docker)
info "Levantando PostgreSQL, Redis y RabbitMQ..."
docker compose -f "$ROOT/infrastructure/docker-compose.yml" up -d \
  > "$LOG/docker.log" 2>&1
wait_for_port 5432  "PostgreSQL"
wait_for_port 6379  "Redis"
wait_for_port 5672  "RabbitMQ"

# 2. User Service
info "Iniciando user-service (puerto 8080)..."
cd "$ROOT/backend/user-service"
./mvnw quarkus:dev -Dquarkus.http.host=0.0.0.0 \
  > "$LOG/user-service.log" 2>&1 &
wait_for_port 8080 "user-service"

# 3. Market Service
info "Iniciando market-service (puerto 8081)..."
cd "$ROOT/backend/market-service"
./mvnw quarkus:dev -Dquarkus.http.host=0.0.0.0 \
  > "$LOG/market-service.log" 2>&1 &
wait_for_port 8081 "market-service"

# 4. AI Engine
info "Iniciando ai-engine (puerto 8002)..."
cd "$ROOT/ai-engine"
if [ ! -d ".venv" ]; then
  info "Creando entorno virtual Python..."
  python3 -m venv .venv > "$LOG/ai-engine-install.log" 2>&1
  .venv/bin/pip install -r requirements.txt >> "$LOG/ai-engine-install.log" 2>&1
  ok "Dependencias Python instaladas"
fi
.venv/bin/python main.py > "$LOG/ai-engine.log" 2>&1 &
wait_for_port 8002 "ai-engine"

# 5. Frontend
info "Iniciando frontend (puerto 5173)..."
cd "$ROOT/frontend"
if [ ! -d "node_modules" ]; then
  info "Instalando dependencias npm..."
  npm install > "$LOG/frontend-install.log" 2>&1
fi
npm run dev > "$LOG/frontend.log" 2>&1 &
wait_for_port 5173 "frontend"

echo ""
ok "═══════════════════════════════════════════"
ok " Todo levantado. Abre http://localhost:5173"
ok "═══════════════════════════════════════════"
echo ""
echo "  Servicios:"
echo "    Frontend      → http://localhost:5173"
echo "    User Service  → http://localhost:8080"
echo "    Market Service→ http://localhost:8081"
echo "    AI Engine     → http://localhost:8002"
echo "    RabbitMQ UI   → http://localhost:15672  (admin/adminpassword)"
echo "    Swagger Market→ http://localhost:8081/q/swagger-ui"
echo "    Swagger User  → http://localhost:8080/q/swagger-ui"
echo ""
echo "  Logs en: $LOG/"
echo "  Para parar todo: ./stop.sh"
echo ""
