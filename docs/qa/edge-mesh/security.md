# Q&A — Edge & Mesh: Security

> **Module**: edge-mesh  
> **Category**: security  
> **Last updated**: 2026-10-07

---

## `direct` public ingress

**Q**: Should `direct` (public IP + open :80/:443 on the node) remain available at all — as an explicit opt-in, or removed entirely so the no-inbound-port invariant is absolute?

**A**: "That depends on the strategy, find the best way."

→ Decision taken (delegated): keep `direct` as an explicit, per-stack opt-in that requires an acknowledgement. Under the mesh-first design a node that opts into `direct` is also a reachable rendezvous for the other members, so it strengthens the mesh rather than being an exception to it. Every other path stays outbound-only.

---

## Operator access to the private lane

**Q**: How should an operator's laptop reach the private lane with no inbound port on any node — the Deployer CLI joining as a peer, a plain WireGuard config export, or deferring operator access?

**A**: Deployer CLI joins as a peer (`deployer mesh connect` runs the same agent; the laptop becomes a non-scheduling member). Delivered as a typed stub in this pass, implemented in the next.

---

## Who may change the edge or the mesh (follow-up pass, 2026-10-08)

**Decision** (derived from the invariant, not asked): changing lanes, the public edge, or revoking a mesh member requires a platform admin (`requirePlatformRole(["superAdmin", "admin"])`); reading the state requires any authenticated user. Every published host port in the compose files binds `127.0.0.1`; only an inbound edge provider with `acknowledgedInboundPorts: true` makes Traefik publish on the host.
