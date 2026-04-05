#!/bin/bash
# Para todos los servicios de CryptoAI Platform

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Parando CryptoAI Platform..."

# Matar procesos por puerto
for port in 8080 8081 8002 5173; do
  pid=$(lsof -ti :$port 2>/dev/null)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null && echo "  Puerto $port liberado (PID $pid)"
  fi
done

# Parar Docker
docker compose -f "$ROOT/infrastructure/docker-compose.yml" down \
  > /dev/null 2>&1 && echo "  Docker services parados"

echo "Listo."
