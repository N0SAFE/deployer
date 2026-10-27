import type { OrchestratorSubService } from '../runner-types'

/** Common container image presets for fluent image selection. */
export const IMAGE_PRESETS = [
  'node:22-alpine', 'node:20-alpine', 'nginx:alpine', 'nginx:latest',
  'postgres:16-alpine', 'postgres:15-alpine', 'redis:7-alpine',
  'python:3.12-slim', 'python:3.11-slim', 'ghcr.io/your-org/app:latest',
] as const

/** Common healthcheck commands for fluent selection. */
export const HEALTHCHECK_PRESETS = [
  'CMD-SHELL curl -f http://localhost:3000/health',
  'CMD-SHELL wget -q --spider http://localhost:3000/health',
  'CMD-SHELL pg_isready -U postgres',
  'CMD-SHELL redis-cli ping',
  'CMD exit 0',
] as const

/* ─── Sub-service editor (progressive disclosure) ──────────────────── */

export function emptySubService(index: number): OrchestratorSubService {
  return {
    name: `svc-${String(index + 1)}`,
    image: '',
    ports: [],
    visibility: 'public',
    tls: { enabled: false, httpRedirect: true },
    networks: [],
    customDomains: [],
    environment: {},
    volumes: [],
    labels: {},
    secrets: [],
    dependsOn: [],
    dependsOnCondition: 'service_started',
    replicas: 1,
    restart: 'no',
    build: { args: {} },
  }
}
