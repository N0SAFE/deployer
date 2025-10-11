#!/bin/sh
set -e

# Ensure Traefik configuration directory structure exists
echo 'Creating Traefik configuration directory structure...'
TRAEFIK_BASE_PATH="${TRAEFIK_CONFIG_BASE_PATH:-/app/traefik-configs}"
mkdir -p "${TRAEFIK_BASE_PATH}/dynamic"
mkdir -p "${TRAEFIK_BASE_PATH}/certs"
mkdir -p "${TRAEFIK_BASE_PATH}/logs"
mkdir -p "${TRAEFIK_BASE_PATH}/plugins"
echo 'Traefik directory structure created'

if [ -z "$SKIP_MIGRATIONS" ]; then
  if [ -f apps/api/package.json ]; then
    echo 'Found apps/api/package.json - running migrations'
    bun run --cwd apps/api db:migrate || echo 'db:migrate failed (continuing)'
    
    if [ -z "$SKIP_SEED" ]; then
      echo 'Running database seeding (if not already seeded)'
      bun run --cwd apps/api db:seed || echo 'db:seed failed (continuing)'
    else
      echo 'SKIP_SEED set, skipping database seeding'
    fi
  else
    echo 'apps/api/package.json missing even after restore, skipping migrations and seeding'
  fi
else
  echo 'SKIP_MIGRATIONS set, skipping migrations and seeding'
fi

exec /usr/bin/supervisord -c /etc/supervisord.conf
