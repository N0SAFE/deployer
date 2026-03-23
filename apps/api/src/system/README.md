# System Layer (v3)

This folder defines the **system-facing boundary** for outward synchronization concerns.

## Boundaries

- `src/modules/**`: user/business API modules (contracts and handlers consumed by product features).
- `src/core/**`: shared internal building blocks (services, repositories, domain infrastructure). Core should stay reusable and avoid being the direct external boundary.
- `src/system/**`: system orchestration and external synchronization boundary (cross-system sync, orchestration outputs, infrastructure-facing controllers/adapters).

## Current scope

- `system/modules/event-sync`: exposes event synchronization endpoints by composing `core/modules/events` services.
- `system/modules/mesh`: exposes fleet mesh topology/control endpoints (local node state, peer links, topology stream, control envelope forwarding).

## Rule of thumb

If a capability is primarily about **platform-to-platform synchronization** or **whole-system orchestration output**, it belongs in `system`.
