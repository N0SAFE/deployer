# Ideas: security, trust, resilience, platform lifecycle (deployer v3)

Date 2026-10-26. Read-only. Grounded in `docs/audit-2026-10-25/*` and `docs/edge-mesh-architecture.md`, plus spot reads of the code (cited as `path:line`, relative to `v3/`).

Evidence tags: **[bench]** = stated in our bench reports (`bench-coolify.md`, `bench-dokploy-dockhand.md`, `bench-market.md`). **[mem]** = general knowledge of the market, NOT verified by the bench reports. Where I say "no competitor does this" I mean "none of the platforms in our three bench reports (Coolify, Dokploy, Dockhand, plus the market sweep) does"; the benches never examined cosign/OPA tooling in depth, so claims about those are tagged [mem].

Operator principles used as the filter: mesh-first, peer-equal, no central source of truth, no inbound ports, pluggable. An idea that needs a coordinator or a new open port is redesigned or rejected.

---

## 0. What we really have (and the limits that shape every design)

| Asset | Where | Useful for | Limit to design around |
|---|---|---|---|
| Signed roster CRDT: genesis, admission chain, permanent revocation, signed LWW settings | `packages/infrastructure/mesh-network/src/roster.ts` (merge `:373`, admit `:509`, revoke `:611`, setSetting `:626`) | Trust root, signed config distribution, witness signatures, membership-scoped crypto | (a) **Any active member may revoke any member and write any setting** (`roster.ts:610,625`): one stolen node can revoke everyone or rewrite `ingress.lanes`. (b) Timestamps are self-asserted (`roster.ts:21-24` admits a stolen key can backdate). (c) Last-writer-wins settings are not an append-only log. (d) Whole roster is gossiped every 5 s, so it must stay small |
| Key-derived identities: ed25519 signing key, x25519 WireGuard key, ids derived from keys | `identity.ts:97,127,158,169` (`signPayload`/`verifyPayload` over `canonicalJson`) | Signing attestations, audit checkpoints, release manifests; x25519 can wrap data keys to a node | Private keys live on the node (agent state `0600`), never in the API; the API reaches the agent through a unix socket (`control-server.ts`) |
| Better Auth: passkeys, device flow, API keys, 2FA | `packages/auth/src/server/plugins/*` | Step-up approvals, non-repudiation, CLI login | All half-wired per `auth.md` (rpID mismatch, no 2FA challenge, API key header mismatch) |
| Permission engine (library, ~1.9k LOC with specs): rule scopes `all/filter/...`, priority allow/deny, SQL filter compiler, resource graph | `packages/auth/src/permissions/engine/permission-engine.ts:92` (`check`), `filter-compiler.ts`, `resource-graph.ts` | Row-level authz, SQL pushdown for lists, explain | **No consumer.** `role_rules` table exists (`packages/nest/schema/src/global/identity/permissions.ts`) but nothing calls `PermissionService`; loader errors are swallowed `.catch(() => [])` (`permission.service.ts:34`); empty rules means DENY (`permission-engine.ts:106`), so naive wiring locks everyone out; superAdmin bypass at `:100` |
| Encrypted-column codec | `packages/nest/schema/src/codecs/codec-registry.ts:41-110` (AES-256-GCM, scrypt per value) | Secrets at rest | Key from `AUTH_SECRET` as hex = 0 bytes for shipped values (R-02); no key id, no AAD binding, `scryptSync` per read |
| Image scanner (trivy, grype, dive) | `apps/api-services/services/runtime/.../docker.repository.ts:2407-2493`, `ScannerContainerManagerService`, per-node `scanConfig` in `packages/nest/schema/src/local/node-config.ts:127-135` | Scan evidence, SBOM generation (trivy and grype both can), the "run a tool in an ephemeral container" pattern | Scan is advisory; not tied to deployment rows or digests |
| Deployment trust gate | `apps/doc/content/docs/deployment/deployment-trust-gate.mdx` (modes off/warn/enforce, failure taxonomy) | A finished spec to implement | **Docs only: zero TS references** (grep over `apps/` and `packages/`) |
| Event outbox + event log | `.../events/outbox/local-event-outbox.repository.ts:30,70` (`FOR UPDATE SKIP LOCKED` lease claim), `.../events/repositories/core-event-log.repository.ts` (`coreEventLogs`) | Reliable audit/alert emission | Postgres-backed (a source of truth); log is for sync, not tamper-evident |
| Supervisors | `packages/nest/supervisor-core`, `apps/api-services/shared/src/core/modules/supervisors/*` | Scheduled jobs: backup, restore drill, rotation, drift checks | Per-node; election is a facade per `docker-cluster.md` |
| Container exec (terminal sessions routed over the mesh) | `.../docker/domains/containers/runtime/docker-container-shell-domain.service.ts:28,57,75,104` (open/stream/input/close) | Single choke point for session recording and approval | Viewer can exec today (authz gap) |
| Setup handover | `apps/setup/.../handover-orchestrator.service.ts:212-410` | One-time operator claim, recovery kit issuance | `/setup/*` is open after setup (audit) |
| Member kinds (`kind` incl. `operator`) | `schemas.ts:47,62` | Capability scoping, laptop members | Kind is not yet an authority |
| Swarm runner (overlay per deployment, start-first, rollback) | `swarm-runtime-runner.service.ts` | Canary, microsegmentation, rolling self-upgrade | Opt-in, no registry push yet |

Two structural observations that drive the whole report:

1. **The roster is the only thing in the product that is both signed and replicated without an owner.** Everything unique we can offer (verifiable audit, scoped secrets, signed policy/release/backup manifests) is "put a small signed record in the roster, keep the bulk elsewhere". The roster must stay small, so the pattern is always: *bulk data in the DB/volumes/mesh blob transfer; hash + signature + grant lists in the roster.*
2. **The roster's weakest point is its flat authority model** (any member can revoke or set anything). Several ideas below (quorum, capability scoping) fix that, and most of the others are only as trustworthy as that fix. It should be treated as a prerequisite, not an extra.

---

## 1. Idea catalogue (22)

Format per idea: value, competitor status, builds on, missing, design sketch, effort, risks, feasibility.

### I-01 Action Gate: policy-as-code over deploy / exec / expose / mutate
- **Value**: one place that decides every sensitive action, with rules operators can read and test ("production deploys need a signed image", "no exec on nodes labelled `pci`", "services may only be public if project label `public-ok`", "no `traefik.*` labels from deployments"). Replaces scattered `requirePlatformRole` calls.
- **Competitors**: Dokploy custom roles and audit are paywalled **[bench: dokploy-dockhand.md:8]**; Dockhand RBAC/MFA/audit enterprise-only **[bench :85]**; Coolify's policies literally return `true` ("Authorization temporarily disabled") **[bench-coolify.md:32,111]**. None has an expression-level policy language **[bench]**; OPA/Kyverno-style admission is common in Kubernetes land but not in self-hosted PaaS **[mem]**.
- **Builds on**: `PermissionEngine.check` (`permission-engine.ts:92`), `role_rules` JSONB `ResourceRule[]`, rule validator, filter matcher, resource graph. These are already a small policy language (scope, priority, deny).
- **Missing**: an oRPC middleware that every procedure passes through with `(actor, resource, action, target attributes)`; an action vocabulary (`deployment.create`, `container.exec`, `route.expose`, `node.revoke`...); context attributes (project labels, environment, node labels, image digest, scan result, time, approval state); decision log; shadow mode; a policy test harness; seeded default rules; fix the loader to fail loud.
- **Design**: two layers. Layer A is the existing role/ownership rules (declarative, in `role_rules`, SQL-pushdown for lists). Layer B is *guardrail rules* written in a small non-Turing-complete expression language (CEL-like; start by extending the engine's filter DSL with `in`, `matches`, `time` and attribute paths instead of embedding OPA). Guardrails can only DENY or REQUIRE (`require: approval(n=2)`, `require: fresh-passkey`, `require: trust-passport`); they never grant. The compiled policy bundle is **signed by the admin's member key and published as a roster setting (`policy.bundle` = hash + version; bulk in PG)** so every node/service evaluates the same signed bundle locally and a compromised DB cannot silently loosen policy (services verify bundle hash against the roster before using it; mismatch = fail closed + alert). Every decision, allow or deny, is an audit event (I-03).
- **Effort**: L (M for Layer A wiring alone, which is the audit's P0 anyway).
- **Risks**: lockout on first wiring (empty rules = deny; ship seeded defaults mirroring `permissions/config.ts` and a `superAdmin` break-glass bypass that is audited); latency (cache per request, invalidate by event); a language too powerful to reason about.
- **Feasibility**: High for Layer A, Medium for Layer B.

### I-02 Capability-scoped roster authority plus quorum for catastrophic operations
- **Value**: stops a single stolen node or single rogue admin from revoking the cluster, re-pointing the public edge, or swapping the policy bundle. Real hole today: `revokeMember` and `setSetting` accept any active member (`roster.ts:610,625`).
- **Competitors**: Tailscale/NetBird/Headscale rely on the control server's ACLs **[bench-market.md:252]**; none of the benched PaaS has a multi-party control concept. Unique because the authority is cryptographic and lives in the replicated state.
- **Builds on**: `validateRoster` already drops records that do not chain to genesis and honours revocation cut-offs (`roster.ts:204,109`); `SignedAdmission` records can carry more fields.
- **Missing**: `capabilities` in the admission record (`admit`, `revoke`, `settings:<prefix>`), signed by the admitter and bounded by the admitter's own capabilities (delegation can only narrow). Quorum records: a setting/revocation is valid only with `k` signatures from distinct members holding the capability (a `SignedSetting` gains `cosigners[]`). Wire-format version bump and migration of existing single-signer clusters (grandfather: existing members get full capabilities).
- **Design**: default policy `revoke: 1 of any member` stays for compromised-node cleanup *but* a revocation of a member holding `admit` needs 2. Settings under `policy.*`, `edge.*`, `ingress.*` need 1 signature from a member whose admission carries the prefix capability; `policy.*` and `release.*` need `k` of an admin set. Operator laptops (`kind: operator`) get `settings` capability by default, ordinary nodes do not. Merge stays a pure function so CRDT properties hold (capability evaluation is over the union of admissions at the record's `issuedAt`, with the same fixed-point loop).
- **Effort**: L (protocol change, test matrix, migration).
- **Risks**: the self-asserted timestamp caveat (`roster.ts:21-24`) means "capability at time T" can be gamed by backdating; mitigate by evaluating capability against the *current* admission set, not time-travelled. Deadlock if too few capable members remain: always keep a documented `recovery` path (I-08 recovery kit).
- **Feasibility**: Medium. High value, careful work; the CRDT convergence property tests already exist in `mesh-network` and are the safety net.

### I-03 Tamper-evident audit log anchored in the roster
- **Value**: an audit trail an attacker with full DB access cannot rewrite without detection, verifiable offline by an auditor. Also the evidence source for I-12, I-15, I-16.
- **Competitors**: Coolify has no audit log beyond webhook failures **[bench-coolify.md:48,115]**; Dokploy's is enterprise-only **[bench-dokploy-dockhand.md:45]**; Dockhand's is enterprise-gated **[bench :77,85]**. Nobody tamper-evident **[bench]**; the bench-market already flags the roster as "the platform's first audit-log stream" **[bench-market.md:262]**.
- **Builds on**: oRPC middleware point (every mutation), `canonicalJson` + `signPayload` (`identity.ts:158`), outbox for reliable write, `core-event-log` as a model (but write a separate `audit_log` table; `coreEventLogs` is a sync stream with NUL-stripping and retry semantics that do not suit an append-only chain).
- **Missing**: audit schema (actor, actor kind, session id, procedure, resource, decision, diff hash, request id, node id), per-node hash chain (`h_n = H(h_{n-1} || canonical(entry))`), a **checkpoint** record `{nodeId, seq, headHash, at}` signed by the writing node's member key and gossiped as a new roster record kind `anchors` (union map, last checkpoint per node, so it stays O(members)), witness co-signing (peers countersign the head they receive, giving non-backdatable ordering that the self-asserted timestamp alone cannot), a verifier (CLI `deployer audit verify` and a UI badge), export.
- **Design**: each node (or each service tier with its own signer via the agent socket) chains entries; every N entries or T seconds the agent signs a checkpoint and it rides the existing 5 s gossip. Any member can verify: chain continuity per node plus "checkpoint signed by a non-revoked member and countersigned by >= 1 other". Deleting or editing rows breaks the chain against an already-gossiped anchor. Entries hold hashes of large bodies (session recordings, diffs), not the bodies. A revoked node's pre-revocation anchors remain valid (matches roster semantics).
- **Effort**: M for log + chain + UI; +M for anchoring and witnessing.
- **Risks**: truncation of the tail after the last anchor (bounded by anchor interval; document RPO of evidence); PII in entries (store ids, hash payloads); volume (retention with chain-preserving compaction: keep hashes, drop bodies).
- **Feasibility**: High. Everything needed exists except the record kind.

### I-04 Deployment passport: signed provenance per deployment plus supply-chain admission
- **Value**: each deployment carries "this exact plan, this digest, this scan result, this signer, this actor" signed by the node that executed it; rollback replays the passport; policy can refuse unsigned or vulnerable images. Answers "what is running and why do we trust it" in one click.
- **Competitors**: Dockhand has a vulnerability gate on container *updates* only **[bench-dokploy-dockhand.md:60]**; Dokploy/Coolify have no signing, SBOM or provenance **[bench: none found]**; cosign verification and provenance in a PaaS is **[mem]** a mainly-hosted-cloud feature. The unique part is the passport being signed by a mesh member and anchored (I-03).
- **Builds on**: scanner already scans by digest on the node (`docker.repository.ts:2407-2493`), `scanConfig` per node, doc spec `deployment-trust-gate.mdx` (modes, policy object, reason codes: use as-is), the runtime pipeline, outbox.
- **Missing**: image digest capture at deploy (needs registry push/pull by digest, `docker-cluster.md:124`); a verifier container pattern for `cosign verify` and `cosign verify-attestation` (same ephemeral-container approach as trivy; keyless via Fulcio/Rekor needs outbound internet, offer key-based and "trusted identity" modes, offline-first); SBOM generation (trivy `--format cyclonedx` / grype; store CycloneDX as an artifact keyed by digest); plan persisted on the deployment row (audit P0 #7; today plan snapshots are in-memory, `deployments.md:35`); `trust_gate` timeline step; policy knobs (max severity, allowed signers, allowed registries, max age); per-service override with an expiring waiver (signed, audited).
- **Design**: preflight step `trust_gate` computes `{imageDigest, planHash, scanSummary(db version, counts), sbomRef, signature{verified,signer}, attestations[], actor, policyVersion, decision}`, runs Action Gate (I-01) `deployment.create` with these attributes, then the executing node signs the record with its member key via the agent socket. Stored with the deployment and its hash goes into the audit chain. Deploy-time rule examples: `severity>=CRITICAL and not waived => deny`; `environment==production and not signed => deny`. Continuous mode: rescan running digests on a schedule with a fresh vuln DB and raise "drift: image became vulnerable after deploy" (Dockhand-like but surfaced against passports).
- **Effort**: L (M for scan-gate + passport without cosign; +M for signature/attestation/SBOM).
- **Risks**: false-positive blocking (default `warn`, enforce per environment); scanner DB freshness offline (cache DB on the mesh, one node refreshes and shares); keyless cosign needs egress; trivy/grype disagreement (policy picks union or primary).
- **Feasibility**: High for gate + passport, Medium for full attestation verification.

### I-05 Node-scoped secrets (envelope encryption to member keys)
- **Value**: a secret only decrypts on nodes allowed to run the service that uses it. A compromised or stolen *unrelated* node (or the DB dump) cannot read it. Today one key (`AUTH_SECRET`) decrypts everything and every node holds the roster plaintext (the Cloudflare tunnel token is gossiped in clear to every node and visible in the connector env, `networking.md:106`).
- **Competitors**: Dokploy stores env in plaintext DB columns **[bench-dokploy-dockhand.md:51]**; Coolify encrypts with a single app key **[bench-coolify.md:27 (flags), mem]**; neither scopes by node. Vault/Doppler-style per-consumer scoping exists as separate products **[mem]**; having it built into a peer-to-peer mesh with no server is the unique part.
- **Builds on**: each member's x25519 key (WireGuard key; derive a separate encryption key via HKDF with domain separation rather than reusing it directly), `MemberEntry` records, `encryptedText` codec seam (`codec-registry.ts:41`), placement labels, swarm secrets (`docker-cluster.md:128`).
- **Missing**: hybrid encryption helper (ephemeral x25519 + HKDF + AES-GCM = HPKE-style) in `mesh-network`; a `secretGrants` roster record kind: `{secretId, version, wraps: {memberId: wrappedDek}, scopeHash}` signed by the writer, or keep wraps beside the ciphertext in PG and anchor only `{secretId, version, wrapsHash}` in the roster; a node-side secret resolver that unwraps via the agent socket (private key never leaves the agent) and hands the runner a Swarm secret or tmpfs file; AAD binding (secretId, version, column) into GCM so rows cannot be swapped (the current format has no AAD, `codec-registry.ts:41-110`).
- **Design**: secret write: generate DEK, encrypt value (AES-256-GCM with AAD), wrap DEK to each member in the *allowed set* = nodes the placement policy can put that service on (from node labels; computed, not typed). Placement change recomputes wraps (a node newly allowed gets a wrap from any member that can unwrap: peer-equal). **Revocation = re-key**: revoking a member triggers rotation of every secret it could unwrap (I-11), because a revoked node may have already read plaintext; revocation cannot un-leak but ends future exposure. Roster-resident secrets (`edge.*` tokens) move to this scheme first: that fixes a known audit finding with a small blast radius. Key ring ids (`v2:kid:...`) replace the fixed key (audit P0 #2).
- **Effort**: L.
- **Risks**: availability (a service cannot start on a node whose wrap is missing: surface as a placement-blocking reason, not a silent failure); roster size if wraps are stored there (mitigation above); crypto agility and review; DB backup restore needs at least one allowed member alive (ties to I-07 recovery kit).
- **Feasibility**: Medium. The pieces are standard; integration with the runner and swarm placement is the work.

### I-06 Break-glass / just-in-time access with approvals and session recording
- **Value**: exec/terminal, file browser writes, secret reveal, and role elevation become time-boxed, approved, and recorded; day-to-day roles stay low privilege. Compliance-grade evidence for "who ran what in production".
- **Competitors**: Coolify's terminal is gated by a flag only **[bench-coolify.md:36,87]**; Dokploy and Dockhand terminals have no audit/approval **[bench-dokploy-dockhand.md:71,121]**. Teleport-style JIT and session recording exist as separate products **[mem]**; not in any benched PaaS.
- **Builds on**: the terminal domain (`docker-container-shell-domain.service.ts` open/input/stream/close is a clean choke point, and it already routes over the mesh), Better Auth passkeys and device flow for step-up, I-01/I-03.
- **Missing**: an access-request object (who, target scope, reason, TTL, approvers needed), approval UI/push notification (web push exists but service worker is not built, `observability.md`), time-boxed grants evaluated by the Action Gate, step-up (fresh passkey assertion within N minutes, which requires fixing the passkey rpID, `auth.md` 3.9), session recorder (asciicast-style frames written by the node hosting the container, encrypted to the *auditor* role keys and hashed into the audit chain), kill switch, view-only live "shadow" session.
- **Design**: policy says `container.exec on env=production requires approval(1 other admin) and fresh-passkey`; default TTL 30 min, auto-expire the open session. The recording is captured where the exec runs (the owning node, not the API), written as a blob to a local store with a hash chain, and its head hash is an audit entry; the recording content is envelope-encrypted so a DB reader cannot replay it (I-05 helper). Break-glass for emergencies: self-approve with mandatory reason, loud alert to everyone, auto-opens a review task, flagged in compliance export (I-15).
- **Effort**: L (M if recording is deferred).
- **Risks**: recorded secrets typed in sessions (redaction patterns, restrict who can replay), storage growth (retention), latency on the terminal path, approvals requiring a second human in a one-person homelab (allow `solo` mode that degrades to "fresh passkey + reason + audit").
- **Feasibility**: High for approval + audit, Medium for recording.

### I-07 Platform disaster recovery: any node can rebuild control state
- **Value**: lose the Postgres node, or all but one node, and recover the platform from what survives, with no external storage mandatory. Today there is no backup at all (R-03), Postgres is one replica with a node-local volume.
- **Competitors**: Coolify has instance backup to S3 **[bench-coolify.md (S3 instance backup), bench-market.md:81]**; Dokploy has a web-server backup **[bench-dokploy-dockhand.md:25]**. Both depend on external object storage and a surviving central server. Replicated, node-sovereign recovery is unique **[bench]**.
- **Builds on**: roster (membership/settings already survive founder loss: `edge-mesh-architecture.md` §1), mesh blob path between members (gossip is mesh-only), supervisors for scheduling, I-05 key wrapping, encrypted codecs.
- **Missing**: the entire backup subsystem (audit P0 #10): scheduled `pg_dump` (logical, since WAL archiving needs infrastructure) plus node SQLite plus mesh identity/roster plus acme.json; snapshot encryption with a *cluster backup key*; snapshot manifest `{id, at, sizes, chunkHashes, schemaVersion}` signed by the producer and recorded in the roster (`backup.latest`); chunk replication to other members; reconstruction procedure; restore into a *fresh* single node.
- **Design**: snapshot -> compress -> encrypt with a random DEK -> DEK wrapped to **every active member** (I-05) plus to the recovery kit (I-08). Small clusters (<= 3 nodes): full copy on each node. Larger: Reed-Solomon k-of-n shards spread over members by label diversity. The signed manifest in the roster means a lone surviving member knows the latest snapshot, its hashes, and which peers held shards. Recovery from total loss of the control plane: `deployer restore` on any surviving member (or a new machine with the recovery kit) fetches shards from reachable members, verifies the manifest against the roster chain, decrypts, brings up Postgres, replays migrations, re-announces. Optional S3/SFTP destination is just another shard holder (pluggable, consistent with edge providers).
- **Effort**: XL.
- **Risks**: RPO equals snapshot interval (honest: logical backups are not PITR); DB size growth vs shard storage; restoring while members still believe old state (use the manifest sequence plus audit anchors to detect rollback); k-of-n availability for tiny clusters. Do not pretend this is HA; HA data tier (replicated Postgres) is a separate item.
- **Feasibility**: Medium. Phase it: local + S3 first (P0 anyway), then mesh-replicated shards.

### I-08 Restore-verified backups plus a recovery kit
- **Value**: a backup that has never been restored is a hope. Platform proves each backup restores and answers "how old is my last *proven* backup" on the dashboard. The recovery kit (printed at setup) removes "I lost the admin and the only node" as a dead end.
- **Competitors**: Coolify has **no restore verification, no PITR** **[bench-coolify.md:115]**; Dokploy restores on demand only **[bench-dokploy-dockhand.md:23]**. Unique among the benched **[bench]**.
- **Builds on**: supervisors (schedule), ephemeral container runner (the scanner-container pattern), I-07 snapshots, notifications once they exist.
- **Missing**: restore-drill job: on a *different node than the producer*, start throwaway Postgres, restore, run integrity checks (row counts per table within tolerance, `SELECT` canary queries, schema version matches migrations, encrypted-column decrypt probe using a known-plaintext canary row), tear down, sign a **restore attestation** `{snapshotId, verifiedBy, at, checks}` into the audit chain and roster. For user databases (templates) the same loop with the template's declared verify query. Recovery kit: at setup handover (`handover-orchestrator.service.ts`) generate a recovery secret split with Shamir (k-of-n, shown once, never stored) that can unwrap the backup DEK and authorise re-genesis; a "kit rehearsal" in the drill (verify by challenge without revealing).
- **Effort**: M for drills (given I-07 snapshots exist), +M for Shamir kit.
- **Risks**: drill cost on small nodes (resource caps, schedule off-peak, run on the least loaded member); false assurance if checks are weak; kit mishandling (it is a bearer credential: explicit warnings, confirm-saved flow).
- **Feasibility**: High.

### I-09 Zero-downtime self-upgrade of the platform with canary and auto-rollback
- **Value**: upgrade the platform itself (API, BFF, services, web, mesh agent, Traefik) without downtime, gated by health and a fresh backup, rolled back automatically.
- **Competitors**: Coolify has **no self-upgrade rollback** **[bench-coolify.md:115]**; Dokploy upgrades are a manual script **[mem]**; Komodo has self-update **[mem]**. None canaries across nodes **[bench]**.
- **Builds on**: swarm start-first and rollback (`swarm-runtime-runner`, Traefik rollback `failureAction`, `ops.md` §2), supervisors, health gate, mesh agent (needs upgrade path: `edge-mesh-architecture.md` Next step #4), roster settings, I-04 verification, I-08 pre-upgrade backup gate.
- **Missing**: release manifest (signed list of image digests and migration versions); a version-skew policy between BFF and services (`ops.md` §5 enhancements); migration discipline (expand/contract, a lock, `0040`-style backfills run as a gated step, audit P0 #9); an upgrade orchestrator that is itself not a single point of failure.
- **Design**: mesh-first: the desired release is a roster setting `release.target = {version, manifestHash}` written by `k` admins (I-02) and signed. Each node's agent compares against its running version and converges itself (no coordinator; "pull" matches the no-inbound rule). Ordering is encoded in the manifest: step 1 pre-flight (backup attestation fresh, quorum healthy, skew policy satisfied), step 2 canary: one non-manager node or one replica takes the new BFF/service images; step 3 soak against SLO gates (error rate, health, p95, deploy success on a synthetic project) for T minutes, step 4 roll the rest with start-first; migrations run under a lock only after canary passes and only expand-style; step 5 mesh agents last, one at a time, never more than one non-quorum member down; failure at any step flips `release.target` back (automatic, signed by the orchestrating member under a pre-authorised "rollback" capability, I-02). Manifest signature verified with a release key pinned at setup so a compromised registry cannot push a malicious "upgrade" (ties to I-04).
- **Effort**: XL.
- **Risks**: bricking the control plane (the local door rescue lane exists, keep it as the recovery path; never upgrade Traefik and doors in the same wave); schema migrations that are not backward compatible break rollback (enforce expand/contract in CI); agent self-upgrade is the most dangerous step (keep previous container until new one reports healthy).
- **Feasibility**: Low-Medium until the topology cutover (audit P0 #8) and registry push land; High value after.

### I-10 Game Day: failure drills as a button
- **Value**: proves the resilience claims instead of asserting them. Founder-loss, node loss, partition, DB failover, registry down, cert expiry; produces an RTO report and a resilience score; also the regression harness for I-07 and I-09.
- **Competitors**: none **[bench]** (chaos tooling exists as separate OSS **[mem]**).
- **Builds on**: the existing founder-loss e2e, supervisors, doors/rescue lane, mesh agent control socket, event stream.
- **Missing**: a drill catalogue with safe, reversible faults (stop a swarm service replica, drop WireGuard for a peer pair via the agent, block the API door, simulate expired cert in a staging route, kill the Postgres task and measure recovery, revoke a *test* member); preconditions (never on single-node clusters, require backup attestation fresh, quorum margin >= 1, blast-radius cap, auto-abort when the real SLO trips); assertions (roster converges within T, edge fails over to the local rescue lane, alerts fired, restore drill passes); report artifact signed and audited.
- **Design**: drills are declarative YAML-like scenarios run by a supervisor on one member and executed *via the mesh agent* on targets. Dry-run mode prints the plan and expected effects. Schedule quarterly "game day" reminders and a "drills passed in last 90 days" tile in compliance export.
- **Effort**: M (basic catalogue), L (partition and DB failover).
- **Risks**: a drill causing real outage (strict preconditions, abort button, scope to labelled "drillable" services first); misleading green (assertions must check user-visible endpoints, not internal flags).
- **Feasibility**: High for service/node drills, Medium for partition (relay is still a stub: `networking.md`).

### I-11 Automatic rotation: certificates, secrets, tokens, *and rotation-on-revocation*
- **Value**: nothing long-lived and nothing survives a revoked node. The audit lists a dozen static credentials: `AUTH_SECRET` (no key id), DB/Redis passwords in swarm env, join tokens, tunnel token in the roster, mesh shared secret, VAPID keys, webhook secrets, ACME email default.
- **Competitors**: Coolify has internal CA with regenerated certs twice a day for DB/service TLS **[bench-coolify.md:22]**; none rotates on membership change **[bench]** (they have no membership model).
- **Builds on**: `meshSharedSecretUpdatedAt` already exists (`node-config.ts` ~`:110`), key-ring work from audit P0 #2, roster revocation event, `networking.md:139` already asks for "rotate tunnel token on revoke", swarm join-token rotate (`docker swarm join-token --rotate`), Traefik ACME.
- **Missing**: a **rotation registry**: every credential kind implements `{id, ageLimit, rotate(), consumers[], verify()}`; a supervisor schedules and runs; a roster-driven trigger so a revocation record automatically fans out rotations for everything the revoked member could read (using the unwrap set from I-05); dual-key overlap windows (accept old and new for N minutes) so rotation is zero-downtime; shared ACME cert store or single issuer (today every node issues, `ops.md` R-16).
- **Design**: a "rotation ledger" in the audit log. Overlap pattern for DB passwords: create second role, update consumers via swarm secret rollout, drop old role. Join tokens rotate after every join grant. Cert rotation includes internal service TLS later.
- **Effort**: M for the registry + first consumers (join tokens, tunnel token, mesh secret, key ring), L to cover DB credentials with overlap.
- **Risks**: rotation outages from missed consumers (the `consumers[]` registry plus verify step; canary consumer first); DB password rotation with swarm secrets requires the Docker-secrets migration (audit P1 #11).
- **Feasibility**: Medium-High incrementally.

### I-12 Per-project microsegmentation, with egress allow-lists and enforcement from the dependency graph
- **Value**: a compromised service cannot reach other projects, the Docker socket proxy, Postgres, or the internet at large; declared dependencies are the only allowed edges.
- **Competitors**: Coolify/Dokploy default to a shared network per server **[mem; benches silent]**; Railway has per-project private networking **[bench-market.md:126]**; egress control and graph-derived rules in a self-hosted PaaS is **[mem]** rare.
- **Builds on**: the swarm runner already creates overlay networks per deployment and attaches them to the platform overlay (`docker-cluster.md:75`), project dependency graph (stored, currently unused: `README.md` §2 "Dependency graph / cascade deploy: inert"), Traefik routing.
- **Missing**: one overlay per project (internal, attachable only by that project), service-to-service allow edges derived from the dependency graph, ingress reachability only via Traefik, egress policy (DOCKER-USER/nft rules or a per-node egress proxy), policy surface in the Action Gate (`network.attach`), UI to show the graph with allowed/blocked edges, test traffic probe.
- **Design**: default deny between projects and from services to platform control overlay. Egress: per-service `egress: [github.com:443, registry:443]` enforced by the agent applying nft rules inside the node network namespace or by routing through a per-node egress proxy container; build sandbox gets egress only to the git host and registries. Node-level segmentation (which node may reach which) is *not* attempted at WireGuard AllowedIPs level because swarm needs full-mesh reachability; keep segmentation at overlay/egress layer.
- **Effort**: L (overlay-per-project M; egress enforcement L).
- **Risks**: breaking multi-service apps that implicitly relied on shared networking (opt-in per project, `observe` mode that logs would-be denials first); nft vs Docker iptables interaction; Windows/rootless hosts.
- **Feasibility**: Medium.

### I-13 Edge protection presets (WAF, rate limits, headers, bot rules) per route
- **Value**: "turn on Login protection" instead of hand-writing middleware; also fixes audit R-09 (no rate limiting) and R-10 (no security headers) for the platform's own routes.
- **Competitors**: NetBird's reverse proxy has IP/country/CrowdSec/SSO/PIN rules **[bench-market.md:130]**; Dokploy inherits basic auth/redirects **[bench]**; Coolify manual middleware **[mem]**. So not unique, but a preset library tied to a pluggable edge is a differentiator with Cloudflare Tunnel (CF rules) and Traefik both honoured.
- **Builds on**: `traefik-middleware-library.service.ts` (middleware definitions exist but unused for platform routes, `ops.md` §1), edge provider registry (`EdgeProviderRegistry` plus descriptors), route `visibility`.
- **Missing**: preset catalogue (`web-app`, `api`, `login`, `webhook-receiver`, `admin-console`), each a named bundle: security headers, rate limit (needs shared store so multi-node counts are right: Redis or per-node local limits with mesh-gossiped counters is overkill; per-node limits are acceptable), in-flight limits, IP allowlist/geo (edge provider capability), body-size caps, optional Coraza/CrowdSec plugin; per-route assignment in UI; edge provider `capabilities` in descriptor so presets degrade honestly ("Cloudflare handles this" vs "Traefik handles this").
- **Effort**: S-M.
- **Risks**: false blocks (log-only mode), plugin supply chain (pin by digest, I-04), IP forwarding correctness behind tunnels (trusted-proxy config).
- **Feasibility**: High.

### I-14 Quota, budget and change-rate guards (including freeze windows)
- **Value**: stops runaway deploy loops, builds that starve Postgres, a compromised token spamming deployments. Also the way to make the inert project quota settings real (`README.md` §3.4).
- **Competitors**: Dokploy has container limits only **[bench]**; billing-style quotas are hosted-platform features **[bench-market.md:161]**. Rate/budget guards as policy is **[mem]** uncommon.
- **Builds on**: project settings (quotas, retention exist as stored fields), Action Gate (I-01), swarm resource limits (`resourcesLimits` currently `{}`, `ops.md` §5).
- **Missing**: counters (deploys/hour, concurrent builds, exec sessions, storage), enforcement hook, `require` reasons ("freeze window: Friday 16:00-Monday 08:00, requires break-glass"), resource limits applied to platform services.
- **Design**: expressed as guardrail rules in I-01 with per-project and per-actor budgets; counters in Redis or per-node SQLite with the audit log as the durable source.
- **Effort**: S-M.
- **Risks**: noisy denials; low (policy dry-run first).
- **Feasibility**: High.

### I-15 Compliance evidence export (SOC2/ISO-style), verifiable offline
- **Value**: one click produces an evidence bundle: access reviews (role matrix, last login, 2FA/passkey coverage), change log (deployments with passports), privileged-access log (I-06 sessions), backup restore attestations, vuln posture, rotation ledger, game-day results; bundle is signed and carries audit anchors so an auditor can verify without trusting the platform.
- **Competitors**: none **[bench]**; Dokploy/Dockhand audit export is raw JSON/CSV and paywalled **[bench-dokploy-dockhand.md:77]**.
- **Builds on**: I-03 (anchors), I-04 passports, I-08 attestations, I-11 ledger, `system:audit` permission already defined with no producer (`auth.md` §5).
- **Missing**: evidence collectors per control, bundle format (`manifest.json` signed + files + audit proofs), a verifier tool, control mapping docs. State plainly that it is **evidence generation, not certification**.
- **Effort**: M after the above exist.
- **Risks**: over-claiming compliance; PII in exports (redaction profile).
- **Feasibility**: High, late in the build order.

### I-16 Exec/file anomaly detection and honeytokens
- **Value**: notice a stolen session or insider quickly: first-time exec on a node by a user, exec outside usual hours, mass file download from the container file browser, use of a decoy secret.
- **Competitors**: none **[bench]**.
- **Builds on**: terminal and file domains (single choke points), audit stream (I-03), notification engine (not built yet), Action Gate to auto-respond (`require` fresh passkey or approval).
- **Missing**: baselines (rule-based first, no ML: per-actor rolling frequency, set of nodes/containers touched, hours), detectors, **honeytokens**: platform injects decoy env vars/files (for example fake `AWS_SECRET_ACCESS_KEY` named like real ones) into selected services and plants a canary URL/credential; any read through the platform's secret-reveal/file/exec paths of a decoy, or a hit to the canary URL, raises a high-severity alert; auto-response ladder (alert, force step-up, suspend session, revoke API key).
- **Effort**: M.
- **Risks**: alert fatigue, decoys confusing real operators (clearly labelled in UI for admins), cannot see activity done directly on the host outside the platform (scope statement).
- **Feasibility**: Medium-High.

### I-17 Exposure attestation: continuously prove the "no inbound port" invariant
- **Value**: the product's headline invariant ("node has no listening socket on a public interface unless operator opted into `direct`") becomes *checked* and visible instead of asserted. Each node signs "listening sockets = expected set" regularly; the UI shows a green/red proof per node; a violation alerts and can auto-quarantine.
- **Competitors**: Dokploy has a one-shot server security audit (ufw/ssh/fail2ban) **[bench-dokploy-dockhand.md:35]**; nobody attests continuously or signs it **[bench]**.
- **Builds on**: mesh agent on every node (host network, can read `/proc/net` via netlink), doors design (`edge-mesh-architecture.md` §3 declares exactly which sockets should exist), roster `declaredAddresses` and `acknowledgedInboundPorts`.
- **Missing**: expected-socket derivation from roster settings + doors + Swarm, a scanner in the agent (read-only), attestation record `{nodeId, expectedHash, observedHash, at}` signed and chained, external reachability probe (optional: peer or STUN-assisted self-probe of own public IP; do not require a third-party service by default), diff UI. Also includes the Docker-socket exposure check (`ops.md` R-07).
- **Effort**: S-M.
- **Risks**: false positives from Docker host-network services (allow-list by label); privilege of reading sockets (agent already has `NET_ADMIN`).
- **Feasibility**: High. Cheap and on-brand.

### I-18 Step-up and signed approvals with passkeys (non-repudiation)
- **Value**: dangerous actions require a fresh WebAuthn assertion, and the assertion hash is stored with the audit entry, so "I did not do that" is checkable.
- **Competitors**: Dockhand MFA is enterprise-only **[bench-dokploy-dockhand.md:8,76]**; Dokploy has 2FA only **[:141 of bench list]**. Passkey step-up per action is **[mem]** rare in self-hosted PaaS.
- **Builds on**: Better Auth passkey plugin (`securityPlugins.ts`), session `freshAge` setting (missing today, `auth.md` §1).
- **Missing**: fix passkey rpID/origin (audit P0/P1), `freshAge` policy, `require: fresh-passkey` primitive in I-01, assertion capture, UI prompts.
- **Effort**: S-M. **Risks**: browser/device support; lockout (backup methods; recovery kit I-08). **Feasibility**: High.
- (Folded into I-06 and the Action Gate as a primitive, listed separately for visibility.)

### I-19 Isolated build sandbox pool (builder member kind) and Docker-API capability broker
- **Value**: untrusted repos build on nodes with no control-plane credentials and no Docker socket on the API; the public-facing tier never holds socket access. Directly addresses R-06 and R-07.
- **Competitors**: Dokploy has a build server **[bench-dokploy-dockhand.md (Build Server)]**, Komodo has remote builders **[bench-market.md:37]**; neither isolates credentials or integrates with a signed identity **[bench]**.
- **Builds on**: member `kind` field (add `builder`), swarm labels, egress allow-list from I-12, mesh agent (could run rootless BuildKit as a managed container).
- **Missing**: builder kind and admission policy, build job dispatch over mesh, artifact/digest return with attestation (feeds I-04: *the build node signs the passport for what it built*), socket proxy for remaining consumers.
- **Effort**: L. **Risks**: operational complexity on one-node installs (fallback to local rootless build). **Feasibility**: Medium.

### I-20 Key-compromise recovery without a new cluster ("epoch transition")
- **Value**: the roster doc says the answer to a stolen key is "a new cluster" (`roster.ts:21-24`). A signed epoch rollover lets surviving members cut off a compromised member *including backdated records* and carry the cluster forward.
- **Competitors**: none; mesh products rely on the coordinator **[bench-market.md:252]**.
- **Builds on**: genesis/admission chain; I-02 quorum.
- **Missing**: `epoch` record co-signed by k members that lists the accepted admission set and a cutoff witness hash from I-03 anchors; records after the epoch must chain through it; migration of every agent.
- **Effort**: XL. **Risks**: protocol complexity and subtle forks; needs formal-ish review and property tests. **Feasibility**: Low now; research-grade. Keep as a future item after I-02/I-03 prove out.

### I-21 Safe secret and config reveal: "shown once", reveal logging, watermark
- **Value**: env var values are masked on read; reveal requires permission, is audited, and optionally step-up (I-18). Fixes plaintext env var finding and "viewer can read env".
- **Competitors**: Coolify has `is_shown_once` flags **[bench-coolify.md:27]**. Not unique, but belongs to the best-in-class authz surface.
- **Builds on**: encrypted env table (no consumer today), I-05.
- **Effort**: S-M. **Feasibility**: High.

### I-22 Supply-chain hygiene of the platform itself (self-attestation)
- **Value**: the platform's own images are signed and have SBOMs and provenance; setup verifies them before running; Dependabot/SHA pinning. Makes I-09 verification meaningful.
- **Competitors**: not observed in benches **[bench]**.
- **Builds on**: CI workflows (`ci.yml`, `deploy.yml`), audit P2 #17.
- **Missing**: CI step building, SBOM, cosign signing, digests pinned in compose and in the release manifest.
- **Effort**: M. **Feasibility**: High.

---

## 2. The best 8, with build order

Scoring: user value x uniqueness vs the benched competitors x feasibility on what exists, minus effort. Prerequisites outside this list (not optional): audit P0 authz layer, key ring with key ids (P0 #2), honest deploy plan persisted on the row (P0 #7), registry push by digest (P1 #15), backups basic (P0 #10).

| Order | Item | Why this position | Effort | Depends on |
|---|---|---|---|---|
| 1 | **I-01 Action Gate (Layer A: wire engine + role_rules, default-deny, decision log)** | Unblocks everything; the audit's biggest single lever; makes Dokploy/Dockhand paywalled features free | M (Layer A), +M (Layer B guardrails) | audit P0 #5 |
| 2 | **I-03 Tamper-evident audit log, then roster anchoring** | Cheap, first dependable "wow", feeds 4/6/7/8 | M + M | I-01 hook point |
| 3 | **I-02 Capability-scoped roster authority + quorum** | Closes the roster's flat-authority hole before more trust is stacked on it; must precede signed policy and release manifests | L | I-03 (witnesses help) |
| 4 | **I-04 Deployment passport + supply-chain admission** | Highest user-visible security story; reuses scanner; implements an existing spec | L | plan persisted, digest pull, I-01 |
| 5 | **I-05 Node-scoped secrets (+ I-11 rotation-on-revoke, first consumers)** | The strongest mesh-native differentiator; also fixes the tunnel-token-in-roster finding | L (+M) | key ring, I-02 |
| 6 | **I-06 Break-glass / JIT / recorded exec (with I-18 step-up)** | Compliance-grade and sells the audit story; terminal choke point already exists | L | I-01, I-03, passkey fix |
| 7 | **I-07 + I-08 Mesh-replicated backup/DR with restore verification and recovery kit** | Resilience headline; P0 backup need turned into a differentiator. Phase 1 is plain backups (needed anyway), phase 2 adds replication and drills | XL (phased) | I-05, supervisors |
| 8 | **I-09 Self-upgrade with canary + auto-rollback, validated by I-10 Game Day** | Lifecycle crown jewel; do last because it needs 3 (signed manifests), 7 (backup gate), registry/digest pipeline. Game Day (M) ships first as the harness that proves 7 and 9 | XL + M | 3, 4, 7 |

Quick wins that ride along (S-M, can be slotted anywhere after 1): I-17 exposure attestation, I-13 edge presets (also fixes R-09/R-10), I-14 quota guards, I-21 secret reveal discipline, I-22 signed platform images.
Deferred: I-12 microsegmentation (valuable, L, wait for dependency graph to be real), I-15 compliance export (after 2, 4, 6, 7), I-16 anomaly (after audit stream and notifications), I-19 builder pool, I-20 epoch transition (research).

Dependency sketch: authz (1) -> audit (2) -> roster authority (3) -> {passport (4), secrets (5)} -> {JIT (6), DR (7)} -> upgrade (8), with I-15 consuming 2/4/6/7/10 at the end.

---

## 3. Making the authorization layer best-in-class (beyond the audit's P0 fixes)

The audit's fix is "one policy layer, default-deny" (README §3.1, P0 #5). To go beyond parity:

1. **Annotate, then enforce, then generate.** Put `{resource, action}` metadata on every oRPC contract procedure (the contract builder `standard.zod` in `@repo/orpc-utils` is the single place). A middleware reads it; a build-time test fails if any procedure lacks metadata or an explicit `publicAccess()`. From the same metadata generate the permission matrix page in `apps/doc` and the per-controller "403 for viewer/user" tests the audit asks for (`auth.md` §4.4). This removes the class of bug "new endpoint ships with only `requireAuth()`".
2. **Wire the engine with a safe migration path.** Seed `role_rules` from `packages/auth/src/permissions/config.ts` role statements so empty rules (= deny, `permission-engine.ts:106`) cannot lock out the install; run **shadow mode** first (evaluate the engine next to the legacy check, log disagreements, still enforce legacy) for a release; then flip. Make `loadRoleRules` fail loud, not `catch(() => [])` (`permission.service.ts:34`); add a TTL cache plus event-based invalidation.
3. **Add the missing second layer into the engine context.** The engine is keyed by platform role only (`permissions.ts` header). Project roles (owner/maintainer/deployer/viewer) are in the project service. Pass project membership as pre-resolved vars in `EngineContext` (the engine already supports pre-resolved vars, `permission-engine.ts:86`) so one decision combines platform role, project role, and ownership. Do not build the org layer unless the operator decides to (decision #3 in README §6); the design above does not require it.
4. **SQL pushdown on every list endpoint** using `compileDFilter` so list/count/search queries never fetch rows the caller cannot see (fixes the "any user can list any project's deployments and subscribe to streams" finding, `deployments.md:106`). Stream endpoints get a per-event filter via `matchFilter`.
5. **Explainability and simulation.** `permissions.explain(actor, action, target)` returns the matching rules and reason (the engine returns `reason` strings already). UI: "effective permissions" for a user, "what would change if I edit this rule" diff, and a policy test file (table-driven fixtures) in the repo run by CI.
6. **Role hierarchy and delegation rules** in one place (admin cannot grant or act on >= own role: `auth.md` headline 6), expressed as guardrail deny rules, not scattered hooks in Better Auth plus the identity service.
7. **Make privilege changes take effect immediately.** Revoke sessions and API keys on ban/role change in both Better Auth and the identity service (`auth.md` §3.12); bypass the 5-minute cookie cache for any decision tagged `sensitive` in metadata.
8. **Actor propagation between services.** Replace raw cookie forwarding with a short-lived signed actor claim (signed with the BFF's member key through the agent socket, verified by services against the roster) so services authorise the *actor*, not the BFF (audit P1 #23). The claim carries `sub`, role snapshot, session id, approval refs; it doubles as the audit actor.
9. **Scoped tokens that compile to rules.** API keys carry metadata that maps to `ResourceRule[]` (deploy-only CI token limited to one project/environment), enforced by the same engine, never by ad-hoc scope checks.
10. **Signed policy bundle (principle fit).** `role_rules` is a Postgres table, i.e. a source of truth that a DB intruder can edit. Keep PG as the editing store but publish the bundle hash in the roster (I-01, I-02) and have services verify; a tampered table fails closed with an alert. This resolves the tension with "no central source of truth" without moving rules into gossip.
11. **Ciphertext integrity details in the codec** (cheap): bind AAD = `table.column.rowId` so ciphertexts cannot be swapped between rows; derive the data key once with HKDF instead of `scryptSync` per read (`ops.md` §5); key id prefix for rotation.
12. **Setup claim bound to a passkey.** Replace default-admin/password bootstrap with a one-time claim token printed in the operator's terminal (consumed at first superadmin creation, audit P0 #4) and enrol a passkey immediately, then show the recovery kit (I-08). The identity is key-based end to end, matching the mesh philosophy.
13. **Test the rules, not the mocks.** In-memory Better Auth integration tests plus the permission matrix test from item 1 (`auth.md` §5 notes current auth specs mock all plugins).

---

## 4. Principle check

| Principle | How the top 8 comply |
|---|---|
| Mesh-first, peer-equal | Signed manifests, grants and anchors live in the roster; any member verifies and acts; no coordinator for upgrade, backup, or approvals |
| No central source of truth | Postgres rules/logs are *caches with signatures* anchored in the roster; recovery works from any surviving member (I-07) |
| No inbound ports | Upgrade is pull-by-agent; backup shards move over the mesh; exposure attestation (I-17) verifies the invariant |
| Pluggable | Backup destinations, verifier tools (cosign, trivy, grype), edge presets, rotation consumers are registries like the edge providers |

Honest caveats: (1) the roster's self-asserted timestamps (`roster.ts:21-24`) bound what "tamper-evident" can claim: ordering is only as good as witnesses; (2) logical backups give snapshot RPO, not PITR; (3) several competitor statements outside our bench reports are tagged [mem] and must be re-verified before marketing use; (4) nothing here was run, estimates are from reading code and audit docs.
