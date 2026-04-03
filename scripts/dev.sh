#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}▸${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}!${NC} $*"; }
fail()  { echo -e "${RED}✗${NC} $*"; exit 1; }

cleanup() {
  echo ""
  info "Shutting down..."
  kill $API_PID $DASH_PID 2>/dev/null || true
  wait $API_PID $DASH_PID 2>/dev/null || true
  ok "Stopped all services."
}

# ── Check prerequisites ──────────────────────────────────────────────────────
command -v node >/dev/null 2>&1  || fail "node is required"
command -v npx  >/dev/null 2>&1  || fail "npx is required"

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Payment Orchestrator — Dev Setup     ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Start infrastructure (Docker or local) ────────────────────────────────
info "Checking infrastructure..."

PG_READY=false
REDIS_READY=false

# Check if PostgreSQL is already reachable
if pg_isready -h localhost -p 5432 -q 2>/dev/null; then
  PG_READY=true
  ok "PostgreSQL already running"
fi

# Check if Redis is already reachable
if redis-cli -h localhost -p 6379 ping >/dev/null 2>&1; then
  REDIS_READY=true
  ok "Redis already running"
fi

# Start via Docker if needed
if [ "$PG_READY" = false ] || [ "$REDIS_READY" = false ]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    info "Starting PostgreSQL + Redis via Docker..."
    docker compose up -d postgres redis --wait 2>/dev/null \
      || docker-compose up -d postgres redis 2>/dev/null \
      || fail "Could not start Docker services. Start PostgreSQL and Redis manually."
    ok "Docker services running"
  else
    [ "$PG_READY" = false ] && fail "PostgreSQL not available. Install Docker or start PostgreSQL on port 5432."
    [ "$REDIS_READY" = false ] && warn "Redis not available — the app will run without cache/queues."
  fi
fi

# ── 2. Install dependencies ──────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  info "Installing root dependencies..."
  npm install --silent
fi

if [ ! -d "dashboard/node_modules" ]; then
  info "Installing dashboard dependencies..."
  (cd dashboard && npm install --silent)
fi

ok "Dependencies installed"

# ── 3. Generate Prisma client & run migrations ───────────────────────────────
info "Generating Prisma client..."
npx prisma generate --no-hints 2>/dev/null

info "Running database migrations..."
npx prisma migrate deploy 2>/dev/null
ok "Database migrated"

# ── 4. Seed demo data ────────────────────────────────────────────────────────
info "Seeding demo data..."
npx tsx prisma/seed.ts
ok "Database seeded"

# ── 5. Start API server ──────────────────────────────────────────────────────
info "Starting API server (port 3000)..."
npx tsx src/main.ts &
API_PID=$!

# Wait for API to be healthy
for i in $(seq 1 30); do
  if curl -s http://localhost:3000/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if curl -s http://localhost:3000/health >/dev/null 2>&1; then
  ok "API server ready at http://localhost:3000"
else
  warn "API server may still be starting..."
fi

# ── 6. Start dashboard ───────────────────────────────────────────────────────
info "Starting dashboard (port 3001)..."
(cd dashboard && PORT=3001 npx next dev -p 3001) &
DASH_PID=$!

sleep 3
ok "Dashboard starting at http://localhost:3001"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${GREEN}  All services running!${NC}"
echo ""
echo -e "  API:         ${BLUE}http://localhost:3000${NC}"
echo -e "  Dashboard:   ${BLUE}http://localhost:3001${NC}"
echo -e "  GraphQL:     ${BLUE}http://localhost:3000/graphql${NC}"
echo ""
echo -e "  Login:       demo@acme.com / demo1234"
echo ""
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop all services."
echo -e "${GREEN}══════════════════════════════════════════════${NC}"
echo ""

trap cleanup SIGINT SIGTERM
wait
