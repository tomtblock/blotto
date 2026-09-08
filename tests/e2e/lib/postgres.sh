#!/usr/bin/env bash
# Postgres stage for the end-to-end lifecycle bench. Carried from the predecessor repository.
#
# WHY A SEPARATE DATABASE AND PORT:
# A dev-bench database and the end-to-end database must never be the same instance. The
# end-to-end stage resets its schema between runs, so pointing it at a standing dev database
# would destroy fixtures that are deliberately kept there. The old repo separated the two after
# exactly that collision. Hence a dedicated container, port and database name:
#   blotto-e2e-postgres : 55432 : blotto_e2e
# Nothing here touches :5432, so a dev bench keeps running through an end-to-end run.
#
# Migrated through the indexer's OWN migrate path, not a hand-written schema — the migrations
# are part of what the end-to-end run is proving. Today that is
# backend/_shared/migrations/0001_events_ledger.sql, the generic event ledger and nothing else;
# the derived tables are Phase 2 work against the TECH-ARCH §3.3 event list.

# shellcheck source=./common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

postgres_running() {
  [ "$(docker inspect -f '{{.State.Running}}' "$E2E_PG_CONTAINER" 2>/dev/null)" = "true" ]
}

postgres_ready() {
  docker exec "$E2E_PG_CONTAINER" pg_isready -U "$E2E_PG_USER" -d "$E2E_PG_DB" >/dev/null 2>&1
}

postgres_start() {
  if postgres_running; then
    log "postgres container $E2E_PG_CONTAINER already running on :$E2E_PG_PORT"
  else
    # Remove a stopped container of the same name so `run` cannot fail on the name collision.
    docker rm -f "$E2E_PG_CONTAINER" >/dev/null 2>&1 || true
    log "starting $E2E_PG_CONTAINER on :$E2E_PG_PORT (db $E2E_PG_DB)"
    # No named volume: the end-to-end database is deliberately EPHEMERAL. `postgres_stop` removes the
    # container and its unnamed scratch storage, so every run starts from a clean, migrated schema and
    # nothing survives to be inherited by the next run.
    docker run -d --rm \
      --name "$E2E_PG_CONTAINER" \
      -e POSTGRES_USER="$E2E_PG_USER" \
      -e POSTGRES_PASSWORD="$E2E_PG_PASSWORD" \
      -e POSTGRES_DB="$E2E_PG_DB" \
      -p "127.0.0.1:${E2E_PG_PORT}:5432" \
      postgres:16-alpine >/dev/null || die "could not start $E2E_PG_CONTAINER"
  fi
  poll_until 60 "postgres ready on :$E2E_PG_PORT" postgres_ready \
    || die "postgres did not become ready; see: docker logs $E2E_PG_CONTAINER"
  log "postgres ready"
}

postgres_migrate() {
  log "applying indexer migrations to $E2E_PG_DB (backend/indexer migrate)"
  ( cd "$REPO_ROOT" && BLOTTO_DATABASE_URL="$E2E_DATABASE_URL" \
      yarn --cwd backend/indexer migrate ) || die "indexer migrate failed"
}

# Convenience psql into the end-to-end database ONLY. Guarded on the container name so a typo can
# never land on the B bench.
postgres_psql() {
  docker exec -i "$E2E_PG_CONTAINER" psql -U "$E2E_PG_USER" -d "$E2E_PG_DB" "$@"
}

postgres_stop() {
  if docker inspect "$E2E_PG_CONTAINER" >/dev/null 2>&1; then
    log "removing $E2E_PG_CONTAINER"
    docker rm -f "$E2E_PG_CONTAINER" >/dev/null 2>&1 || true
  fi
}
