# Networking / multi-node / edge: differentiating feature ideas

Date: 2026-10-26. Read-only. Sources: `docs/audit-2026-10-25/{README,networking,docker-cluster,bench-market,bench-coolify,bench-dokploy-dockhand}.md`, `docs/edge-mesh-architecture.md`, and the code paths cited below (all relative to `v3/`).

Evidence tags for competitor claims: **[bench]** = stated in the repo bench reports (which themselves tag `[doc]/[search]/[mem]`); **[mem]** = my general knowledge, unverified this session. I did not browse the web. Competitor claims tagged [mem] must be re-verified before marketing use.

## 0. Ground truth: what the code really has (and does not)

Everything below is built on these verified facts.

| Primitive | Where | Caveat that shapes designs |
|---|---|---|
| Signed roster CRDT (genesis, admissions, members, revocations, settings), merge = per-key max/min, filter-before-compare | `packages/infrastructure/mesh-network/src/roster.ts:204-407`, `schemas.ts:128-143` | Settings are **last-writer-wins, history is overwritten** (`roster.ts:626-639`). There is no append-only record kind, so no audit trail of past values today. Timestamps are self-asserted. Every member can revoke any member. |
| Key-derived identity: member id from the ed25519 key, mesh IP hashed from the WG x25519 key | `address.ts:99-108`, `identity.ts:129` | The WG key is x25519, so the same key material supports ECDH sealed boxes for free. |
| Peer set is a full mesh with `AllowedIPs = <peer>/32` | `links.ts:126-131`, `wireguard.ts:27` | Source IP on the mesh is cryptographically bound to one member. That makes a per-member firewall unspoofable. `AllowedIPs` itself is routing, not an ACL. |
| Link planner: LAN, declared, reflexive, other LAN, then `relay` phase that is a stub | `links.ts:98-188`; `agent.ts:411` only gossips to `direct` peers | A `relay` peer is never gossiped to, so it cannot converge. |
| Agent tick: refreshSelf, applyDataplane, convergeDoors, gossipRound; labels per member | `agent.ts:315-425`, `agent.ts:278-284` | Labels (<=512 B per value) are an existing channel for per-node facts. |
| Doors (agent-owned nginx per lane), `node.doors` setting | `packages/infrastructure/mesh-network/src/doors.ts`, `apps/mesh-agent/src/doors/door-converger.ts` | |
| Control socket vs mesh-address-only gossip listener | `control-server.ts:59-107` | Gossip handler is deliberately read/merge only. |
| EdgeProvider plugin contract (`ingress/connector/dnsRecords/status/joinPath`) | `apps/api/src/core/modules/edge/edge-provider.ts:37-117`, registry in `edge-provider.registry.ts` | `dnsRecords` receives `ctx.nodes` with only `publicAddress` facts. |
| Lane router builder, per-route `visibility`, per-lane entrypoints, `middlewares`, `ruleSuffix` | `apps/api/src/core/modules/platform-ingress/services/lane-traefik-config.ts:10-80` | Pure function, so new routing features are cheap to test. |
| Placement: constraints/preferences from labels (`deployer.region`, `deployer.tenant.*`, `deployer.ingress`) | `packages/nest/swarm/src/services/node-placement.service.ts:34-55` | No UI or API sets these labels (docker-cluster.md 1.2). |
| Event outbox | `apps/api/src/core/modules/events/outbox/local-event-outbox-dispatcher.service.ts` | It is **node-local** (SQLite/Postgres per node, 3 s poll), not replicated. It is a delivery buffer, not a distributed log. |

Hard truths that bound the ideas:
1. Relay is a stub, and `declaredAddresses` never reach the agent (networking.md 1.1). The "works behind CGNAT" claim is not yet true. Fix this first or every other idea inherits the gap.
2. Docker Swarm's raft needs a manager quorum. Any "partition-tolerant" claim covers the **ingress and data plane and the mesh**, not Swarm scheduling inside a minority partition. The honest claim is "keeps serving, cannot reschedule".
3. The API/BFF and Postgres are still a de facto source of truth for projects/deployments (edge-mesh-architecture.md section 5 plans Postgres replicas). Ideas that need replicated desired state must either stay small (roster settings) or wait for that decision. This conflicts with the operator's "no central source of truth" memory; flagged in section 5.

## 1. Competitor baseline (what we must beat, with verification status)

- **Coolify**: agentless SSH to each server (inbound 22), single Laravel/Postgres control plane, Cloudflare Tunnel only for the SSH path, Swarm "experimental". [bench-coolify.md:5,112-114]
- **Dokploy**: SSH-driven remote control, Swarm cluster with registry for multi-node pulls, Tailscale/Cloudflare as documentation guides, Traefik only. [bench-dokploy-dockhand.md:35,51; bench-market.md:127-128]
- **Dockhand**: agents dial into a hub (hawser-edge outbound WebSocket), no ingress, no Swarm. [bench-dokploy-dockhand.md:57,85]
- **Portainer**: Edge Agent polls outbound to a server; RBAC is paid. [bench-market.md:128,252]
- **Kamal**: SSH push; kamal-proxy for zero-downtime on one host; a local-registry-over-SSH-tunnel mode exists [mem].
- **CapRover**: single-host or Swarm with a registry; wildcard DNS required. [bench-market.md:124]
- **Railway / Render / Fly / Vercel**: hosted. Fly has `.internal` DNS and 6PN [mem], an anycast proxy with region-aware routing [mem], `fly proxy` for private ports [mem]. Railway has per-project private networking [bench]. None are self-hosted or peer-equal.
- **Adjacent, not deploy platforms**: Tailscale (MagicDNS, ACLs, Funnel, coordinator + DERP relays), NetBird (ACLs, reverse proxy beta, relay servers), Nebula (lighthouse + any-node relays [mem]). Every one has a control plane or lighthouse. They are prior art for individual primitives, and none couples them to a deploy platform. Where an idea overlaps with them, I say so.

Summary: no deploy platform ships a self-forming peer-equal network. So **the differentiation is the combination**, not each primitive alone.

## 2. Candidates (21)

Effort: S (<=1 week), M (1-3 weeks), L (3-8 weeks), XL (>2 months). Verdicts: GO (build), GO-after (blocked on a prerequisite), DEFER, NO.

### C1. Relay-by-any-member (UDP-in-WireGuard relay, end-to-end encrypted)
- **Value**: two nodes behind symmetric NAT/CGNAT (home lab + home lab, phone hotspot) join and stay linked. This is the single claim ("add a node with no inbound ports") the product's story rests on.
- **Why competitors lack it**: Coolify/Dokploy need inbound SSH [bench]; Dockhand/Portainer need a hub [bench]; Tailscale relays through Tailscale-run DERP (central); Nebula relays through designated nodes [mem]. A deploy platform where *any* member relays with no coordinator does not exist.
- **Builds on**: `links.ts:176-188` (`planRelay` stub, `path:"relay"` already modelled), `links.ts:165-168` (relay phase), `agent.ts:411` (gossip gate), `schemas.ts:28` (`endpointCandidateKind`), `agent.ts:182` (`currentEndpoints`).
- **Missing**: the transport, a link-state fact per member, the relay selection rule, MTU handling, a status surface.
- **Design**: do not use WebSocket. Member C relays between A and B using only existing tunnels. C runs a tiny UDP forwarder inside the agent. A sets B's WG endpoint to `C.meshAddress:<relayPort(B)>`. The datagram rides A-C's WireGuard tunnel, C re-sends it to `B.meshAddress:51820` over C-B's tunnel, B replies to the forwarder, which maps back. The A-B WireGuard handshake is *inside* that UDP payload, so end-to-end encryption and member authentication are preserved and C sees only ciphertext. Add endpoint kind `relay` (host = relay's mesh address, port derived deterministically from `hash(targetKey)` so nothing needs negotiating). Each member publishes the set of peers it has a fresh handshake to (label `link.fresh`, or a short unsigned gossip field, since it is advisory); any member with fresh links to both sides may serve. Choose by lowest sum of last-RTT, tie-break by member id so both sides pick the same relay and no extra consensus is needed. Treat `relayed` as reachable for gossip (`agent.ts:411`). Re-probe a direct path every N minutes and migrate off the relay when it succeeds (the existing cycle does this).
- **Effort**: L (the forwarder is small; the care is in MTU, selection stability, and a netns NAT test).
- **Risks**: MTU (inner WG packet 1452 B inside a 1420 tunnel fragments; set a lower interface MTU or tolerate fragmentation, and measure); relay becomes a bandwidth sink (add per-relay rate cap and accounting); a malicious member can drop traffic but cannot read or forge it; relay-of-relay loops (forbid chains: relay must have a direct handshake to both).
- **Verdict**: **GO. Highest priority.** Needs an iptables-netns NAT e2e (networking.md 3.19 notes none exists).

### C2. Mesh DNS and service discovery (resolver in the agent), with split-horizon
- **Value**: `api.deployer.internal`, `<service>.<project>.mesh` resolve on every member with no public DNS; for a hostname that is also public, members get the **private** answer so traffic never hairpins out through Cloudflare and back (split-horizon).
- **Why competitors lack it**: Fly `.internal` and Tailscale MagicDNS exist [mem]; no self-hosted PaaS has it [bench-market.md:129,261; bench-dokploy-dockhand.md:140]. Split-horizon driven by the same lane model is new.
- **Builds on**: `lane-dns-plan.ts` (private domain, `.internal` never published), `networking.md 1.3` (private lane has no resolver), `agent.ts:405-425` tick loop, `doors.ts` (private door on mesh address), roster member list (`activeMembers`, `roster.ts:649`).
- **Missing**: a DNS listener, a records source, host resolver wiring.
- **Design**: the agent binds a UDP/TCP DNS stub on the mesh address :53 (and loopback). Records come from (a) members (`<name>.mesh` -> mesh address, from the roster, no new state), (b) a replicated `dns.records` setting written by the API from lanes and routes (`*.<private domain>` -> doors' mesh addresses of nodes that run Traefik), (c) per-service records. For the host, the agent configures systemd-resolved with a routing domain for the mesh interface (`resolvectl dns/domain`) when available, otherwise containers use it via Docker `--dns`/Swarm `dns` options. Split-horizon: for any name in the lane domains, answer the private lane address when the asker is a member. Because every agent has the full roster, answers survive any partition.
- **Effort**: M.
- **Risks**: touching host resolver config (make opt-in, reversible, keep an explicit rollback); one-record-per-node answers need health awareness (see C5).
- **Verdict**: **GO.** Fixes a documented gap (the `.internal` default has no resolver).

### C3. Operator member (`deployer mesh connect`) with expiring and scoped admissions
- **Value**: the laptop joins the mesh with no inbound port, reaches private routes and the console, and runs `deployer proxy db:5432` to a private service. Add **time-boxed guest admissions** (contractor access for 4 hours) that expire by themselves.
- **Why competitors lack it**: Tailscale/NetBird have laptop clients but need their coordinator and are not deploy-aware [bench]; Fly has `fly proxy` [mem]; the others have nothing equivalent. Expiry without a server is new: it works because validity is a signed field checked by every member, not by a controller.
- **Builds on**: `schemas.ts:42-47` (`kind:"operator"` already exists), README line 53 (no CLI), `agent-container.ts` (agent packaging), `roster.ts:509-560` (admission), `roster.ts:611-623` (revocation, "cuts authority from the revocation moment").
- **Missing**: laptop packaging (userspace WG or kernel), the CLI, an `expiresAt` in the admission record, and member scoping ("operator" members must not appear in swarm).
- **Design**: add optional `expiresAt` and `scope` (`lane:private`, `ports:[...]`) to `admissionRecordSchema` (`schemas.ts:86-93`). `validateRoster` treats an expired admission as revoked from `expiresAt` using the same fixpoint code path as revocation (`roster.ts:204-260`). The operator agent runs `kind:"operator"` and is excluded from peer sets of members that do not need it (see C11 for enforcement). `deployer proxy` opens a local port that goes over the mesh to a service's overlay address.
- **Effort**: M (CLI + packaging dominate). The roster change is S.
- **Risks**: expiry relies on member clocks (self-asserted timestamps; see C10 for hybrid logical clocks); a stolen laptop key is valid until revoked or expired, so keep guest TTLs short; userspace WG on macOS/Windows needs a sidecar.
- **Verdict**: **GO.** Confirmed as the CLI "hero" in bench-coolify.md:47.

### C4. Registry-less peer-to-peer image distribution over the mesh
- **Value**: build on one node, run on any; no Docker Hub/GHCR/self-hosted registry account; pulls come from the nearest peer that has the layer, and keep working when the builder is offline.
- **Why competitors lack it**: Dokploy needs a registry [bench]; Kamal normally needs one (it has a local-registry-over-SSH mode [mem]); Swarm itself cannot do it. Content-addressed P2P distribution exists for Kubernetes (Spegel, Dragonfly [mem]) but not for Swarm platforms. This is the audit's multi-node blocker (docker-cluster.md 3.9, README P1 15).
- **Builds on**: `DockerService.buildImage` (local only), the mesh (every node reachable at a derived address), `docker-mesh-handler-registrar.service.ts` (mesh fan-out RPC pattern), node labels for a "has-image" index. Placement via `node-placement.service.ts`.
- **Missing**: a registry endpoint per node, an index of who has what, a pull-through path for Swarm.
- **Design**: every node runs the standard OCI `registry:2` (or a thin containerd-content proxy) bound to its mesh address on a fixed port, `127.0.0.1:5000` local alias via a door. Images are always tagged by **digest**. Builds push to the local registry. The node publishes `images.have` (digest list or a bloom filter) as a label or gossiped fact. For a task landing on node X, the runner rewrites the image reference to `localhost:5000/<digest>`; a pull-through shim on X asks peers (ranked by link path and RTT) for missing blobs and verifies the digest, so a malicious peer cannot poison it. Swarm needs the reference to resolve on every node, hence the loopback alias plus pull-through. Add layer GC tied to deployment retention.
- **Effort**: L.
- **Risks**: Swarm `--with-registry-auth` semantics; large-image bandwidth over relayed links (mark relayed peers as last resort); image retention and disk; first deploy latency when the only copy is on a NATed home node (cache on a second node proactively, see C14 for policy).
- **Verdict**: **GO.** The only one that unblocks core platform function (multi-node deploys) *and* differentiates.

### C5. Coordinator-less multi-site failover and active-active public edge
- **Value**: put an `edge` on two or three nodes in different sites; if one site dies, traffic moves in seconds with nobody deciding.
- **Why competitors lack it**: Coolify/Dokploy have one proxy per server and no failover [bench]; Kamal single host; hosted platforms do this on their own infra. Cloudflare-tunnel replicas already give multi-connector HA for free; `direct` does not.
- **Builds on**: `supervisors/platform/edge-connector-supervisor.service.ts` (max one replica per node), `EdgeDnsService` (10-min reconcile, `ingress-edge.service.ts`), `direct.edge-provider.ts` (A records for all nodes, no health), `networking.md 3.10` ("no health-aware removal of a down node").
- **Missing**: signed health facts, health-aware DNS record sets, DNS-01 certs so any node can serve any host.
- **Design**: each edge node publishes a signed, short-TTL liveness fact (`edge.alive` label with a counter + local view of upstream health). Because rosters are full copies, every node can compute the **same** healthy set deterministically. The DNS plane acts on it in a leaderless way: the node with the lowest member id among healthy edge nodes performs the DNS reconcile (any node may take over when it disappears; DNS writes are idempotent so a double-write is harmless). For `direct`, use DNS-01 wildcard (C-enh E2) so failover needs no cert handoff. For tunnel edges, rely on the connector replicas and add per-connector health to status.
- **Effort**: M-L.
- **Risks**: DNS TTL floors failover time (use 30-60 s and say so); split-brain where two nodes both think the other is dead only causes duplicate idempotent writes; health fact forgery by a revoked member is already blocked by the signature chain.
- **Verdict**: **GO-after C2 and E-list (DNS-01).** Pairs with C12.

### C6. Partition-tolerant "island mode"
- **Value**: a site that loses the WAN keeps serving its apps, its local lane and its private lane, and re-converges automatically; the dashboard says which partition you are in.
- **Why competitors lack it**: single-control-plane products stop managing (Coolify "if it dies, management dies" [bench-coolify.md:114]); Portainer Edge agents are autonomous but have no shared state; hosted platforms n/a.
- **Builds on**: Traefik keeps its last config when the API is lost (edge-mesh-architecture.md section 3), doors converge from the local roster copy (`agent.ts:384`), `mergeRosters` convergence test in `agent.spec.ts`, rescue lane (`doors.ts:50-56`).
- **Missing**: Swarm cannot schedule in a minority partition (raft); no partition detector; no UI; no policy for what a minority may do.
- **Design**: define "island" = member count reachable < roster total. Surface it from `status()` (`agent.ts:429`). Define allowed actions per mode: reads and serving always; roster writes (admit, settings) always allowed because they are CRDT; swarm mutations blocked with an explicit error. Cache the compiled Traefik config on each node's door so a restarted node in an island still serves (today Traefik polls the API; add an on-disk last-good config). Add a chaos test using the netns e2e (`apps/mesh-agent/scripts/e2e-netns.sh`).
- **Effort**: M. Cheap because the primitives exist; the work is explicit semantics + tests.
- **Risks**: users will read "partition tolerant" as "can deploy in a partition"; be exact in the UI. Swarm has no remedy short of `--force-new-cluster` on a minority (dangerous; only offer it as a guided break-glass, never automatic).
- **Verdict**: **GO (as a documented capability plus tests plus UI).** A swarm-free scheduler is out of scope.

### C7. Mesh-private preview URLs with a shareable public escape hatch
- **Value**: each PR preview is on the private lane by default (only teammates on the mesh or via `mesh connect` see it), and can be promoted to a public, expiring link in one click.
- **Why competitors lack it**: Vercel/Render previews are public or SSO-gated hosted [bench]; Dokploy previews are public wildcard [bench-market.md:46]. Private-by-default previews on a team's own network are not offered.
- **Builds on**: `lane-traefik-config.ts` visibility (`private` = no public router), `preview-provisioning.service.ts:79` (host + DNS), `preview-ttl-cleanup.service.ts` (TTL is real), README P1 20 (previews are inert today).
- **Missing**: previews actually working (audit marks them STUB), a visibility field on preview rows, a share token (C8).
- **Design**: previews register a route with `visibility:"private"`; generated host `<pr>-<svc>.<private domain>` resolves via C2 so no DNS records are created or leaked. Promote = mark route `public` for a TTL and mint a share token (C8).
- **Effort**: S on top of working previews; the previews themselves are L.
- **Risks**: blocked by the P1 previews rewrite.
- **Verdict**: **GO-after previews work.**

### C8. Exposure-on-demand: temporary public share links
- **Value**: "share this private service with a client for 2 hours" yields a URL; it dies by itself.
- **Why competitors lack it**: Tailscale Funnel is a standing public exposure and requires Tailscale [bench-market.md:259]; ngrok-style tools are external. Nothing in a deploy platform ties a time-boxed share to the lane model.
- **Builds on**: lane isolation (one router per route and lane, `lane-traefik-config.ts:10-22`), `middlewares` and `ruleSuffix` fields, `ingress-provider-token.ts` (derived HMAC token pattern), `edge-provider.ts` provision/teardown.
- **Missing**: a token format, a verifier on the public lane, a lifecycle.
- **Design**: a share link is a signed capability `{route, exp, scope}` signed by the creating member's ed25519 key (verifiable against the roster by any node, no central lookup). A Traefik `forwardAuth` middleware on the public router calls a tiny verifier (in the door or agent) that checks signature + `exp` + membership/revocation state; revocation of the issuing member kills the link. Revoke early by adding the token id to a `share.revoked` setting. If the public lane is off, the link can instead be served by temporarily provisioning the edge (tunnel hostname) and tearing it down at expiry using the existing `provision/teardown`.
- **Effort**: M.
- **Risks**: do not log tokens in URLs (use a cookie exchange on first hit); abuse limits (rate limit middleware); clock skew on `exp`.
- **Verdict**: **GO (second tier).** Good demo value.

### C9. Node-scoped sealed secrets over the mesh
- **Value**: a secret is encrypted to specific nodes (only the nodes allowed to run service X can decrypt it) and replicated by gossip; revoking a node makes its copies useless going forward (rotate).
- **Why competitors lack it**: Dokploy/Coolify store env/secrets in plaintext columns in one DB [bench-dokploy-dockhand.md:51; README 3.2]; Swarm secrets are cluster-wide to managers; Vault-style tools are external and central. Per-node envelope encryption on the same trust roots as the network is new.
- **Builds on**: x25519 WG keys (`identity.ts:129`) usable for ECDH sealed boxes; roster settings as the replicated store (`roster.ts:626`); known defect that the Cloudflare tunnel token is plaintext in the roster (networking.md 3.4, `edge.cloudflare-tunnel` setting); `EdgeStateStore`.
- **Missing**: an envelope format, a key-wrap list per secret, rotation on revoke, a way for services to read them (Swarm secret mount: `swarm-spec.mapper.ts` never emits `Secrets`).
- **Design**: secret = random data key encrypted with XChaCha/AES-GCM; the data key is wrapped (ECIES using the recipient's x25519 key) once per allowed member. Store `{ciphertext, wraps:{memberId: wrapped}}` as a roster setting (kept small; large blobs excluded). Writers sign (already true). A member decrypts only its own wrap; the supervisor materialises it into a tmpfs or Swarm secret on that node only. On revoke, a leaderless rule: any member holding the plaintext re-wraps without the revoked member and bumps the version (the revoked member keeps the old plaintext; only rotation of the *value* fixes that, so provide a "rotate after revoke" workflow for provider tokens such as the tunnel token).
- **Effort**: M-L (Swarm secret mounting is part of the work and is already an audit item).
- **Risks**: the roster is replicated to everyone, so ciphertext is world-readable to members: security rests on crypto, so use audited primitives (libsodium sealed boxes) and review; forward secrecy is limited (long-term keys); a compromised member sees everything wrapped to it.
- **Verdict**: **GO.** Closes a documented security finding and is a clean story ("secrets never leave the nodes entitled to them").

### C10. Tamper-evident audit trail from the signed roster
- **Value**: a replicated, signed, append-only log of who admitted/revoked/changed lanes/edges/secrets/deploys, verifiable by anyone, survives the loss of any node.
- **Why competitors lack it**: Dokploy/Portainer/Netlify audit logs are enterprise/paid [bench-market.md:114,139]; every one is a row in a central database that an admin can edit. A cryptographically verifiable one is a different category.
- **Builds on**: signed admissions/revocations/settings (`roster.ts:611-639`), `canonicalJson` (`canonical-json.ts`), member ids tied to signing keys (`address.ts`, `identity.ts`), the "first audit-log stream" idea in bench-market.md:262, the existing event outbox as the producer side.
- **Missing**: today `setSetting` **overwrites** the previous value (`roster.ts:626-639`), so history is lost; timestamps are self-asserted; no append-only record type.
- **Design**: add a fifth record map `events`: grow-only set of `{actor, seq, prev(hash of actor's previous event), kind, subject, payloadHash, issuedAt}` signed by the actor, keyed by `actor:seq`. Per-actor hash chains make deletion/reordering detectable; merge is set union (trivial CRDT). Add a hybrid logical clock (HLC) field to bound clock lies; flag events whose `issuedAt` deviates from the HLC. Producers: setSetting/admit/revoke automatically emit; the API emits deploy/auth events through the outbox. Expose "verify" (walk chains, report gaps) and export to JSON Lines + a checkpoint hash that can be notarised anywhere (the operator can print or anchor it externally).
- **Effort**: M (core record + verifier); retention and GC policy add L later.
- **Risks**: roster size growth (needs snapshot + prune with a signed checkpoint, which must be designed up front); a member can omit its own events (detectable only if peers saw its other events, so state this honestly); privacy of payloads (store hashes + minimal metadata, details elsewhere).
- **Verdict**: **GO.** Cheap relative to its credibility; unblocks the P0 audit-log item with a stronger design.

### C11. Per-service/per-member microsegmentation from the signed policy
- **Value**: "service A may talk to service B only; the laptop operator may reach private routes but not the Swarm control port; a revoked or guest member reaches nothing."
- **Why competitors lack it**: Swarm and Dokploy rely on overlay isolation by network membership only [bench]; Tailscale/NetBird have ACLs but at the machine level and not tied to service identity. Policy that is signed by members, replicated, and enforced locally on each node is distinctive.
- **Builds on**: `links.ts:129` (`AllowedIPs=/32` binds a source IP to one member, so rules keyed on mesh IPs cannot be spoofed), member `kind` (`schemas.ts:42`), labels, node-local ownership of the kernel interface (`wireguard-driver.ts:33-60`).
- **Missing**: an enforcement engine; a policy schema; mapping service-to-service (the overlay is VXLAN inside WG, so flows between containers on different nodes appear as node-to-node UDP 4789 on the mesh, not per-service flows).
- **Design**: be exact about the layers. (1) **Node/identity level, mesh interface**: an nftables set generated from a replicated `mesh.policy` setting, applied by the agent on the mesh interface (`input`/`forward` chains keyed by source mesh address from the roster). Examples: operator members may only reach door ports; guests only the private door; nothing from a member in state revoked. WireGuard's `AllowedIPs` alone is *not* an ACL, so do not claim it is. (2) **Service level**: enforce in `DOCKER-USER` / overlay-level via per-service networks (Swarm already scopes by network) and derive networks from declared service dependencies (`dependsOn`, today unread). Start with (1), make (2) a stretch.
- **Effort**: L (policy + safe rollout with dry-run and a lockout guard).
- **Risks**: self-lockout (an applied bad policy cuts the agent's own gossip: always allow gossip and the control port by construction, and add automatic rollback if no handshake within N s); nftables variants; policy writes by any member (LWW) need the versioned CAS fix already listed in networking.md section 5.
- **Verdict**: **GO-after C3** (operator members are the first consumer). Do the node-level first.

### C12. Mesh-gateway edge provider (bring-your-own VPS as front door) + home-lab hybrid
- **Value**: run apps at home (no public IP), put a cheap VPS in front; the VPS is a normal mesh member flagged as the public gateway. Same cluster, no frp/tunnel account, no per-app port forwards.
- **Why competitors lack it**: Dokploy/Coolify only document tunnels as guides [bench-market.md:259]; NetBird reverse proxy is beta and tied to NetBird. None makes "a member is the front door" a first-class, pluggable provider.
- **Builds on**: `edge-provider.ts:91-117` (the whole contract), `direct.edge-provider.ts` (A records to declared addresses, ACME), edge-mesh-architecture.md section 3b ("a gateway is just a member whose operator chose `direct`"), Traefik is global so any node can route to any task (edge-mesh-architecture.md section 3), `networking.md 6` ("operator-owned relay edge").
- **Missing**: `dnsRecords` only uses `publicAddress` facts from all nodes (`edge-provider.ts:37-41`): need "only nodes labelled `deployer.edge=gateway`"; `declaredAddresses` wiring (networking.md 4.3); DNS-01 certs; the VPS joining via the normal join flow.
- **Design**: provider `mesh-gateway` with option `gatewayMembers` (label selector). `ingress()` publishes :80/:443 only on those nodes (needs the `deployer.ingress` placement label already used by `node-placement.service.ts:51`). `dnsRecords()` returns A records for the gateways' declared addresses. Mark the gateway as `declared` endpoint so NATed home nodes always have a rendezvous that is reachable (also improves C1 because relay candidates exist). Traefik on the gateway routes over the overlay to home tasks. Several gateways = active-active (C5).
- **Effort**: M.
- **Risks**: the VPS becomes a traffic and trust concentrator (it sees plaintext after TLS termination; document, and offer TCP passthrough later); ACME needs DNS-01 or one-gateway-only.
- **Verdict**: **GO.** Smallest path to the "three houses with no static IPs" story (bench-market.md:264).

### C13. Locality- and latency-aware routing
- **Value**: a request lands on the nearest healthy replica (same node, then same LAN/site, then lowest RTT), with automatic spill when it is overloaded.
- **Why competitors lack it**: Fly's proxy does region-aware routing [mem]; no self-hosted PaaS does; Traefik by default round-robins across replicas.
- **Builds on**: link observations from `wg show dump` (handshake, endpoint, rx/tx in `parseWireguardDump`, networking.md 5 "data already in wg show dump"), `rankCandidates` LAN grouping (`links.ts:98`), per-node Traefik with HTTP provider (config is generated per poll in `lane-traefik-config.ts`), `deployer.region` label (`node-placement.service.ts:55`).
- **Missing**: RTT measurement (WG has none; add a mesh-address UDP/ICMP ping in the agent), the per-node config variant (today every node gets identical routes), a weighted/ordered load balancer config.
- **Design**: the agent publishes `rtt.<memberId>` (EWMA, ms) in its own entry labels or an unsigned gossip field. The Traefik config endpoint accepts the requesting node's identity (derived token already exists: `ingress-provider-token.ts`) and emits services with `weighted` or `servers` ordering that prefers local/near tasks (e.g. weight = f(RTT), local tasks weight x10).
- **Effort**: L.
- **Risks**: per-node config breaks the "identical routes on every node" invariant (acceptable if only weights differ); metric churn causing config flapping (hysteresis); needs real task->node info from Swarm.
- **Verdict**: **DEFER to tier 2** (value is real but needs C-enh telemetry first and multi-replica services, which today are hardcoded to 1 replica, docker-cluster.md 3 item on `replicas: 1`).

### C14. Bandwidth- and latency-aware scheduling (data-gravity placement)
- **Value**: put chatty services on the same site; keep stateful services near their volumes; avoid scheduling large images across relayed links; use measured link quality instead of constants.
- **Why competitors lack it**: Swarm and Dokploy schedule on labels/resources only; Nomad/K8s have affinity but no measured-link scheduling [mem].
- **Builds on**: `node-placement.service.ts` (preferences via spread descriptors), `swarm-runtime-runner.service.ts` (label-driven placement, `:420-427`), mesh link data; and docker-cluster.md 1.2 notes the existing "master election" metrics are *invented constants*, so real data is a prerequisite.
- **Missing**: real link metrics, region/site labels set from the mesh (e.g. derive `site` from /24 LAN grouping automatically), a planner.
- **Design**: derive `deployer.site` automatically by clustering members whose LAN candidates share a subnet (the same logic as `links.ts:83`). Services declare `affinity: [serviceB]` or `spread`; the runner converts to Swarm constraints/preferences on `node.labels.deployer.site`. Phase 2 adds RTT thresholds.
- **Effort**: L.
- **Risks**: Swarm's scheduler is coarse (constraints, not a cost model); stickiness for volumes (stateful placement is itself unsolved, docker-cluster.md item 8).
- **Verdict**: **DEFER.** Site labels (S) are a cheap first slice worth doing inside C13/C5.

### C15. Peer-to-peer encrypted backups (mesh as the backup target)
- **Value**: volume/DB backups encrypted client-side and stored on two peers at other sites; no S3 account; restore from any surviving peers.
- **Why competitors lack it**: Dokploy/Coolify/Easypanel back up to S3 destinations [bench-market.md:79-83]; nobody replicates backups peer-to-peer.
- **Builds on**: sealed key material (C9), mesh transport, P2P blob path (C4), outbox/jobs.
- **Missing**: backups do not exist yet (audit P0 10). Needs the backup engine first.
- **Design**: shard/erasure-code or simple N-replica of encrypted archives to the K nearest members with spare disk (disk free as a label). Manifest is a roster setting (hash list), signed.
- **Effort**: L, after the base backup feature.
- **Risks**: disk exhaustion on home nodes; durability claims need a repair loop.
- **Verdict**: **DEFER**; mention as a roadmap hook on C4/C9.

### C16. Offline-first desired state (nodes converge on signed intent)
- **Value**: the operator's intent ("service X, image digest D, 2 replicas, node set S") is a signed, replicated record. A node that was offline converges when it reconnects, with no scheduler call.
- **Why competitors lack it**: Portainer Edge polls a central server; Kamal pushes over SSH; Komodo syncs from git through a core [bench-market.md:263,275]. Peer-replicated intent is new. bench-market.md:263 already marks it as depending on a desired-state model.
- **Builds on**: roster settings as KV, `deployer.yaml` item (bench-market #4), per-node reconcile pattern in doors (`door-converger.ts` hash-based convergence).
- **Missing**: desired-state schema, a per-node reconciler for workloads, conflict semantics (LWW on whole manifests is too coarse), and Swarm remains the scheduler.
- **Design**: manifests as per-service records (key `svc.<id>`), version = hybrid logical clock; node-local reconciler compares against Docker and converges workloads *pinned to that node* (node-affinity services) - Swarm-managed replicas stay with Swarm.
- **Effort**: XL.
- **Risks**: duplicates Swarm's job; scope creep; direct tension with the Postgres plan (edge-mesh-architecture.md section 5).
- **Verdict**: **DEFER** (strategic; decide after the operator answers the open question in section 5).

### C17. Mesh-wide build offload (any member builds, others pull)
- **Value**: builds run on the idlest or most powerful member (a desktop at home), and the artifact lands via C4.
- **Why competitors lack it**: Dokploy/Coolify have dedicated build servers over SSH [bench-market.md:37; bench-coolify.md:30]. A peer-equal, no-SSH, capacity-aware version is new but incremental.
- **Builds on**: C4, node labels for capacity, the runner registry.
- **Missing**: build job RPC over the mesh, source transfer.
- **Effort**: M after C4. **Risks**: untrusted code on peer nodes (build sandbox); resource contention.
- **Verdict**: **DEFER (follow-on to C4).**

### C18. Service port-forward and private DB access ("deployer proxy")
- **Value**: `deployer proxy postgres:5432` gives a laptop a localhost port to a private service, authenticated by member identity, no public DB port, no SSH tunnel.
- **Why competitors lack it**: Coolify/Dokploy expose a "public port" toggle for DBs [bench-coolify.md:24]; Railway/Fly have proxy commands [mem]. Ours is identity-bound and audited via C10.
- **Builds on**: C3 (operator member) and C2 (names). The data path is already routable (Swarm overlay + mesh address).
- **Missing**: C3. **Effort**: S after C3. **Risks**: overlay addresses are not directly routable from the host mesh; use a door-like forwarder on the node that owns the service.
- **Verdict**: **GO-after C3** (folded into C3 as phase 2).

### C19. Signed, member-verifiable health and uptime map
- **Value**: every member publishes signed probe results for each service/node it can see; the UI shows multi-vantage uptime (what the Frankfurt node sees vs what the home node sees), and alerts distinguish "service down" from "my link is down".
- **Why competitors lack it**: single-vantage monitoring in Coolify/Dokploy (and audit says health monitoring is inert) [bench, README]. Multi-vantage from inside the cluster, signed, is new.
- **Builds on**: probes and `reachability` module, labels/gossip, push notification plumbing (audit says delivery is missing).
- **Missing**: probe scheduler, record type, aggregation.
- **Effort**: M. **Risks**: gossip volume; false positives from asymmetric links (that is the feature).
- **Verdict**: **GO (tier 2)**; feeds C5 and C13.

### C20. Zero-config "cluster joins" via ephemeral invite capabilities
- **Value**: scan a QR or paste a one-liner on a new machine; the invite is a signed capability with TTL, max-uses, role and scope, admissible by any member (no controller).
- **Why competitors lack it**: Dokploy needs SSH keys and open 22; Coolify likewise [bench]; Tailscale auth keys come from its coordinator. Ours can be minted offline by any member.
- **Builds on**: `consumeJoinGrant` flow (edge-mesh-architecture.md "Joining"), `roster.ts:509-560` any-member admission, `joinPath` on edge providers, setup wizard.
- **Missing**: today a join needs a "one-time token" held by the API (`mesh.controller.ts:597-645`); no signed offline invite; no multi-use/TTL semantics; the wizard's join UI is unreachable (README setup table).
- **Design**: invite = `{clusterId, issuer, exp, uses, scope}` signed by the issuing member; joiners present it to any reachable member; use counts are tracked by an append-only `invites.used` set (reuse the C10 event record to avoid double-spend with bounded overshoot, and say so: no coordinator means "at most N+partitionSize" worst-case).
- **Effort**: M. **Risks**: over-spend under partition; invite theft (keep TTL short, bind to a node name optionally).
- **Verdict**: **GO (tier 2)**; shares plumbing with C3.

### C21. Clock-independent trust: hybrid logical clocks + signed checkpoints
- **Value**: makes expiry (C3/C8/C20), audit ordering (C10), and revocation cut-off robust against clock lies; today a stolen key can backdate (networking.md 3.5).
- **Why competitors lack it**: n/a (most are central, so they have one clock).
- **Builds on**: `revokedAt`/`setAt`/`issuedAt` ISO fields used in validation (`roster.ts:204-260`).
- **Design**: add HLC counters to member entries, settings, events; validate monotonicity per signer; publish a signed "checkpoint" record (hash of the merged roster) by any member periodically, so a later backdated record contradicts an earlier checkpoint.
- **Effort**: M. **Risks**: schema migration of an on-disk roster (version the envelope).
- **Verdict**: **GO as a shared prerequisite** for C3, C8, C10, C20 (do it as part of C10).

## 3. The best 8 and the build order

Scoring weights: unblocks the product claim, differentiation vs the field, effort, and dependency order. Rank within the eight is the recommended build order.

| # | Build | Candidate | Effort | Why this slot |
|---|---|---|---|---|
| 0 | Hygiene (not a feature) | Wire `declaredAddresses` (networking.md 4.3), bind STUN to the WG port, salt-retry on collision (3.9), role-gate DNS/tunnel/reachability endpoints (3.1-3.3), per-key CAS for settings | S-M | Without these, C1/C2/C12 are demos. Cheap and in the audit's P0/P1. |
| 1 | **C1 Relay-by-any-member** | UDP-in-WG relay | L | Makes the headline claim true; every other mesh story depends on convergence of NATed nodes. |
| 2 | **C2 Mesh DNS + split-horizon** | resolver in agent | M | Makes the private lane usable; prerequisite for C7, C5, C18; fixes a documented gap. |
| 3 | **C3 Operator member + expiring admissions (+ C21 HLC)** | `deployer mesh connect`, `deployer proxy` | M | The CLI "hero"; first consumer of scoped admissions; unlocks C11 and C18. |
| 4 | **C9 Node-scoped sealed secrets** | ECIES wraps in roster | M-L | Fixes the plaintext-tunnel-token finding and the env-secret problem with a distinctive design. |
| 5 | **C10 Tamper-evident audit trail** | append-only signed events | M | The cheapest strong differentiator; needed to make C3/C8/C20 trustworthy. |
| 6 | **C4 P2P image distribution** | OCI registry per node, digest-addressed, pull-through | L | Unblocks real multi-node deploys; needs C1 for relayed peers and C9 for any private registry auth. |
| 7 | **C12 Mesh-gateway edge provider (+C5 health-aware failover)** | BYO-VPS front door; deterministic multi-gateway failover | M-L | The "three houses, no static IPs" story; needs C1, C2 and DNS-01. |
| 8 | **C11 Microsegmentation (node/identity level first)** | nftables from signed policy | L | Closes the loop on guests/operators; needs C3 and the CAS fix. |

Runners-up (tier 2, order): C8 share links, C7 private previews (after previews work), C19 multi-vantage health, C20 invites, C13 locality routing, C6 island mode semantics (cheap, can slot anywhere after C1), C14/C15/C16/C17 later.

Dependency sketch: hygiene -> C1 -> {C2, C3} -> {C9, C10} -> {C4, C12} -> C11. C6 (island mode) can run in parallel once C1 is done.

## 4. Enhancements to the existing network features (best-in-class checklist)

From `networking.md` section 5/6 plus the code reading above. Most are S/M.

Mesh/agent
- E1. **Link telemetry**: surface rx/tx bytes, handshake age, and add an agent-measured RTT/loss per link (WG gives no RTT). Store a short ring buffer per peer and a "link state history" tab. Basis for C13/C14/C19. (M)
- E2. **Mesh doctor** command and UI: checks UDP 51820 reachability, kernel module, STUN, clock skew (against the HLC), MTU black holes (path MTU probe), CGNAT detection (reflexive port != listen port). (M)
- E3. **STUN from the WG socket** (reflexive port correct) and add IPv6 candidates; optional operator-supplied STUN server and "no external STUN" mode for privacy (networking.md 1.1). (M)
- E4. **Agent supervision and upgrade through the mesh**: version in member labels, signed "agent.image" setting, rolling upgrade one member at a time with health guard (edge-mesh-architecture.md next step 4). Pin `:latest`. (M)
- E5. **Roster GC and snapshots**: tombstone pruning with signed checkpoints (also needed by C10). (M)
- E6. **`leave` + `left` re-activation, salt-retry on join collision, "Retry admission" in the UI** (networking.md 3.9, 1.1). (S)
- E7. **Revoke cleanup as one workflow**: remove from Swarm, drop DNS A records, rotate edge/tunnel secrets, purge node row (networking.md 3.16); show the checklist and results. (M)
- E8. **Quorum-guarded revocation option** (opt-in M-of-N for revoke/settings of sensitive keys) while keeping the default peer-equal; fits the stated model that "no quorum, by design" is a default, not a law. (M)
- E9. **Preshared keys and periodic key rotation** per link pair (derive PSK from ECDH of identity keys, rotate via a signed epoch). (M)

Edge/ingress
- E10. **DNS-01 wildcard provider** reusing DNS accounts (also needed by C5/C12); make the ACME email required, no fake default. (M)
- E11. **Per-lane health probe button and per-lane metrics** from doors; connector replica placement and last-seen (networking.md 5). (S-M)
- E12. **Dry-run plan for edge changes** ("what Cloudflare/DNS will change") and **drift display** (planned vs found). (S-M)
- E13. **More edge providers as plugins**: Tailscale Funnel (cheapest, bench-market.md:266), frp/WG relay VPS (C12), NetBird expose, Caddy-on-VPS. Each is ~one file against `edge-provider.ts`. (S-M each)
- E14. **Per-route middlewares in the UI**: IP allowlist, basic auth, rate limit, www redirect; the lane builder already has `middlewares` (`lane-traefik-config.ts:50-52`). Replace the inert project settings. (M)
- E15. **Validation guards**: reject `private.domain === public.domain`, reserved platform hosts, confirmation when public exposes the console (networking.md 3.6, 3.13). (S)
- E16. **Retire the legacy Traefik profile** (docker/file providers on `web`/`websecure`) so dev and prod exercise the same path (networking.md 3.14, 3.11). (M)

Domains/certs
- E17. **Domain verification end to end and enforced at routing**; certificate inventory and expiry alerts. These are P0/P1 in the audit and prerequisite for anything custom-domain related (networking.md 4.2, 4.5). (M)

## 5. Decisions the operator should make (they change these ideas)

1. **Where does platform state live?** `edge-mesh-architecture.md` section 5 plans Postgres replicas on managers. The memory note "mesh first, no source of truth" suggests a log-based, roster-replicated design for the facts that matter to networking (lanes, edges, secrets, audit). Recommend: keep Postgres for projects/deployments but put **network, secrets, audit and invites** in the mesh. C16 depends on the answer.
2. **Relay is a bandwidth commitment.** Are members expected to relay for each other by default, or opt in per node (`relay: true` label)? Recommend opt-out default with a rate cap.
3. **Is "guest/operator member" part of the product?** C3/C8/C11/C20 assume yes.
4. **Privacy of STUN**: do we allow external STUN servers, or require a self-hosted STUN on a gateway member (C12)?
5. **Swarm remains the scheduler** (so C6 is bounded by raft). If a swarm-free scheduler is on the table, C6/C16 change shape.

## 6. Notes on confidence

- All code anchors were read this session; line numbers are from files on disk (an uncommitted tree). Nothing was run.
- Competitor statements use bench-report evidence unless tagged [mem]. Specific [mem] items to re-verify: Fly anycast/region routing and `fly proxy`, Kamal local registry mode, Nebula relay semantics, Spegel/Dragonfly applicability, Tailscale peer-relay details.
- Effort figures assume one engineer familiar with the mesh code and include tests (netns e2e for C1/C11).
