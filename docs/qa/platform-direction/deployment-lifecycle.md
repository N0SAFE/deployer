# Q&A — Platform Direction: Deployment Lifecycle

> **Module**: platform-direction  
> **Category**: deployment-lifecycle  
> **Last updated**: 2026-03-04

---

## Rollback model

**Q**: What is the rollback / deployment swap model?

**A**: Both — configurable per service. Each service can be configured to use:
- **Immutable deploys**: keep old image, swap atomically
- **In-place redeploy**: rebuild/pull from source

---

## Environment variable hot-reload

**Q**: Should updating environment variables restart the container, or inject live without redeploy?

**A**: User chooses **per variable**. Requirements:
- Visual indicator showing whether a variable is "live" (hot-injected) or "requires redeployment" (build/restart-bound)
- When only env vars change (no Dockerfile / build config change), rollback of just the env should be possible
- Warnings should explain the reason for the rollback (e.g. "rolled back env var X because of failed deploy Y")

Implementation notes:
- A variable can be tagged as `live` (hot-injectable) or `rebuild-required`
- UI badge per variable showing current mode
- Env-only rollback history tracked separately from full deployment rollback history

---

## Cluster scale ceiling

**Q**: What is the expected maximum number of nodes per cluster?

**A**: No fixed ceiling — platform should scale from 1 to 20+ nodes and aim for everyone (personal projects as well as larger teams). The LB gossip TTL / max hops must be tunable per cluster size. Default (2 hops, 30s TTL) covers small clusters; larger clusters may need increased hop count or a hub-and-spoke gossip topology.

---

## Real-time logs

**Q**: What is the target real-time UX for deployment and runtime logs?

**A**: **SSE bidirectional using the ORPC input/output event iterator.** Not plain WebSocket and not plain SSE — use the ORPC streaming primitive (`EventIterator`) which supports input streaming + output streaming in a single typed contract. This covers both deployment logs and live runtime log tailing.
