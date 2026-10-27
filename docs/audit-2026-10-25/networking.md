# Networking audit (mesh, edge, lanes, domains, DNS, TLS, Traefik)

Scope: `apps/mesh-agent`, `packages/infrastructure/mesh-network`, `apps/api/src/core/modules/{edge,reachability,mesh-agent,platform-ingress,traefik,domain}`, `apps/api/src/modules/{domain,reachability,providers}`, `packages/nest/reachability`, `apps/web/src/app/dashboard/network`, `infra/docker`, plus the docs. All paths are relative to `/home/sebille/Bureau/projects/tests/deployer/v3`.

Method: I read the source. Statuses come from what the code executes, not from docs or test names. I did not run anything; I only read the cached `.turbo` test logs. Those show mesh-agent 25/25, mesh-network 63/63 and nest-reachability 23/23 passing.

Legend: REAL = implemented and wired end to end. PARTIAL = works with a gap or a wrong default. STUB = fake, or a TODO that returns a fixed answer. MISSING = no code.

---

## 1. Feature inventory

### 1.1 Mesh (WireGuard, roster, agent)

| Feature | Status | Evidence |
|---|---|---|
| Identity: ed25519 signing key and x25519 WireGuard key, derived member id and cluster id | REAL | `mesh-network/src/identity.ts`; persisted 0600 and atomically in `mesh-agent/src/state-store.ts` |
| Mesh address derived from the WG key (/16 inside 100.88.0.0/16), collision losers re-derive with a salt | REAL | `address.ts:99-108`; `roster.ts:662-680`; `agent.ts:340-344` |
| Signed roster CRDT: genesis, admission chain, members, revocations, settings. The merge is a total order per key, with filter-before-compare | REAL | `roster.ts:204-399`; 21 unit tests, including a 4-node gossip convergence test in `agent.spec.ts` |
| Admission by any member, idempotent re-admit, address-mismatch and collision checks | REAL | `roster.ts:509-560` |
| Revoke: signed, cuts off authority from the revocation moment, any active member can revoke any member | REAL | `roster.ts:611-623`, `162-184`. No quorum, by design |
| Settings (LWW by version, then `setAt`, then `setBy`) used as the cluster KV | REAL | `roster.ts:626-639`; API side `core/modules/mesh-agent/cluster-settings.service.ts` |
| Real WireGuard dataplane: `ip link add`, `wg syncconf`, `wg show dump` | REAL | `wireguard-driver.ts:33-75`. `apps/mesh-agent/scripts/e2e-netns.sh` exercises real WG on a docker bridge: handshake, admission via a non-founder, founder loss |
| Observe-only dataplane (dev) | REAL | `wireguard-driver.ts:83-96` |
| Peer endpoint ranking: same /24 LAN, declared, reflexive, other LAN. A fresh handshake wins; 20 s window per candidate | REAL | `links.ts:98-173` |
| Reflexive discovery via STUN | PARTIAL | `endpoint-discovery.ts:49-85`. It queries from a random ephemeral UDP socket, not from the WG port, so the candidate port is only an assumption that the NAT preserves the port. IPv4 only. Needs external STUN (Cloudflare, Google) |
| Declared endpoint candidates (`MESH_AGENT_DECLARED_ADDRESSES`) | PARTIAL, effectively unwired | The agent honours the variable (`agent.ts:184`, `config.ts`). `meshAgentContainerEnv` can emit it, but no caller passes `declaredAddresses`: setup (`mesh-agent-launcher.service.ts:50-56`) and the API (`mesh-agent-bootstrap.service.ts:51-54`) pass only `dataplane`. The "declared public address" in the UI (`node_network_config`) never reaches the agent |
| Relay for pairs where every candidate fails | STUB | `links.ts:176-188`: `planRelay` returns `relay-transport-not-implemented` and nothing calls it. The planner emits `path:"relay"` with `endpoint:null` and then cycles. A peer on `relay` is never gossiped to (`agent.ts:411` only gossips to `direct` peers) |
| Gossip (push-pull full roster, fanout 3, mesh-address-only listener, HTTP over WG) | REAL | `agent.ts:409-425`, `main.ts:69-85`, `gossip-client.ts` |
| Control API on a unix socket (status, cluster, join-request, admissions, join, settings, labels, revocations, leave, gossip) | REAL | `control-server.ts:59-95` |
| `leave` (graceful departure) | PARTIAL, no caller | The route exists (`control-server.ts:87`) but `MeshAgentHttpClient` has no `leave()` and no API or UI uses it. A member in state `left` never returns to `active` |
| Agent upgrade and supervision | PARTIAL | Created by setup or by `MeshAgentBootstrapService.ensure()` once at boot, with `restart: unless-stopped` (`agent-container.ts:62-72`). It is replaced only when the image string or env differs. No ongoing health supervisor, and the image defaults to `deployer-mesh-agent:latest` |
| Operator laptop as a mesh member (`kind:"operator"`, `deployer mesh connect`) | MISSING | Only the schema enum exists (`schemas.ts`). There is no CLI and no agent packaging for laptops |
| Mesh-level DNS (names for the `.internal` private domain) | MISSING | No resolver anywhere in the agent or API. See 1.3 |
| Key rotation, WG preshared keys, roster GC, IPv6 | MISSING | |

### 1.2 Edge, public lane, ingress

| Feature | Status | Evidence |
|---|---|---|
| `EdgeProvider` plugin contract, registry, option validation, inbound-port acknowledgement re-checked on every read | REAL | `core/modules/edge/edge-provider.ts`, `edge-provider.registry.ts:63-105`, spec present |
| `direct` provider (publishes :80 and :443 on every node, A records to declared public IPs, ACME) | PARTIAL | `edge/providers/direct.edge-provider.ts`. It works single-node. See the risks on ACME in §3 |
| `cloudflare-tunnel` provider: one tunnel per stack, wildcard ingress rule, token in replicated state, adopt-by-name, replicated connector | REAL | `modules/providers/edge/cloudflare-tunnel/cloudflare-tunnel.edge-provider.ts`, `cloudflare-tunnel.service.ts` (handles the 1056 catch-all rule). Specs exist. Not verified against a live Cloudflare account |
| Connector supervisor (replicated swarm service, max one replica per node, no ports, removed when the lane changes) | REAL | `supervisors/platform/edge-connector-supervisor.service.ts` |
| Traefik as a global swarm service, HTTP-provider polling every 5 s, no docker socket, derived HMAC token | REAL | `supervisors/platform/traefik-supervisor.service.ts:224-300`; `traefik/controllers/traefik-ingress-config.controller.ts`; `platform-ingress/services/ingress-provider-token.ts` |
| Lane config builder (one router per route and lane, entrypoint isolation, `private` routes have no public router) | REAL | `platform-ingress/services/lane-traefik-config.ts`, tested |
| Doors (nginx containers bound to loopback, mesh address or LAN address, hash-based convergence, rescue lane, port-holder wait) | REAL | `mesh-agent/src/doors/*`; `node.doors` published from `traefik-supervisor.service.ts:468` |
| Lanes as a replicated cluster setting (`ingress.lanes`), edit and teardown restricted to superAdmin/admin | REAL | `ingress-lanes.service.ts`; `reachability.controller.ts:166-188` |
| Switching edge (provision new, write lanes, tear down old; DNS cleanup of retired names) | REAL | `modules/reachability/services/ingress-edge.service.ts:107-157` |
| Provider-agnostic Network UI (Overview, Mesh, Ingress & edge, DNS, Domains) | REAL | `apps/web/src/app/dashboard/network/**`. The edge form is rendered from `edge.providers` descriptors. Only one UI test file (`network.states.test.tsx`) |
| Legacy single-node `MANAGED_TRAEFIK_ENABLED=true` profile | STALE | `infra/docker/compose/common/traefik/docker-compose.config.yml:19-22` runs Traefik with the docker and file providers and only a `web` entrypoint. It has no `local/private/public` entrypoints and no HTTP provider, so none of the lane routing applies. It is used by `docker-compose.dev.yml` and `docker-compose.services.dev.yml` |
| Alternative public edges (frp or WG relay on an operator VPS, etc.) | MISSING | Roadmap item only |

### 1.3 Lanes (local, private, public)

| Lane | Status | Notes |
|---|---|---|
| local (`*.deployer.localhost` via loopback door) | REAL | RFC 6761 names, no DNS needed. Rescue fallback to the API and web containers when Traefik returns 502/503/504 |
| private (door on the mesh address, optional LAN door) | PARTIAL | The door and the Traefik entrypoint are real. Name resolution is not. The default domain is `deployer.internal`, and `.internal`, `.local`, `.lan`, `.home.arpa` and `.localhost` are deliberately never published (`lane-dns-plan.ts:28`). The doc says "operator resolves it on the mesh", but there is no resolver. A real domain gets public A records pointing at 100.88.x mesh IPs. Callers must be mesh members, and laptops cannot join (no CLI), so in practice it works only from nodes |
| public (via an edge provider) | REAL for the tunnel edge on a single domain. PARTIAL otherwise | See §3 |

### 1.4 Domains, DNS, TLS

| Feature | Status | Evidence |
|---|---|---|
| Lane DNS plane (wildcard `*.<domain>` per edge, private A records, convergence every 10 min, `manual` fallback with instructions) | REAL | `modules/reachability/services/edge-dns.service.ts`, `lane-dns-plan.ts`, `ingress-edge.service.ts:72-76,180-195` |
| DNS providers | PARTIAL | Only Cloudflare is implemented. The UI lists Route53 and Google DNS as options (`provider-domain-form.tsx`), but the registry has only the Cloudflare adapter |
| Project domains CRUD (add, list, update, remove) | REAL | `modules/domain/**` |
| Domain ownership verification: manual "Verify" button | BROKEN | `domain-project.service.ts:176` calls `assertProjectAccess(input.projectId, "verify")`, passing the literal string `"verify"` as the user id. The controller never passes the real user (`project-domain.controller.ts:67-74`). `ProjectAccessService` then finds no owner or collaborator and throws Forbidden for everyone. The same bug is in `apps/api-services/services/project/src/modules/domain/services/domain-project.service.ts:176` |
| Verification instructions shown to the user | BROKEN (inconsistent) | `addProjectDomain` returns record `_deployer-challenge` with value `deployer-verification=<token>` (CNAME: `_deployer.<d>` pointing to `verify.deployer.<token>.acme.`) (`domain-project.service.ts:61-70`). The verifier checks TXT at `_deployer-verify.<domain>` for a value equal to the bare token, or a CNAME to `verify-<token>.deployer.io` (`domain-verification.service.ts:94,234`). They never match. The Domains table shows the correct TXT name (`_deployer-verify.<domain>`) and the bare token, so the manual flow is right only if the user reads the table. The "Via a DNS provider" form auto-creates the wrong record (`_deployer-challenge`) with `result.verificationInstructions`, so it can never verify. The CNAME method is wrong everywhere: the table shows name `_deployer-verify` (no domain) and the value `verify-<token>.deployer.io` points at a domain the platform does not own |
| Auto-verification | BROKEN | Hourly `setInterval` (`domain-verification.service.ts:24-27`; the `@Cron` is commented out). It only selects `pending` rows (`:259`), but the first failed attempt sets `failed` (`:163`), and `failed` rows are never retried. `retryVerification`, `getPendingDomainsCount`, `getVerificationInstructions` and `generateVerificationToken` are dead code |
| Verified status gates routing | MISSING | `findServiceUrlRows` joins `project_domains` with no verified filter (`service-domain-mapping.repository.ts:273-288`). `PlatformRoutesSource` and `serviceConfigRoutes` never check verification. `addServiceDomain` does not require `verificationStatus === "verified"` or that the service belongs to the project (`domain-service.service.ts:67-110`). The doc claim "verified custom domains" is false |
| Service to domain mapping (subdomain and basePath conflicts, primary flag) | PARTIAL | CRUD works. `basePath` and a non-primary mapping's host are not applied by the lane router: it routes one primary host per deployment (via `deployment.domainUrl`), and `ruleSuffix` PathPrefix is never generated from mappings |
| Traefik route sync from mappings (`DomainRoutingService.syncServiceRoutes`) | PARTIAL, mostly legacy | It writes `traefik_service_configs` and `traefik_domain_routes` rows with entrypoints `web`/`websecure` (`domain-routing.service.ts:208`), which do not exist in the lane ingress. The live ingress reads only `config.fullDomain` (`traefik-ingress-config.service.ts:219-245`), which falls back to the target `http://<host>:<port>` (the public name itself, a loop) when no target exists. Per-route rows are ignored |
| SSL certificate per mapping (`provisionTlsCertificate`) | STUB | `domain-routing.service.ts:264-300` only inserts a DB row. Nothing requests, uploads or renews a cert. `sslProvider:"custom"` has no cert upload path, and `sslEnabled` is not honoured per host |
| ACME / Let's Encrypt | PARTIAL | Traefik ACME exists only for the `direct` edge (`traefik-supervisor.service.ts:249-257`): HTTP-01, per-node `acme.json`, per-host certs. No wildcard or DNS-01. The email default is the fake `admin@example.com` (`env index.ts:255`), which Let's Encrypt rejects |
| Wildcard cert, custom certificates, cert expiry monitoring | MISSING | |
| Preview subdomains | PARTIAL | Host is `<previewName>.<primary domain>` (`preview-provisioning.service.ts:79`). A DNS CNAME or A record is created through `findFirstActiveAccount` (the first account of any provider, then a zone check). The route comes from `preview_environments`, but the row is attached to `findLatestDeploymentByService` (`:240`), i.e. the service's latest deployment, not necessarily the PR build, and only when `prNumber != null`. TTL cleanup is real (`preview-ttl-cleanup.service.ts`). Previews are not part of the Cloudflare tunnel wildcard unless the preview domain is under the lane domain |
| Custom domains on the public lane | PARTIAL | Hosts are added as public hosts and, with `direct` + ACME, get `public-tls` routers. With the tunnel edge only `*.<lane domain>` reaches the tunnel (one wildcard ingress rule). A custom domain on another zone is not added to the tunnel ingress, and no per-domain CNAME or A record is created. The operator must do both manually. `domain-gate` only checks that the edge is provisioned |
| Node public address declaration and verification | PARTIAL | `verifyPublicAddress` (`reachability.service.ts:210`) only checks that something answers `/mesh/ping` or `/health` over http or https. It does not prove the address is this node (no identity token). When editing another node's address it probes from the current node |
| Reachability legacy endpoints (`getConfig`, `updateConfig`) | STUB | `updateConfig` ignores its input and re-probes (`reachability.controller.ts:75-80`). The hook `useUpdateReachabilityConfig` is unused |
| Public access point relay and SSE | REAL (legacy shape) | `public-access-point.service.ts`; superseded in part by the lane model, and still used by previews |
| Health of the mesh | PARTIAL | Link path, endpoint, last handshake, `lastError`, `lastGossipAt`, doors state and tunnel connection count are surfaced in the UI (`mesh/page.tsx`, `mesh-members-table.tsx`). No rx/tx or latency, no history, no alerts or notifications, and no supervisor for the agent |

---

## 2. What works end to end

- The mesh control plane works. Found a cluster, admit a node through any member, gossip roster and settings, revoke, derive addresses, plan links, and apply real `wg syncconf`. The netns e2e script covers this on a docker bridge. Loss of the founder is tolerated.
- Doors and the ingress run together: setting lanes, publishing `node.doors` into the roster, every node's agent building loopback, mesh and optional LAN nginx doors, and Traefik on every node polling the API for a lane-isolated config.
- Public lane via Cloudflare Tunnel: provision tunnel, set wildcard ingress, connector replicas as a swarm service, wildcard CNAME through the DNS plane, status and health in the UI, teardown. Treat as working but unverified live, since the specs mock Cloudflare.
- Public lane via `direct` on one node with a declared public IP: A record, published ports, Traefik ACME HTTP-01 per host.
- Route precedence and the platform console routes (api, web, setup, rescue) with the setup-host redirect.
- Domain CRUD, conflict checks and subdomain mapping data. Automatic DNS verification works only for a TXT record named exactly `_deployer-verify.<domain>` whose value is the bare token, and only through the hourly job on the first attempt.

---

## 3. What is broken or risky

Ordered by severity.

**Security**
1. Any authenticated user can manage DNS and Cloudflare. In `modules/providers/dns/cloudflare/controllers/cloudflare.controller.ts`, create and delete record (`:152,180`), list, create and delete tunnel, and `getTunnelToken` (`:248-253`) use `requireAuth()` only. In `modules/providers/dns/shared/controllers/dns-providers.controller.ts` the CRUD of provider accounts (API tokens) uses `requireAuth()` only. A viewer can read the stack tunnel token, delete the tunnel, or edit the zone. Only the lane and edge changes use `requirePlatformRole(["superAdmin","admin"])`. The same code is duplicated under `apps/api-services/services/fleet`.
2. Unverified domain takeover or host hijack. Routing never checks `verificationStatus`, and `addServiceDomain` neither requires verification nor that the service belongs to the project. A project owner can register the platform's own public domain plus subdomain `api` or `web` and compete with the platform router for the same `Host()` rule. Equal-length rules have undefined precedence, so the console route is not protected.
3. SSRF for any logged-in user. `reachabilityContract.check` (`reachability.controller.ts:38-66`), `checkDomain` (`reachability.service.ts:278-380`) and `probePeer` fetch arbitrary URLs and hosts with no private-range filtering. `updateNodeNetworkConfig`, `getPublicIp` and `checkDomainGate` also need only `requireAuth()`; any user can rewrite a node's public address (the `direct` edge then publishes it into A records).
4. Secrets replicate in plaintext. The Cloudflare tunnel token lives in `edge.cloudflare-tunnel` in the roster: gossiped to and stored on every node (`roster.json`), and visible in the swarm service env of the connector. Revocation does not rotate it, so a revoked or stolen node keeps tunnel and ACME credentials. Out of scope but spotted: `meshContract.trustKeyringSecrets` (`mesh.controller.ts:310`) is `requireAuth()` only.
5. Roster trust model. Any active member can revoke any member, including the genesis member, with no quorum. Timestamps are self-asserted, and a stolen key can backdate. `docs/edge-mesh-architecture.md` is honest about this. Gossip over plain HTTP relies on WG source-address binding, which is fine.
6. The console defaults to `consoleVisibility: public`: once a public lane exists, the API, web and `setup.` hosts are internet-visible. The Traefik config endpoint is token-protected, but `api.<domain>` exposes it.

**Functional**
7. Domain verification is unusable as shipped: Forbidden on every manual "Verify"; instructions from the API do not match the verifier; the provider form creates the wrong TXT; the CNAME method is wrong everywhere; failed rows are never retried by auto-verify (see §1.4).
8. Declared addresses never reach the agent. A node with a public IP only advertises LAN plus a STUN-learned address. Behind a port-restricted or symmetric NAT the reflexive port is wrong because STUN is asked from a different socket. When both sides are NATed there is no relay. `links.ts` plans `path:"relay"` with `endpoint:null`, and relayed members are excluded from gossip, so they can never converge.
9. Joiners that collide on address get no retry. `admitMember` throws `address-collision` ("retry with the next salt"), but `MeshAdmissionService.admit` swallows it and returns null (`mesh-admission.service.ts:~46-50`), and the join request always sends `addressSalt ?? 0` (`agent.ts:228`). The loser is silently "not admitted to the mesh". (Probability is low at /16 but real, and there is no salt-retry loop anywhere.)
10. `direct` edge with several nodes: A records for every node, per-node `acme.json`, HTTP-01 per host. A Let's Encrypt validation request can land on a node that does not hold the token, so issuance fails. There is no wildcard or DNS-01, so each app and preview is a separate cert (rate limits). The default ACME email is `admin@example.com`. DNS has no health-aware removal of a down node.
11. Legacy domain routing is disconnected from the live ingress: `DomainRoutingService` writes `web`/`websecure` routes that do not exist; `basePath`, non-primary mappings and per-mapping SSL settings have no effect; the `serviceConfigRoutes` fallback can route a host to itself.
12. Previews: the preview route is attached to the latest deployment of the service, not the PR build; DNS uses the first active account of any provider; the preview hostname is not covered by a tunnel wildcard unless it is under the lane domain.
13. Private lane DNS and the same-domain trap: `.internal` names have no resolver; the schema allows `private.domain === public.domain`, so the public CNAME and private A plans fight on every reconcile (`EdgeDnsService.reconcileOne` deletes the other's records).
14. `MANAGED_TRAEFIK_ENABLED=true` (the default `docker-compose.dev.yml` profile) runs the legacy docker/file-provider Traefik, which cannot serve the lane routing. The doors and ingress described in the docs are only exercised by the supervised, mesh-6 and prod profiles. The API's `MESH_AGENT_DATAPLANE` env defaults to `observe` (`env index.ts:289`), so production without the compose override gets no real WireGuard.
15. Concurrency: settings are last-writer-wins on `version+1`. Two nodes writing the same key concurrently lose one write. Today only the Traefik supervisor writes `node.doors` and the lanes writer is a single admin action, so the risk is latent.
16. A revoked member is not removed from Swarm, the `node_network_config` row or the DNS A records; its own agent keeps its interface up (the tick throws before applying) and keeps its old credentials.
17. Two copies of the networking code (`apps/api/src/core/modules/*` and `apps/api-services/shared` + `services/fleet|project`) diverge only by import style today. Every bug above exists twice, and fixes must be applied in both.
18. Stale docs: `docs/edge-ingress-architecture.md` still describes the old provider model (`local`/`wireguard`/`direct` modes, `LocalIngressForwarderService`); `FULL_MESH_HISTORY.md` and `docs/mesh-todo-implementation-plan.md` describe the application-level data mesh, not the WireGuard network; `domain-system-deep-*.md` live in `docs/`, not the repo root, and are dated 2026-08.
19. Tests: no tests for the verification service, `DomainProjectService`, `DomainRoutingService`, `DirectEdgeProvider`, preview provisioning, the reachability controller, or STUN or NAT behaviour. No e2e of real NAT traversal; the netns script uses a flat bridge.
20. Images: door image `nginx:alpine` and mesh agent `:latest` are unpinned. The agent needs the docker socket plus host network plus NET_ADMIN (high privilege, justified in comments).

---

## 4. Required for production (ordered)

1. Lock down authorization. Put `requirePlatformRole(["superAdmin","admin"])` on all DNS provider CRUD, Cloudflare record, tunnel and token endpoints, `updateNodeNetworkConfig`, `trustKeyringSecrets`/`Rotate`. Add private-range and loopback blocking and an allowlist to the probe and check endpoints. Stop returning the tunnel token to any client.
2. Fix domain ownership end to end. Pass the real `requesterId` in `verifyProjectDomain`. Generate verification instructions from `DomainVerificationService` (one place) and use them in the response, the provider form and the table. Remove the `deployer.io` CNAME scheme or own that domain. Retry `failed` rows (backoff, `lastVerificationAttempt`), and only mark `failed` for a definitive negative. Enforce `verified` in `addServiceDomain`, `resolveServiceUrls`, `PlatformRoutesSource` and `serviceConfigRoutes`. Enforce that the service belongs to the project, and global uniqueness of verified domains across projects. Reserve the platform hosts (`api.`, `web.`, `setup.`) so no mapping can claim them.
3. Feed declared public addresses into the agent. Wire `node_network_config.publicAddress` (or an env) through `meshAgentContainerEnv`, and recreate the agent when it changes.
4. Decide on relay. Either implement `planRelay` (WS or UDP bridge over a third member) or state in the UI and docs that two NATed-both-sides nodes cannot link, and make "relay" visible as an error state in health. At minimum, bind the STUN query to the WG port, or document the port-preserving assumption.
5. Make TLS correct for multi-node `direct`: use DNS-01 through the existing DNS providers (wildcard), or shared ACME storage, or sticky challenge routing. Make `DEPLOYER_TRAEFIK_ACME_EMAIL` required with no fake default. Implement or remove `provisionTlsCertificate`, and the `custom` provider with cert upload.
6. Make custom domains work on the tunnel edge: per-domain ingress hostname rules in the Cloudflare tunnel plus the CNAME, or a documented requirement. Give each custom domain its own DNS record plan (the lane DNS plane only handles `*.<lane domain>`).
7. Delete the legacy `DomainRoutingService` route and cert writers or rebuild them on lane routes; add `basePath` and additional hosts to `buildLaneTraefikConfig` (`ruleSuffix`, `publicHosts`). Remove the `web`/`websecure` and file-provider Traefik profile, or migrate dev compose to the HTTP-provider ingress.
8. Fix the previews: attach the preview row to the PR deployment, pick the DNS account by zone ownership, include previews in the tunnel wildcard.
9. Production defaults: `MESH_AGENT_DATAPLANE` required in prod (fail on `observe`), pin door and agent image tags, agent health supervisor with restart and image-upgrade path, add UDP 51820 to the firewall docs and preflight.
10. Credential hygiene: encrypt secrets in `edge.*` state or keep them off the roster; rotate the tunnel token on member revocation; post-revoke cleanup (Swarm node removal, DNS A records, `node_network_config`).
11. Add tests: verification (unit and e2e DNS), domain-gate and routing integration, direct provider, preview provisioning, controller authorization matrix, a NAT e2e (iptables netns with cone and symmetric NAT) for STUN and link planning.
12. De-duplicate `apps/api` and `apps/api-services` networking code and delete the stale docs or rewrite them to the lane model.

---

## 5. Recommended enhancements

- Mesh: expose rx/tx bytes, handshake age and RTT per link (data already in `wg show dump`). Record link-state history and add health notifications. Add a roster size and tombstone GC. Support IPv6 candidates and STUN. Add an optional operator-supplied relay endpoint (a peer with a public IP acts as relay).
- A salt-retry loop on address collision during join, plus a "Retry admission" action in the UI. A "leave" action and a re-activate path for `left` members.
- Settings: switch from LWW to per-key CAS or version checks, with a clear error on conflict, for `ingress.lanes`.
- Validation: reject `private.domain === public.domain`, and reject a public domain that overlaps the platform's reserved hosts. Validate `consoleVisibility:"public"` with a confirmation when turning on a public lane (the console, API and setup become internet-visible).
- Edge UI: a dry-run "preview what Cloudflare will change". Show connector replica placement and last-seen per connector. DNS records: show drift (planned vs found) rather than only `synced/manual/error`.
- Reachability service: replace `getPublicIp` external calls with STUN already available in the agent. Remove `getConfig`/`updateConfig`, `useReachabilityConfig` and the other dead hooks.
- Door and ingress: expose per-lane request metrics and an end-to-end "probe this lane" button.
- Remove the dead helpers in `domain-verification.service.ts`.

## 6. Recommended new features

- Mesh DNS: a tiny resolver in the agent (or a CoreDNS door) answering `*.<private domain>` with the member mesh addresses, so the `.internal` private lane works with no public DNS.
- `deployer mesh connect`: laptop agent as `kind:"operator"`, so the private lane and the console are reachable with no inbound port or public domain.
- Relay-over-session (UDP-over-WebSocket) plus an optional operator-owned relay edge provider (frp or WG relay), keeping the "no node opens a port" principle.
- More edge providers as plugins: Cloudflare-less tunnel (frp, Tailscale funnel, ngrok), and a DNS-01 wildcard cert provider reusing DNS accounts.
- Certificate management UI: cert inventory, expiry alerts, custom cert upload with a secret store, and an ACME shared store.
- Domain lifecycle: automatic re-verification, domain transfer between projects, wildcard custom domains, apex and redirect rules (www to apex), HTTP-to-HTTPS and per-route middlewares (rate limit, basic auth, IP allowlist) exposed in the UI.
- Network policy: per-service visibility editing in the UI (`services.network.visibility`), per-member ACLs on the private lane, and an audit log of revocations and edge changes.
- Mesh health and alerting integration with the existing push notifications, plus a "mesh doctor" (checks UDP 51820, kernel module, STUN reachability, clock skew).
- Multi-edge and failover: more than one public edge at once, or DNS health checks to drop a down `direct` node.
