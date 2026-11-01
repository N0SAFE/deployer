# Node agent: production-readiness pass

Date: 2026-10-31. Scope: the per-node agent (formerly `mesh-agent`), now `apps/api/services/node-agent`
(`@deployer/svc-node-agent`), its contracts/client/container packages, the node door, enrollment/rotation, the overlay,
doors, gossip/relay, and the deployment surface.

**Verdict: not production-ready yet.** Functionally the mesh is complete and tested (overlay, doors, tokens, rotation,
labels/blocks, lazy links, gossip fan-out, peer routers, swarm mode, onboarding, multi-hop relay). The blockers are about
**trust boundaries and deployment ownership**, not missing features. This pass closed them in two rounds: the rename and hardening pass
(twelve), then the local-door split (**F-06**). The four remaining P0s and the P1/P2 items are listed in §3 with the fix
each needs.

## 1. What this pass fixed

| Finding | Fix | Evidence |
|---|---|---|
| **F-02** node socket `0660 root:root` while the prod tier runs as UID 1001, so the node door was silently unusable | The container now sets `NODE_AGENT_SOCKET_UID/GID=1001`; the agent chowns the socket (configurable) and logs the owner; `joinServiceMeshOnNode` reports the first registration failure with the socket path and errno instead of claiming success | `packages/node/agent-container/src/agent-container.ts`, `node-agent/src/transport/mesh-transport.ts`, `packages/mesh/service/src/join-service-mesh-on-node.ts` |
| **F-03** tier replicas advertised the container hostname, unreachable from other nodes | `node.status.advertiseAddress` exposes the agent's own address; setup's tier provisioner derives `MESH_ADVERTISE_URL=ws://<host>:<appPort>/mesh/ws` per scheduled app and omits it (with a log) when the door is silent | `node/status.ts`, `node-status.service.ts`, `services-tier-provisioner.service.ts` |
| **F-07** any member could force a peer into another swarm through `roster.join` | `join` is now accepted only on the node door (`nodeDoor` context flag); HTTP and peer websocket answer `FORBIDDEN`. `roster.setting` is local-only for the same reason | `mesh-transport.ts`, `mesh-roster.controller.ts`, `MeshLocalOnly` |
| **F-09** rotation input unclamped: a peer could lock others out or pin an epoch | `validUntil` clamped to `[now+1s, now+24h]` (past/absent → grace), `epoch` clamped to `now ± 5 min` | `mesh-roster.controller.ts` |
| **F-13** no timeouts on relay/gossip calls (a blackholed peer stalled a call or a round) | `NODE_AGENT_CALL_TIMEOUT_MS` (default 5 s) bounds every agent-to-agent call; relay forwards or answers `MeshNoRoute`, gossip skips the peer and warns once a minute | `relay.service.ts`, `roster-gossip.service.ts` |
| **F-14** SQLite had no WAL, busy timeout or integrity posture; DB not `0600` | WAL + `busy_timeout=5000` + `synchronous=NORMAL` on every open; DB file `0600`, directory `0700` | `local/sqlite.ts`, `local/agent-store.ts` |
| **F-18** rolling upgrade breaks (required fields between versions) | `settings` defaults to `[]`; `status.relay` and `advertiseAddress` default; parse tests cover old payloads | `packages/contracts/node-agent` |
| **F-20** websocket unbounded (100 MiB frames, unlimited clients) | `maxPayload` 1 MiB, `maxConnections` 512 (503 when full), credential check still first | `packages/mesh/server/src/mesh-websocket.ts` |
| **F-25** idle pools and per-pair/hint maps grew forever | 30 s eviction tick for replica/agent links; bounded bytes window, per-pair lists and key hints | `mesh-transport.ts`, `agent-load.service.ts`, `key-hints.service.ts` |
| **F-29** env outside the schema, hops unclamped, dev image default | `NODE_AGENT_DOCKER_SOCKET`, `NODE_AGENT_STATE_DIR`, `NODE_AGENT_DEBUG_RELAY` in the schema; hops clamped `0..8`; production warns once when the image is unset/`:dev` | `config/node-agent.env.ts` |
| **F-32** unbounded contract inputs | caps on addresses, labels, setting values, tokens, relay paths/headers, roster arrays | `packages/contracts/node-agent` |
| **F-35** STUN accepted off-path answers | response must come from the address/port asked | `network/endpoint-discovery.ts` |
| **F-01** first half: a peer could run an arbitrary door image | `NODE_AGENT_DOOR_IMAGE` pins the only image the agent will run; a `node.doors` setting naming another image is refused (logged once) | `doors.setting.ts`, `node-agent/agent-container.ts` |
| **F-06** the local door was the full peer router plus `node`, so any service could read the swarm secret, rotate, join or configure the node | Two sockets, two audiences. The service socket (0660) serves an **allowlist** (`serviceProcedures`: directory, relay, access.verify, roster.check/setting/view, node.labels/settings/state/status); the admin socket (0600, own volume `deployer-node-agent-admin`, mounted only into setup, the API and `fleet`) serves credential, rotate, token, join, block/unblock, exchange and `node.configure`. A service container without the mount has no admin door at all | `nest/mesh/mesh-router.resolver.ts`, `node-agent/src/transport/service-door.ts`, `mesh-transport.service.ts`, `mesh/client/src/node-door.ts`, `agent-container.ts`, `services-tier-provisioner.service.ts` |

Also: the service is renamed `mesh-agent` → `node-agent` end to end (packages, dirs, container/image/volumes, service
name, env `NODE_AGENT_*`), with the mesh transport packages and `/mesh/*` routes kept as they are. The docs-site URL
`/docs/architecture/mesh-agent` is kept and retitled.

## 2. Verdict detail

What is solid: constant-time credential comparison; credential verified at upgrade before a socket exists; the node
router never served on the peer door; the node door and peer door separated; hop-by-hop headers stripped; relay streams
pulled, not buffered; replica leases with TTL; persisted identity/credential/seeds; hash-idempotent door convergence with
foreign-container refusal; 48 files / 334 tests including real-socket two-agent and three-agent boot specs (relay,
rotation, lifecycle, multi-hop), plus contract compatibility tests.

What blocks production: the four items below. F-01 remains the most serious: pinning the image stops arbitrary code
execution, but a member can still rewrite the doors' lanes/targets and the replicated settings, so traffic can be
steered. That needs the signed-settings design (feature 3) or per-key writer authorization.

## 3. Still open (blockers)

| ID | Sev | Finding | Fix | Effort |
|---|---|---|---|---|
| F-01 | **P0** | Replicated settings are trusted from any member: `node.doors` lanes/targets (image now pinned) and any other setting can be rewritten by a peer and applied by every node | Signed settings (API key) with allowlisted keys and per-key writer, or accept `node.doors` only from the node door and have each node's own API publish it; verify at ingest | M |
| F-04 | **P0** | Peer door is plaintext `ws://` on `0.0.0.0:3106`; the swarm credential and relayed caller cookies cross the LAN, and UFW blocks the port or exposes it when absent | Bind to the overlay/LAN address (`NODE_AGENT_BIND_ADDRESS` exists), add mTLS or WireGuard-only transport, add scoped 3106/tcp + 51820/udp firewall rules | M |
| F-05 | **P0** | Agent runs as root with rw `docker.sock`, `NET_ADMIN`, host network, no seccomp/read-only rootfs/limits | Narrow Docker API proxy instead of the socket, non-root with only `NET_ADMIN`, `CapDrop ALL`, seccomp, read-only rootfs, memory/CPU/pids limits, healthcheck | L |
| F-10 | **P1** | Join tokens embed the raw swarm secret in base64 JSON, are replayable for up to 24 h, and revocation is only local to the issuer | Signed, short-lived, single-use, node-bound tokens; publish revocations swarm-wide; no raw secret in the token | L |
| F-11 | **P1** | `roster.block` is local-only while docs say the member is cut off | Replicate blocks as a signed setting or roster entry, with authorization and status exposure | M |
| F-21 | **P1** | No shutdown drain: in-flight calls/streams are cut, `main.ts` does not await transport stop | Stop accepting, drain with a deadline, then close; await in `main.ts`; expose draining | M |
| F-17 | P1 | Swarm-mode spec bakes the reconciler host's advertise URL; stop-first + no healthcheck + host container removed before the task runs | Per-node env at task start, healthcheck, start-first/rollback, remove the host container after the task is healthy | M |
| F-15 | P1 | `/health/ready` is always ready; no metrics/tracing/audit for join/rotate/block/configure | Readiness = store + Docker (when used) + WireGuard (when enabled); `/metrics`, OTel, audit events | M |
| F-23 | P2 | Secrets at rest are plaintext in `agent.db` (mode 0600 now) | Document the posture; optional OS keyring/TPM for the WireGuard key | S |
| F-24 | P2 | Gossiped replica `address` is dialed with the credential in the query string (SSRF + leak) | Validate against the swarm CIDR; move the credential to a header/challenge | M |
| F-26 | P2 | No agent TTL: dead agents stay in the roster and are dialed every round | `lastSeen` + prune on round; per-target negative cache with reason | S |
| F-31 | P2 | No resource limits/healthcheck/read-only rootfs on either shape | Same as F-05 | S |
| F-30 | P2 | No real dataplane/chaos/load tests; thresholds are guesses | netns + `ip`/`wg` job, Docker-in-Docker door test, fault injection, load run | L |

## 4. Feature proposals

1. **Signed identity + mTLS between agents** — Ed25519 node key, short-lived certs pinned to a swarm CA. Removes the
   shared bearer secret, encrypts traffic (F-04), authenticates gossip senders (F-01). L.
2. **Capability-scoped doors** — service / peer / admin routers with per-procedure authorization (or `SO_PEERCRED`).
   Fixes F-06/F-19 and makes a compromised web service unable to touch node admin. M.
3. **Typed, signed replicated settings** — allowlisted keys, per-key writer, image digests, signature verified at ingest.
   Closes F-01 while keeping cluster state reschedulable. M.
4. **Durable store** — WAL/busy timeout done; add `quick_check`, backup/restore, schema-version guard and a downgrade
   refusal. Removes a class of node-bricking failures. M.
5. **Readiness, metrics, tracing, audit** — real `/health/ready`, Prometheus `/metrics`, OTel spans across hops, and
   audit records for membership/configuration changes. M.
6. **Bounded, signed roster + anti-entropy + agent TTL** — caps are in; add sender attribution, sequence/anti-entropy and
   TTL so gossip scales without amplification. L.
7. **Version negotiation + drain/upgrade** — `contractVersion`/capabilities in the exchange, a drain deadline, safe
   rolling upgrade and rollback. M.
8. **Load shedding/backpressure** — per-caller queues, stream quotas, a circuit breaker per peer; the agent is the data
   path. M.
9. **Local admin CLI** — `node-agent status | join | token | rotate | block | doctor`, so operator actions are auditable
   and never ad-hoc socket calls. S.
10. **Link observability** — latency/jitter/loss, gossip lag, handshake age, per-peer error rates, on `node.status` and a
    dashboard. M.

## 5. Path to production

1. **Trust boundaries (1–2 weeks)**: signed settings (F-01), bind/mTLS/firewall (F-04), then token redesign (F-10) and
   replicated blocks (F-11). The local-door split (F-06) is done.
2. **Runtime hardening (1 week)**: non-root/no-docker-socket (F-05), drain (F-21), readiness/metrics/audit (F-15),
   swarm-mode safety (F-17).
3. **Proof (1 week)**: netns/WireGuard + Docker door + fault injection + a load run (F-30), rolling-upgrade test.
4. Only then call it production-ready.

Everything in §1 is merged and green (`bun run type-check` 116/116, node-agent 48 files / 334 tests, nest-mesh 18,
setup 162, mesh server 19, compose valid in every profile).
