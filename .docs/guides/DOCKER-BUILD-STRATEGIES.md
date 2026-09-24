# Docker Build Strategies

Build and runtime strategies for development, production-like, and production environments.

## Environment modes

- **Dev**: fast feedback, mounted sources, watch mode.
- **Prod-like**: closer to production constraints for verification.
- **Prod**: minimal runtime footprint and stricter startup behavior.

## Build principles

1. Keep layers deterministic and cache-friendly.
2. Separate dependency installation from app copy where possible.
3. Minimize final image runtime surface.
4. Keep environment handling explicit and reproducible.

## Turbopack filesystem cache

Next.js can persist Turbopack's compilation work to disk and reuse it across
runs (`experimental.turbopackFileSystemCacheForDev` /
`turbopackFileSystemCacheForBuild`). The cache only pays off if the directory
survives the process — a container that starts from a clean layer gains
nothing.

### Cache locations

| Mode | Cache directory | Populated by |
|------|-----------------|--------------|
| dev  | `apps/<app>/.next/dev/cache/turbopack` | `next dev` |
| build | `apps/<app>/.next/cache/turbopack` | `next build` |

Dev mode uses a **dev-scoped distDir** (`.next/dev`), which is why the dev
cache is not at `.next/cache`. Verified on Next 16.3.4.

### How this repo persists it

**Compose-managed dev / prod** — a named volume per app, so `web` and `doc`
never share a cache directory (their graph roots differ):

| Stack | Service | Volume → container path |
|-------|---------|-------------------------|
| dev | `web-dev` | `web_next_cache_dev:/app/apps/web/.next/dev/cache` |
| dev | `doc-dev` | `doc_next_cache_dev:/app/apps/doc/.next/dev/cache` |
| prod | `web-prod` | `web_next_cache_prod:/app/apps/web/.next/cache` |
| prod | `doc-prod` | `doc_next_cache_prod:/app/apps/doc/.next/cache` |

Only the `cache/` directory is mounted — not the whole `.next` or `.next/dev`.
The dist-dir lock (`.next/dev/lock`, `experimental.lockDistDir`) therefore stays
on the container layer, so a recreated container always starts lock-free. (Next
also reclaims a leftover lock whose recorded PID is gone, so the volume could
not wedge startup even if a lock did land inside it.)

**Build-time prod images** — `next build` runs during `docker build`, where a
volume is not available. The build cache is instead persisted with a BuildKit
cache mount:

```dockerfile
RUN --mount=type=cache,target=/app/apps/web/.next/cache,sharing=locked,id=turbopack-web-prod-build \
    bunx turbo run build --filter=web... --remote-only
```

A BuildKit cache mount is **not committed to the image layer**, so the runner
stage recreates an empty `.next/cache` owned by the runtime user — the runtime
still needs it writable for the incremental (ISR/fetch) cache.

**Swarm prod** (`docker-stack.deploy.yml`) — deliberately has no cache volume.
Replicas use `update_config.order: start-first` with `max_replicas_per_node: 1`,
so two replicas overlap on the same node during a rolling update. Two Turbopack
processes writing one cache directory would corrupt it, and a volume that is not
node-pinned would produce wrong results across hosts.

### Ownership

The prod runners run as `nextjs` (uid 1001), and the web image builds at
container start. Docker seeds a **fresh** named volume with the ownership of the
image directory it shadows, so the image pre-creates the mountpoint:

```dockerfile
RUN mkdir -p /app/apps/web/.next/cache && \
    chown -R nextjs:nodejs /app/apps/web/.next
```

Without this, the first build on a new volume fails with `EACCES`.

### Resetting a cache

The cache is disposable — deleting the volume only costs one recompile:

```bash
docker volume rm <project>_web_next_cache_dev <project>_doc_next_cache_dev
```

## Common commands

```bash
bun run dev
bun run prod
bun run docker:build
```

## Troubleshooting focus

- Cache invalidation issues between image layers
- Environment mismatch between host and container
- Resource constraints (memory/CPU) causing build instability

## Related docs

- [Docker Compose](/docs/docker/docker-compose)
- [Production Deployment](/docs/deployment/production-deployment)
- [Environment Template System](/docs/tooling/environment-template-system)
