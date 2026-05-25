#!/bin/bash
# Arranca toda la plataforma CryptoAI
# Uso: ./start.sh [status]

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG="$ROOT/.logs"
PIDS="$ROOT/.pids"
mkdir -p "$LOG" "$PIDS"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC}  $1"; }
info() { echo -e "${YELLOW}[..]${NC}  $1"; }
err()  { echo -e "${RED}[ERR]${NC} $1"; }
head_() { echo -e "${CYAN}$1${NC}"; }

# ── Status ────────────────────────────────────────────────────────────────────
if [ "${1}" = "status" ]; then
  echo ""
  head_ "  CryptoAI Platform — Estado"
  echo "  ───────────────────────────"
  declare -A PORTS=([user-service]=8080 [market-service]=8081 [ai-engine]=8002 [frontend]=5173)
  for svc in user-service market-service ai-engine frontend; do
    port=${PORTS[$svc]}
    if nc -z localhost "$port" 2>/dev/null; then
      ok "$svc  :$port  ● corriendo"
    else
      err "$svc  :$port  ○ parado"
    fi
  done
  echo ""
  docker compose -f "$ROOT/infrastructure/docker-compose.yml" ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null
  echo ""
  exit 0
fi

# ── Pre-flight checks ─────────────────────────────────────────────────────────
echo ""
head_ "  CryptoAI Platform — Startup"
echo "  ────────────────────────────"
echo ""
info "Comprobando dependencias..."
missing=0
for cmd in docker java python3 node npm nc; do
  command -v "$cmd" &>/dev/null || { err "Falta: $cmd"; missing=1; }
done
[ $missing -eq 1 ] && { err "Instala las dependencias que faltan y vuelve a intentarlo."; exit 1; }
ok "Todas las dependencias disponibles"

# ── Helpers ───────────────────────────────────────────────────────────────────
port_in_use() { nc -z localhost "$1" 2>/dev/null; }

wait_for_port() {
  local port=$1 name=$2 retries=${3:-30}
  while ! nc -z localhost "$port" 2>/dev/null; do
    sleep 2
    retries=$((retries - 1))
    if [ $retries -eq 0 ]; then
      err "$name no levantó en :$port"
      echo ""
      err "Últimas líneas del log:"
      tail -20 "$LOG/$name.log" 2>/dev/null | sed 's/^/    /'
      echo ""
      return 1
    fi
  done
  ok "$name listo en :$port"
}

wait_for_health() {
  local url=$1 name=$2 retries=${3:-30}
  while ! curl -sf "$url" &>/dev/null; do
    sleep 2
    retries=$((retries - 1))
    if [ $retries -eq 0 ]; then
      err "$name no respondió en $url"
      echo ""
      err "Últimas líneas del log:"
      tail -20 "$LOG/$name.log" 2>/dev/null | sed 's/^/    /'
      echo ""
      return 1
    fi
  done
  ok "$name healthy ($url)"
}

# ── 0. Ollama ─────────────────────────────────────────────────────────────────
if command -v ollama &>/dev/null; then
  if ! nc -z localhost 11434 2>/dev/null; then
    info "Iniciando Ollama (gemma2:27b)..."
    ollama serve > "$LOG/ollama.log" 2>&1 &
    echo $! > "$PIDS/ollama.pid"
    sleep 3
    ok "Ollama listo en :11434"
  else
    ok "Ollama ya está corriendo en :11434 (omitiendo)"
  fi
else
  info "Ollama no instalado — el chat no estará disponible"
fi

# ── 1. Infraestructura Docker ─────────────────────────────────────────────────
info "Levantando PostgreSQL, Redis y RabbitMQ..."
docker compose -f "$ROOT/infrastructure/docker-compose.yml" up -d \
  > "$LOG/docker.log" 2>&1
wait_for_port 5432 "PostgreSQL" 20 || exit 1
wait_for_port 6379 "Redis"      20 || exit 1
wait_for_port 5672 "RabbitMQ"   20 || exit 1

# ── 2. User Service + Market Service en paralelo ──────────────────────────────
if ! port_in_use 8080; then
  info "Iniciando user-service (puerto 8080)..."
  cd "$ROOT/backend/user-service"
  ./mvnw quarkus:dev -Dquarkus.http.host=0.0.0.0 \
    > "$LOG/user-service.log" 2>&1 &
  echo $! > "$PIDS/user-service.pid"
else
  ok "user-service ya está corriendo en :8080 (omitiendo)"
fi

if ! port_in_use 8081; then
  info "Iniciando market-service (puerto 8081)..."
  cd "$ROOT/backend/market-service"
  ./mvnw quarkus:dev -Dquarkus.http.host=0.0.0.0 -Ddebug=5006 \
    > "$LOG/market-service.log" 2>&1 &
  echo $! > "$PIDS/market-service.pid"
else
  ok "market-service ya está corriendo en :8081 (omitiendo)"
fi

# Esperar ambos en paralelo
wait_for_health "http://localhost:8080/q/health/live" "user-service"   60 &
WH1=$!
wait_for_health "http://localhost:8081/q/health/live" "market-service" 60 &
WH2=$!
wait $WH1 $WH2

# ── 3. AI Engine + Frontend en paralelo ──────────────────────────────────────
if ! port_in_use 8002; then
  info "Iniciando ai-engine (puerto 8002)..."
  cd "$ROOT/ai-engine"
  if [ ! -d ".venv" ]; then
    info "Creando entorno virtual Python..."
    python3 -m venv .venv > "$LOG/ai-engine-install.log" 2>&1
    .venv/bin/pip install -r requirements.txt >> "$LOG/ai-engine-install.log" 2>&1
    ok "Dependencias Python instaladas"
  fi
  nohup .venv/bin/python main.py > "$LOG/ai-engine.log" 2>&1 &
  PID_AE=$!
  disown -h $PID_AE
  echo $PID_AE > "$PIDS/ai-engine.pid"
else
  ok "ai-engine ya está corriendo en :8002 (omitiendo)"
fi

if ! port_in_use 5173; then
  info "Iniciando frontend (puerto 5173)..."
  cd "$ROOT/frontend"
  if [ ! -d "node_modules" ]; then
    info "Instalando dependencias npm..."
    npm install > "$LOG/frontend-install.log" 2>&1
  fi
  npm run dev > "$LOG/frontend.log" 2>&1 &
  echo $! > "$PIDS/frontend.pid"
else
  ok "frontend ya está corriendo en :5173 (omitiendo)"
fi

wait_for_health "http://localhost:8002/health" "ai-engine" 30 &
WH3=$!
wait_for_port   5173                           "frontend"  30 &
WH4=$!
wait $WH3 $WH4

# ── Resumen ───────────────────────────────────────────────────────────────────
echo ""
ok "══════════════════════════════════════════════"
ok "  Todo levantado. Abre http://localhost:5173  "
ok "══════════════════════════════════════════════"
echo ""
echo "  Servicios:"
echo "    Frontend       → http://localhost:5173"
echo "    User Service   → http://localhost:8080"
echo "    Market Service → http://localhost:8081"
echo "    AI Engine      → http://localhost:8002"
echo "    RabbitMQ UI    → http://localhost:15672  (admin/adminpassword)"
echo "    Swagger Market → http://localhost:8081/q/swagger-ui"
echo "    Swagger User   → http://localhost:8080/q/swagger-ui"
echo ""
echo "  Logs:   $LOG/"
echo "  Estado: ./start.sh status"
echo "  Parar:  ./stop.sh"
echo ""
