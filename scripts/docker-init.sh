#!/bin/bash
#
# Initialize docker compose environment for local development
# This script:
#   1. Stops and removes existing containers/volumes (fresh start)
#   2. Starts PostgreSQL
#   3. Waits for it to be ready
#   4. Runs database migrations
#   5. Optionally starts the web app
#
# Usage:
#   ./scripts/docker-init.sh         # Full reset + migrations + start web
#   ./scripts/docker-init.sh --db    # Only reset DB and run migrations (no web)
#   ./scripts/docker-init.sh --keep  # Keep existing data, just run migrations
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Parse arguments
SKIP_WEB=false
KEEP_DATA=false

for arg in "$@"; do
    case $arg in
        --db)
            SKIP_WEB=true
            ;;
        --keep)
            KEEP_DATA=true
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --db     Only initialize database (skip web app)"
            echo "  --keep   Keep existing data (only run migrations)"
            echo "  --help   Show this help message"
            exit 0
            ;;
    esac
done

# Check for .env file
if [ ! -f "$PROJECT_ROOT/.env" ] && [ ! -f "$PROJECT_ROOT/.env.local" ]; then
    log_warn "No .env or .env.local file found. Creating from .env.example..."
    if [ -f "$PROJECT_ROOT/.env.example" ]; then
        cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
        log_info "Created .env from .env.example. Please update with your values."
    else
        log_error ".env.example not found. Please create .env manually."
        exit 1
    fi
fi

# Stop existing containers
log_info "Stopping existing containers..."
docker compose down 2>/dev/null || true

# Reset volumes if not keeping data
if [ "$KEEP_DATA" = false ]; then
    log_warn "Removing existing database volume (fresh start)..."
    docker compose down -v 2>/dev/null || true
fi

# Start PostgreSQL only first
log_info "Starting PostgreSQL..."
docker compose up -d postgres

# Wait for PostgreSQL to be ready
log_info "Waiting for PostgreSQL to be ready..."
MAX_RETRIES=30
RETRY_COUNT=0

while ! docker compose exec -T postgres pg_isready -U manicode_user_local -d manicode_db_local > /dev/null 2>&1; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        log_error "PostgreSQL failed to start after $MAX_RETRIES attempts"
        docker compose logs postgres
        exit 1
    fi
    echo -n "."
    sleep 1
done
echo ""
log_info "PostgreSQL is ready!"

# Run migrations using drizzle-kit push
log_info "Running database migrations..."

# Set DATABASE_URL for docker compose postgres (internal port 5432 -> external 5433)
export DATABASE_URL="postgresql://manicode_user_local:secretpassword_local@localhost:5433/manicode_db_local"

# Run migrations from the internal package
cd "$PROJECT_ROOT/packages/internal"
if ! bun run db:migrate; then
    log_error "Migration failed!"
    exit 1
fi
cd "$PROJECT_ROOT"

log_info "Migrations completed successfully!"

# Seed default agents for agent store
log_info "Seeding default agents..."
cd "$PROJECT_ROOT"
if bun run scripts/seed-default-agents.ts; then
    log_info "Default agents seeded successfully!"
else
    log_warn "Failed to seed default agents. Agent store may be empty."
fi

# Start web app if not skipped
if [ "$SKIP_WEB" = false ]; then
    log_info "Starting web application..."
    docker compose up -d web
    
    log_info "Waiting for web app to be healthy..."
    MAX_RETRIES=60
    RETRY_COUNT=0
    
    while ! curl -s http://localhost:9999/api/healthz > /dev/null 2>&1; do
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
            log_warn "Web app health check timed out. Check logs with: docker compose logs web"
            break
        fi
        echo -n "."
        sleep 2
    done
    echo ""
    
    if curl -s http://localhost:9999/api/healthz > /dev/null 2>&1; then
        log_info "Web app is ready at http://localhost:9999"
    fi
fi

echo ""
log_info "============================================"
log_info "Docker environment initialized successfully!"
log_info "============================================"
echo ""
echo "Database:"
echo "  Host: localhost:5433"
echo "  User: manicode_user_local"
echo "  Pass: secretpassword_local"
echo "  DB:   manicode_db_local"
echo ""
if [ "$SKIP_WEB" = false ]; then
    echo "Web App: http://localhost:9999"
    echo ""
fi
echo "Useful commands:"
echo "  docker compose logs -f web      # Follow web logs"
echo "  docker compose logs -f postgres # Follow DB logs"
echo "  docker compose down             # Stop all"
echo "  docker compose down -v          # Stop and remove volumes"
echo ""
