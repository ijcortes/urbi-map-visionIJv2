#!/usr/bin/env bash
# Medellín Social — arranca postgres (docker) + backend (FastAPI) + frontend (Vite)
# Uso: ./start.sh            (API en $API_PORT, frontend en 5173)
#      API_PORT=8001 ./start.sh   para otro puerto
# Detener: Ctrl+C  (mata todos los procesos)
#
# Default 8011: Cursor (Windows) suele secuestrar localhost:8001 con un
# port-forward stale → el browser recibe 404/CORS aunque el API esté vivo en WSL.
API_PORT="${API_PORT:-8011}"
WEB_PORT="${WEB_PORT:-5173}"

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/.logs"
mkdir -p "$LOG_DIR"

# Cargar variables de entorno desde .env (sin sobreescribir las ya exportadas)
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
  set +a
fi

BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

cleanup() {
  echo ""
  echo "Deteniendo servicios..."
  kill "$BACKEND_PID" "$FRONTEND_PID" "$TAIL_PID" 2>/dev/null || true
  wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
  echo "Listo."
  exit 0
}
trap cleanup SIGINT SIGTERM

cd "$SCRIPT_DIR"

# ── 0. Liberar puertos de arranques anteriores ────────────────────────────────
for p in "$API_PORT" "$WEB_PORT"; do
  if fuser "$p/tcp" >/dev/null 2>&1; then
    echo "Liberando puerto $p..."
    fuser -k "$p/tcp" >/dev/null 2>&1 || true
    sleep 1
  fi
done

# ── 1. PostgreSQL (Docker, puerto 5433) ──────────────────────────────────────
POSTGRES_CONTAINER="social-postgres"
if ! docker inspect "$POSTGRES_CONTAINER" --format '{{.State.Status}}' 2>/dev/null | grep -q "running"; then
  echo "Iniciando postgres (docker)..."
  docker start "$POSTGRES_CONTAINER" 2>/dev/null \
    || docker compose up -d postgres 2>/dev/null
  echo -n "Esperando postgres"
  for i in $(seq 1 20); do
    if psql "${DATABASE_URL:?DATABASE_URL no definido en .env}" \
         -c "SELECT 1" -q >/dev/null 2>&1; then
      echo " OK"
      break
    fi
    echo -n "."
    sleep 1
  done
else
  echo "Postgres ya está corriendo."
fi

# ── 2. Backend (FastAPI + uvicorn) ────────────────────────────────────────────
# `python -m uvicorn`: usa el env del python activo (miniconda, fastapi>=0.110).
# El binario de ~/.local/bin apunta al python del sistema con fastapi 0.109,
# que rompe Optional[List[UploadFile]] (uploads de /publicar).
echo "Iniciando backend  → http://localhost:$API_PORT"
: > "$BACKEND_LOG"
ENV=dev python -m uvicorn api.main:app --host 0.0.0.0 --port "$API_PORT" \
  > "$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

echo -n "Esperando backend"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$API_PORT/health" >/dev/null 2>&1; then
    echo " OK"
    break
  fi
  echo -n "."
  sleep 1
done

# ── 3. Frontend (Vite) ───────────────────────────────────────────────────────
echo "Iniciando frontend → http://localhost:$WEB_PORT"
: > "$FRONTEND_LOG"
if [ ! -d node_modules ]; then
  echo "Instalando dependencias del frontend..."
  npm install
fi
# VITE_API_URL como env real del proceso: gana sobre .env/.env.local, así el
# frontend SIEMPRE apunta al backend que este script levantó. En prod nadie
# ejecuta esto — el default de src/config/api.ts resuelve a Railway.
VITE_API_URL="http://localhost:$API_PORT/api/v1" npm run dev -- --host --port "$WEB_PORT" \
  > "$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!

sleep 3
# Detectar puerto real en caso de colisión
FRONTEND_URL=$(grep -oP 'Local:\s+\Khttp://localhost:[0-9]+' "$FRONTEND_LOG" 2>/dev/null | head -1 || echo "http://localhost:$WEB_PORT")

echo ""
echo "────────────────────────────────────────────────────"
echo "  Backend PID  : $BACKEND_PID"
echo "  Frontend PID : $FRONTEND_PID"
echo ""
echo "  API          : http://localhost:$API_PORT/api/v1"
echo "  API docs     : http://localhost:$API_PORT/docs"
echo "  Mapa         : $FRONTEND_URL"
echo "────────────────────────────────────────────────────"
echo "Logs: .logs/backend.log | .logs/frontend.log"
echo "Ctrl+C para detener todo."
echo ""

# Tail ambos logs intercalados
tail -f "$BACKEND_LOG" "$FRONTEND_LOG" &
TAIL_PID=$!

# Morir si cualquier proceso hijo muere
wait "$BACKEND_PID" "$FRONTEND_PID"
kill "$TAIL_PID" 2>/dev/null || true
cleanup
