#!/bin/bash
# Para todos los servicios de CryptoAI Platform
# Uso: ./stop.sh [--keep-docker]

ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS="$ROOT/.pids"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}[OK]${NC}  $1"; }
info() { echo -e "${YELLOW}[..]${NC}  $1"; }

KEEP_DOCKER=0
[ "${1}" = "--keep-docker" ] && KEEP_DOCKER=1

echo ""
echo "  CryptoAI Platform — Shutdown"
echo "  ─────────────────────────────"
echo ""

# ── 1. Matar servicios por PID guardado ──────────────────────────────────────
for service in user-service market-service ai-engine frontend; do
  pidfile="$PIDS/$service.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      pkill -P "$pid" 2>/dev/null   # hijos (e.g. JVM lanzada por Maven)
      kill "$pid" 2>/dev/null
      ok "$service parado (PID $pid)"
    fi
    rm -f "$pidfile"
  fi
done

# ── 2. Fallback por puerto (por si no hay PIDs) ───────────────────────────────
for port in 8080 8081 8002 5173; do
  pid=$(ss -tlnp 2>/dev/null | awk -v p=":$port " '$4 ~ p {match($6,/pid=([0-9]+)/,a); print a[1]}')
  if [ -n "$pid" ]; then
    pkill -P "$pid" 2>/dev/null
    kill "$pid" 2>/dev/null
    info "Puerto $port liberado (PID $pid)"
  fi
done

# ── 3. Docker ─────────────────────────────────────────────────────────────────
if [ $KEEP_DOCKER -eq 0 ]; then
  info "Parando contenedores Docker..."
  docker compose -f "$ROOT/infrastructure/docker-compose.yml" down \
    > /dev/null 2>&1 && ok "PostgreSQL, Redis y RabbitMQ parados"
else
  info "Contenedores Docker mantenidos (--keep-docker)"
fi

echo ""
ok "Todo parado."
echo ""
