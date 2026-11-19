#!/usr/bin/env bash
# Prepara una base PostgreSQL DESECHABLE para pruebas y ejecuta un comando con TEST_DATABASE_URL.
#
#   scripts/test-db.sh <comando...>
#
# - Si TEST_DATABASE_URL ya está definida (CI), la usa tal cual: la base se BORRA y se recrea.
# - Si no, arranca un clúster temporal con los binarios locales de PostgreSQL (initdb/pg_ctl) en un
#   directorio temporal, y lo destruye al terminar.
# Nunca apuntes TEST_DATABASE_URL a una base con datos reales.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cleanup_cmd=""

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
    PG_BIN="$(dirname "$(command -v initdb 2>/dev/null || echo /nonexistent/initdb)")"
  fi
  if [[ ! -x "$PG_BIN/initdb" ]]; then
    echo "No hay PostgreSQL local (initdb). Define TEST_DATABASE_URL con una base desechable." >&2
    exit 2
  fi

  TMP="$(mktemp -d)"
  PORT="${TEST_PG_PORT:-55432}"
  RUN=()
  if [[ "$(id -u)" == "0" ]]; then
    chown postgres "$TMP"
    RUN=(runuser -u postgres --)
  fi
  "${RUN[@]}" "$PG_BIN/initdb" -D "$TMP/data" -U postgres -A trust >/dev/null
  "${RUN[@]}" "$PG_BIN/pg_ctl" -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses=127.0.0.1" -l "$TMP/log" -w start >/dev/null
  cleanup_cmd="${RUN[*]} $PG_BIN/pg_ctl -D $TMP/data -m immediate stop >/dev/null; rm -rf $TMP"
  trap 'eval "$cleanup_cmd"' EXIT
  export TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
fi

node "$ROOT/scripts/prepare-test-db.mjs"
"$@"
