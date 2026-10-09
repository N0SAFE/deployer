# Q&A — Edge & Mesh: Business Logic

> **Module**: edge-mesh  
> **Category**: business-logic  
> **Last updated**: 2026-10-07

---

## How entry points combine

**Q**: How should entry points combine — lanes with per-app visibility, lanes with every app on every lane, or one stack-wide mode?

**A**: Lanes + per-app visibility. Local (`*.deployer.localhost`) is always on; a private mesh lane and one public provider can be enabled at the same time, each a separate Traefik entrypoint. Each service picks its visibility: `private` (local + mesh) or `public` (every enabled lane).

---

## Scope of "no single source of truth"

**Q**: Does "no single source of truth" also cover platform STATE (today one shared global Postgres every node connects to)?

**A**: "Find the best architecture for a self-hosted, auto-managed deployer application."

→ Decision taken (delegated): this pass makes the NETWORK peer-equal. Platform state stays in the shared Postgres for now; the recommended target (quorum-replicated state co-located with the swarm managers, node-owned facts in each node's local SQLite) is written up in `docs/edge-mesh-architecture.md` as the next step.

---

## Scope of this pass

**Q**: What should this pass deliver?

**A**: Full foundation: (1) close every unintended inbound port, (2) lanes + per-service visibility with Traefik entrypoints per lane and routes pulled from the API (no socket), (3) DNS split from ingress, (4) mesh core — identity, key-derived address, signed gossiped roster, link planner, a host-network agent that actually applies WireGuard, swarm over mesh addresses. The relay-over-session transport and the CLI peer come next, as typed stubs.

---

## Extensibility and the web (follow-up pass, 2026-10-08)

**Q** (directive from the operator, not a question asked): how should the edge and networking evolve after the foundation pass?

**A**: "Continue in this direction but make sure that everything is good. Make sure that everything is pluggable and that everything is layers so I can add other solutions alongside it, like a new tunnel provider or new functionality like this. Update the web app so it reflects perfectly how the app should behave. Make sure the UI for all networking systems and all node/mesh is good, well structured and that everything works together. You can make structural changes to the web app."

→ Decisions taken:
- The public lane names a registered **edge provider** (`provider` id + provider-validated `options`); providers are plugins implementing `EdgeProvider` and self-registering into `EdgeProviderRegistry`. Built in: `cloudflare-tunnel`, `direct`. Core code never names a provider.
- Provider state is per provider (`edge.<id>` cluster setting); one generic connector supervisor runs any tunnel provider's connector.
- The web gets one **Network** section (Overview, Ingress & edge, Mesh, DNS, Domains); the public-edge UI is rendered from the provider catalog, so a new provider needs no UI change.
- Legacy node-local edge rows are not migrated (v3 keeps no compatibility layers); the operator re-enables the public lane once.

---

## Setup wizard final step (follow-up pass, 2026-10-08)

**Q** (operator report, not a question asked): "the setup wizard final step stream does not show the right data, particularly when traefik changes to swarm managed: the disconnection occurs but the button to continue appears. There should be steps to verify that api and web are really reachable before being able to click on this button, and make sure everything goes along with it."

**A** → decisions taken:
- Root causes: (1) the stream was treated as finished at the API's `completed`, which arrives before the ingress swap that drops the connection, so nothing reconnected; (2) the client forced setup's unfinished steps to "done" as soon as the API spoke again, which unlocked the button with nothing proven; (3) a failed handover only changed the internal phase, so the stream never reported it; (4) a reconnect skipped history, so `completed`/`error` were never re-delivered.
- Two final verification steps (API, dashboard when requested), each routed-by-the-cluster-ingress (server) AND reachable-from-this-browser (client); both must pass; failure after 90 s offers re-check and "continue anyway" (a browser that cannot resolve the platform's hostnames is a real situation).
- Stream: finished only when the whole pipeline is done; "reconnecting" notice; terminal events replayed on re-sync; handover failures reported on the stream with a retry.
