# AGENTS.md — apps/api/src/system (Internal Control Plane)

This folder is **internal-only** infrastructure for node-to-node and control-plane operations.

## Purpose

`src/system/**` is reserved for low-level platform internals such as:
- mesh coordination and membership
- fleet allocator control-plane internals
- intra-cluster diagnostics and signed internal operations

These endpoints are not product-facing feature APIs.

## Boundary Rules (Mandatory)

- Do **not** place user-facing product modules here (`project`, `service`, `deployment`, `docker` dashboard APIs, etc.).
- Feature APIs that are consumed by authenticated users/web UI belong in `src/modules/**`.
- `src/system/**` handlers must stay control-plane focused and keep strict internal auth/middleware expectations.
- If a feature starts in `system` and later becomes product-facing, migrate it to `src/modules/**` and keep `system` as transport/control only.

## Practical routing guidance

- `src/system/**` => internal control-plane contracts/endpoints.
- `src/modules/**` => public/authenticated application contracts/endpoints.

Keep these boundaries explicit to avoid leaking internal infrastructure contracts into user-facing APIs.
