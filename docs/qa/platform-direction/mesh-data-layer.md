# Q&A — Platform Direction: Mesh & Data Layer

> **Module**: platform-direction  
> **Category**: mesh-data-layer  
> **Last updated**: 2026-03-04

---

## Mesh event transport

**Q**: The Mesh carries ALL internal events. What is the transport?

**A**: **ORPC EventIterator over HTTP/SSE between nodes** (current direction). No separate message bus (Redis pub/sub, NATS, etc.). All internal events flow through ORPC typed contracts over SSE.

---

## Mesh topology

**Q**: What is the target mesh topology for event distribution at scale?

**A**: **Gossip ring** — each node talks to K neighbors, events propagate transitively. NOT full mesh (N² connections). This scales better for 10+ nodes. K should be tunable per cluster size.

---

## Database replication model

**Q**: For multi-cluster: what replication strategy?

**A**: Single primary PostgreSQL + read replicas. Writes go to primary only. User is uncertain about deeper multi-primary strategies — start simple and design for future migration if needed.

---

## Log storage backend

**Q**: Where are logs stored long-term?

**A**: **Hot storage + cold S3 archive with automatic tiering.** Recent logs in a fast queryable store (ClickHouse, TimescaleDB, or PG). Older logs archived to S3-compatible cold storage after a configurable TTL.

---

## Service discovery

**Q**: How does one service discover another's address (cross-node)?

**A**: **Internal DNS (CoreDNS)** for cross-node service resolution. Services resolve other services by platform-assigned names (e.g. `backend.my-project.internal`). Docker DNS handles same-node same-project discovery by container name.

---

## Multi-cluster data sync

**Q**: If orgs span multiple geo-distributed clusters, how is state shared?

**A**: If the cluster grows large enough, multiple DB instances can be used with DB replication. All internal events are sent through the Mesh, so if multiple DB instances exist the Mesh propagates sync data between them. The Mesh is the transport for DB sync, not a separate replication protocol.
