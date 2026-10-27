# NETWORKING roadmap
> Owner prefix: NET · Sources: networking.md, ideas-mesh.md, journeys.md (J3 + quick wins), projects-services.md (DNS/domain rows), parity.md (DNS, Route53/Google, wildcard, Traefik admin), bench-coolify.md, bench-dokploy-dockhand.md, bench-market.md (section G + differentiators) · Last verified: 2026-10-26

## Summary
The mesh control plane (signed roster CRDT, WireGuard dataplane, doors, lanes, Cloudflare tunnel edge) is real and well tested. The network is not yet safe or complete for real use. Three families dominate: (1) authorization/SSRF holes on DNS, Cloudflare, tunnel-token and reachability endpoints (any logged-in user can read the tunnel token or rewrite DNS); (2) the custom-domain flow is broken end to end (Verify always Forbidden, instructions never match the verifier, `failed` rows never retried, verification not enforced at routing, free-text `customDomains` bypass, hosts frozen at deploy time); (3) claims not yet true: relay is a stub (NATed-both-sides nodes never converge), declared addresses never reach the agent, `.internal` has no resolver, multi-node `direct` ACME is unreliable, the default ACME email is fake.
Spot-verified in code this session: Verify passes literal `"verify"` as requester (both `apps/api` and `apps/api-services` copies, line 176); Cloudflare controller is `requireAuth()` only; `planRelay` returns `relay-transport-not-implemented`; ACME email default is `admin@example.com` (`packages/config/env/src/index.ts:255`); the PR webhook still uses `full_name` as service id.
The mesh moat (ideas-mesh.md C1..C21) is tracked as NET-072..NET-093 with the recommended build order: hygiene -> C1 relay -> C2 mesh DNS -> C3 operator member (+C21 HLC) -> C9 sealed secrets -> C10 audit trail -> C4 P2P images -> C12 gateway edge (+C5 failover) -> C11 microsegmentation; island mode (C6) after C1.
> Coverage pass: 2026-10-26 — 3 items added, 18 deps resolved

Counts are in the Totals section at the end of this file (106 items). Every bug exists twice (monolith `apps/api/src/core/modules/*` and `apps/api-services/shared` + `services/{fleet,project}`): each FIX item must land in both trees until ARCH deletes the monolith (NET-052).

## Items

### Authorization, SSRF and secret handling (security first)
- [ ] `NET-001` **Role-gate every DNS provider, Cloudflare record, tunnel and token procedure** · FIX · P0 · M · Deps: `SEC-001`
  - Why/Problem: `modules/providers/dns/cloudflare/controllers/cloudflare.controller.ts` (create/delete record `:152,180`, list/create/delete tunnel, `getTunnelToken` `:248-253`) and `modules/providers/dns/shared/controllers/dns-providers.controller.ts` (CRUD of provider accounts holding API tokens) use `requireAuth()` only (verified: every handler at lines 43..251 is `requireAuth()`). A viewer can read the tunnel token, delete the tunnel or edit the zone. Duplicated under `apps/api-services/services/fleet`.
  - Do: `requirePlatformRole(["superAdmin","admin"])` (or the SUB-A policy) on all of them in both trees; add per-account ownership/visibility if accounts become per-user; never expose raw provider tokens on read (mask).
  - Done when: a viewer/developer gets 403 on every DNS/Cloudflare/tunnel/provider-account procedure; controller authorization matrix test (NET-098) is green.
  - Status: todo · Verified-in-code: yes · Source: networking.md#3.1,#4.1; journeys.md#J3 W3.10
  - See also: `SEC-002`

- [ ] `NET-002` **Stop returning the Cloudflare tunnel token to any client** · FIX · P0 · S · Deps: `NET-001`
  - Why/Problem: `getTunnelToken` returns the connector token to the web; with NET-001 only admins, but the token should not round-trip to browsers at all. Also visible in the swarm env of the connector service.
  - Do: remove/replace `getTunnelToken` by a server-side-only path (connector supervisor reads from the secret store); UI shows "token set / rotate" only; use Swarm secret instead of plain env for the connector.
  - Done when: no contract output field contains the token; `docker service inspect` of the connector shows no clear token.
  - Status: todo · Verified-in-code: partial · Source: networking.md#3.1,#3.4,#4.1
  - See also: `SEC-021`, `SEC-022`

- [ ] `NET-003` **Role-gate node network config, public-IP/domain-gate and keyring-secret endpoints** · FIX · P0 · S · Deps: `SEC-001`
  - Why/Problem: `updateNodeNetworkConfig`, `getPublicIp`, `checkDomainGate` need only `requireAuth()`; any user can rewrite a node's public address and the `direct` edge then publishes it into A records. `meshContract.trustKeyringSecrets` (`mesh.controller.ts:310`) and `Rotate` are `requireAuth()` only.
  - Do: platform admin role on `updateNodeNetworkConfig`, `trustKeyringSecrets`/`Rotate`; scope `getPublicIp`/`checkDomainGate` reads appropriately.
  - Done when: non-admin gets 403; address changes are recorded (NET-071).
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.3,#3.4,#4.1
  - See also: `SEC-002`

- [ ] `NET-004` **Block SSRF on `reachability.check`, `checkDomain` and `probePeer`** · FIX · P0 · M · Deps: `NET-003`
  - Why/Problem: `reachability.controller.ts:38-66`, `reachability.service.ts:278-380` fetch arbitrary URLs/hosts for any user with no private-range filtering (SSRF primitive into the VPS and docker network).
  - Do: resolve then block loopback, link-local (169.254.0.0/16 incl. cloud metadata), RFC1918, mesh range 100.88.0.0/16 (unless explicitly a node probe), ULA/IPv6; pin resolved IP to avoid DNS rebinding; protocol allowlist, timeouts, response size cap; role-gate.
  - Done when: unit tests for every blocked range and a DNS-rebinding case pass; probing `http://169.254.169.254` returns an error.
  - Status: partial — the live-tier callers are MIGRATED (2026-10-27): `reachability.check`, node public-URL probe (fleet controller), `checkDomain`/`getPublicIp`/`verifyPublicAddress`/`checkMeshUrlReachability` (shared `ReachabilityService`), `probeAddress`/`probePeer` (now take a REQUIRED injected `http`, so forgetting the policy is a type error), post-deploy domain probe (runtime) and setup `remoteAuth` (bff) all go through `EgressService` over `SafeHttp`: metadata always refused, loopback/link-local refused for operator targets, private ranges refused for user-supplied domains in production (`DEPLOYER_ALLOW_PRIVATE_PROBES`, default false in prod / true elsewhere), no redirects, size and time caps, generic error messages. STILL OPEN: (1) role-gate on `reachability.check` (`NET-003`; any authenticated user can still call it); (2) mesh range `100.88.0.0/16` is allowed for operator targets, not separately classified; (3) frozen monolith `apps/api/.../reachability.service.ts` still calls `probeAddress`/`probePeer` WITHOUT `http` and no longer compiles against the package (closed by deleting `apps/api`); (4) internal call sites (swarm-route-verifier, docker health check, ownership resolver, platform-health, mesh peer wrappers) are a separate follow-up — updated 2026-10-27 · Verified-in-code: unit tests (effect-infra 136, shared egress/reachability 46, nest-reachability 26, runtime deployment 170, fleet 142, bff setup 27) + real loopback server; not exercised against a real DNS-rebinding setup · Source: networking.md#3.3,#4.1; journeys.md#J3 step 13
  - See also: `SEC-013`, `SETUP-002`

- [ ] `NET-005` **Close DNS/network authz holes in project and service network services (`provisionDnsRecord` and friends)** · FIX · P0 · M · Deps: `SEC-001`
  - Why/Problem: `apps/api-services/services/project/src/modules/service/services/service-network.service.ts:82,148,181` (`provisionDnsRecord` creates arbitrary type/name/content records in the platform DNS zone for any service on behalf of any authenticated user, no hostname-under-zone check); project `getNetwork/updateNetwork` (`project.controller.ts:183-195`, `project-network.service.ts:61-185`) pass no user and let anyone read/change a project's DNS provider/zone/base domain.
  - Do: require project `manage`/`admin` access on all network procedures; validate that record names are inside the project's zone, allowlist record types, reject apex/platform hosts; remove `provisionDnsRecord` if no caller needs arbitrary records.
  - Done when: non-member gets 403; a record outside the zone is rejected; tests added.
  - Status: todo · Verified-in-code: unverified · Source: projects-services.md#1.2,#3.1,#5
  - See also: `SEC-008`, `PROJ-003`, `PROJ-004`

- [ ] `NET-006` **Reserve platform hosts (`api.`, `web.`, `setup.`, console) so no mapping can claim them** · FIX · P0 · M · Deps: `NET-013`
  - Why/Problem: a project owner can register the platform's own public domain plus subdomain `api`/`web` and compete for the same `Host()` rule; equal-length rules have undefined precedence, so the console route is not protected.
  - Do: central reserved-host check (add-domain, service-domain mapping, `customDomains`, lane `public.domain` setting); give console routes explicit highest priority in `buildLaneTraefikConfig`.
  - Done when: adding `api.<platform domain>` is rejected at add time; Traefik config test proves console routes win precedence.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.2,#4.2; journeys.md#J3 acceptance 3
  - See also: `SEC-029`

- [ ] `NET-007` **Do not replicate edge secrets in plaintext on the roster; rotate on revoke** · FIX · P1 · L · Deps: `NET-062`,`NET-077`
  - Why/Problem: the Cloudflare tunnel token lives in the `edge.cloudflare-tunnel` roster setting, gossiped to and stored in `roster.json` on every node; revocation does not rotate it, so a revoked/stolen node keeps tunnel and ACME credentials.
  - Do: interim: keep secrets out of the roster (per-node encrypted store, or only on nodes that run the connector) and add "rotate tunnel token" on member revoke; target: node-scoped sealed secrets (NET-077).
  - Done when: `roster.json` contains no tunnel token; revoking a member rotates the token and old token stops working.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.4,#4.10; ideas-mesh.md#C9
  - See also: `SEC-022`, `IDEA-027`

- [ ] `NET-008` **Do not default `consoleVisibility` to public; confirm when a public lane exposes console/API/setup** · FIX · P1 · S · Deps: none
  - Why/Problem: once a public lane exists the API, web and `setup.` hosts are internet-visible by default; the Traefik config endpoint is token-protected but `api.<domain>` exposes it.
  - Do: default to private/mesh; explicit confirmation dialog + server-side flag when turning console public; separate toggle for `setup.`.
  - Done when: enabling a public lane leaves console non-public unless explicitly confirmed.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.6,#5
  - See also: `SEC-029`

- [ ] `NET-009` **Prove node identity when verifying a node's public address** · FIX · P2 · M · Deps: none
  - Why/Problem: `verifyPublicAddress` (`reachability.service.ts:210`) only checks that something answers `/mesh/ping` or `/health`; it does not prove the address is this node; when editing another node's address it probes from the current node.
  - Do: challenge-response with a nonce signed by the node's mesh identity (or an identity token on `/mesh/ping`); probe from an independent vantage when possible.
  - Done when: an address pointing at another host/proxy fails verification.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.4

### Domain verification and routing (custom domains, journey J3)
- [ ] `NET-010` **Pass the real requester into `verifyProjectDomain`** · FIX · P0 · S · Deps: none
  - Why/Problem: `domain-project.service.ts:176` calls `assertProjectAccess(input.projectId, "verify")` (verified in both `apps/api` and `apps/api-services/services/project`); the controller never passes the user (`project-domain.controller.ts:67-74`), so every Verify is Forbidden, owner included.
  - Do: controller passes `context.auth.session.user.id`; service uses it; fix both trees; add controller test.
  - Done when: owner/maintainer Verify succeeds, viewer gets 403.
  - Status: todo · Verified-in-code: yes · Source: networking.md#1.4; journeys.md#J3 W3.1, quick win 1
  - See also: `JRN-010`

- [ ] `NET-011` **One source of truth for verification instructions; drop the unowned `deployer.io` CNAME scheme** · FIX · P0 · M · Deps: `NET-010`
  - Why/Problem: `addProjectDomain` returns `_deployer-challenge` = `deployer-verification=<token>` / CNAME to `verify.deployer.<token>.acme.` (`domain-project.service.ts:61-85`); the verifier checks TXT `_deployer-verify.<domain>` = bare token or CNAME to `verify-<token>.deployer.io` (`domain-verification.service.ts:72,94,129,234`). They never match; the provider form auto-creates the wrong record; the CNAME method is wrong everywhere (points at a domain the platform does not own).
  - Do: `DomainVerificationService` generates the instructions; `addProjectDomain`, the table, the dialog and the provider form render that same payload; either remove CNAME verification or use `_deployer-verify.<d> CNAME <token>.verify.<platform domain>` (a name the platform controls).
  - Done when: adding a domain on either page shows identical instructions and the records created by the provider form verify.
  - Status: todo · Verified-in-code: partial · Source: networking.md#1.4,#3.7,#4.2; journeys.md#J3 W3.2
  - See also: `JRN-011`, `WEB-056`

- [ ] `NET-012` **Verification worker with backoff, retry of `failed`, and "what we saw" detail** · FIX · P0 · M · Deps: `NET-011`
  - Why/Problem: hourly `setInterval` (`domain-verification.service.ts:24-27`, `@Cron` commented out), selects only `pending` (`:259`) but the first miss sets `failed` (`:163`) and failed rows are never retried; `retryVerification`, `getPendingDomainsCount`, `getVerificationInstructions`, `generateVerificationToken` are dead code.
  - Do: run right after add, then retry with backoff for `pending` and non-definitive `failed` (store `lastVerificationAttempt`, `lastError`, observed value); only mark `failed` for a definitive negative; UI polls and shows per-record status (found / missing / wrong value and what was seen); no Verify click needed.
  - Done when: correct records flip the domain to `verified` within 2 minutes of propagation without clicking; a miss is retried.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.4,#3.7; journeys.md#J3 W3.3, UX

- [ ] `NET-013` **Enforce `verified` and ownership at routing and in `addServiceDomain`; global uniqueness of verified domains** · FIX · P0 · M · Deps: `NET-012`,`SEC-001`
  - Why/Problem: `findServiceUrlRows` joins `project_domains` with no verified filter (`service-domain-mapping.repository.ts:273-288`); `PlatformRoutesSource`/`serviceConfigRoutes` never check verification; `addServiceDomain` neither requires `verificationStatus === "verified"` nor that the service belongs to the project (`domain-service.service.ts:67-110`). The "verified custom domains" doc claim is false.
  - Do: enforce in `addServiceDomain`, `resolveServiceUrls`, `PlatformRoutesSource`, `serviceConfigRoutes`; service must belong to the project; verified domain unique across projects; unverified domain never appears in `GET /traefik/config`.
  - Done when: a `pending`/`failed` domain never produces a router; mapping a foreign project's service is rejected.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.4,#3.2,#4.2; journeys.md#J3 W3.4, step 7, acceptance 3

- [ ] `NET-014` **Remove the free-text `service.customDomains` bypass (or force it through verification)** · FIX · P0 · S · Deps: `NET-013`
  - Why/Problem: `platform-routes-source.service.ts:233` publishes `service.customDomains` as a public host with no verification; the wizard "Domains" step writes it (`apps/web/.../steps/StepDomains.tsx:145`).
  - Do: delete the path or route entries through the verified-domain flow; update wizard.
  - Done when: a hostname typed in the wizard cannot become routable until verified.
  - Status: todo · Verified-in-code: unverified · Source: journeys.md#J3 step 8, quick win 21, new finding 3
  - See also: `JRN-030`, `JRN-039`, `WEB-013`

- [ ] `NET-015` **Build routes from live service-domain mappings; refresh ingress on change; support `basePath` and extra hosts** · FIX · P1 · L · Deps: `NET-013`
  - Why/Problem: hosts come from `deployments.domainUrl`, frozen at deploy time (`platform-routes-source.service.ts:228-229`); mapping changes call no `TraefikConfigRefresher`, so a new domain needs a redeploy; `basePath`, non-primary hosts and `ruleSuffix` PathPrefix are never generated; with no mapping the UI shows no URL although a lane route exists; fake rollback rows without `containerName` are ignored by routing.
  - Do: derive routes from verified `service_domain_mappings`; call the ingress refresher on mapping add/remove/update; extend `buildLaneTraefikConfig` with `ruleSuffix` and multiple `publicHosts`; support primary flag, `stripPath`/`internalPath` (Dokploy parity).
  - Done when: binding/removing a mapping changes routing within 10 s with no redeploy; basePath routes work; lane builder tests cover them.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.4,#3.11,#4.7; journeys.md#J3 W3.5, step 9, acceptance 4; bench-dokploy-dockhand.md#1 (domains)
  - See also: `JRN-038`, `IDEA-101`, `DEPLOY-068`

- [ ] `NET-016` **Delete the legacy `DomainRoutingService` route and cert writers (or rebuild on lane routes)** · FIX · P1 · M · Deps: `NET-015`
  - Why/Problem: `domain-routing.service.ts:208` writes `traefik_service_configs`/`traefik_domain_routes` with entrypoints `web`/`websecure` that do not exist in the lane ingress; the live ingress reads only `config.fullDomain` (`traefik-ingress-config.service.ts:219-245`) and falls back to `http://<host>:<port>` (the public name itself, a loop) when no target exists.
  - Do: remove the writers/tables (or migrate), delete the self-loop fallback, remove per-route rows; update both trees.
  - Done when: no code writes `web`/`websecure` routes; a host can never route to itself; docs updated.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.4,#3.11,#4.7

- [ ] `NET-017` **DNS automation for custom domains ("Create records for me") with correct targets** · NEW · P1 · M · Deps: `NET-011`,`NET-035`
  - Why/Problem: the lane DNS plane only handles `*.<lane domain>`; a custom domain's A/CNAME is never created; with the tunnel edge there is one wildcard rule only; operator must do it manually.
  - Do: per-domain DNS plan through the DNS provider adapter (Cloudflare now): TXT verification + A (node public IPs for `direct`) or CNAME (tunnel) with apex-flattening note; manual instructions otherwise; remove records the platform created on domain removal.
  - Done when: with Cloudflare connected, "Create records" creates TXT + A/CNAME and the domain verifies and serves.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.4,#4.6; journeys.md#J3 W3.6, step 10

- [ ] `NET-018` **Custom hostnames on the Cloudflare tunnel edge (per-hostname ingress rule + CNAME)** · FIX · P1 · M · Deps: `NET-017`
  - Why/Problem: only `*.<lane domain>` reaches the tunnel (one wildcard rule); a custom domain on another zone is not added to the tunnel ingress and no CNAME is created; `domain-gate` only checks that the edge is provisioned.
  - Do: edge provider hook to add/remove per-hostname ingress rules and CNAMEs for zones the account owns; or document the requirement and gate with a clear message.
  - Done when: a verified custom domain on an owned zone is served via the tunnel without manual steps.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.4,#3.10,#4.6; journeys.md#J3 W3.7

- [ ] `NET-019` **Consolidate the two domain UIs and add the stepper (instructions, Verify, live per-record status)** · FIX · P1 · M · Deps: `NET-011`,`NET-012`
  - Why/Problem: `/dashboard/projects/[id]/domains` discards the API's `verificationInstructions` (`page.tsx:35-41`, no Verify action in `ProjectDomainRow.tsx`); `/dashboard/network/domains` shows its own (correct TXT, wrong CNAME) table; inconsistent.
  - Do: shared stepper component: type/name/value/status/"we saw" with copy buttons, auto-poll with backoff, empty state ("Your app is at `<service>-<project>.<domain>`..."), Verify button as manual retrigger, viewer controls hidden.
  - Done when: both pages render the same flow; viewer sees no add/verify controls.
  - Status: todo · Verified-in-code: partial · Source: journeys.md#J3 steps 1-2, W3.2/W3.3, UX, quick win 2; networking.md#1.4
  - See also: `WEB-056`, `JRN-011`

- [ ] `NET-020` **Domain removal flow: remove route immediately, offer to delete platform-created records, keep cert until expiry** · ENHANCE · P2 · S · Deps: `NET-015`,`NET-017`
  - Why/Problem: no defined removal semantics; records created by the platform linger.
  - Do: removal removes route (<10 s), restores previous primary, lists remaining DNS records at the host, optional delete of platform-created records.
  - Done when: after removal `https://<domain>` fails within 15 s and the UI states what remains.
  - Status: todo · Verified-in-code: no · Source: journeys.md#J3 W3.11, UX undo

- [ ] `NET-021` **Domain inventory page and redirect toggles (www<->apex, HTTP->HTTPS)** · NEW · P2 · M · Deps: `NET-015`,`NET-032`
  - Why/Problem: no cross-project view of domains with verification, DNS, cert expiry and bound service; no redirect rules.
  - Do: inventory page; per-domain `www`<->apex and force-HTTPS toggles backed by Traefik redirect middlewares; `http://` redirects (301/308) to `https://`.
  - Done when: acceptance J3 #5 holds; inventory lists every domain with cert expiry.
  - Status: todo · Verified-in-code: no · Source: journeys.md#J3 W3.9, acceptance 5; networking.md#6; bench-coolify.md#1 (www redirect, force-https)
  - See also: `WEB-057`

- [ ] `NET-022` **Per-route middlewares in the UI (basic auth, IP allowlist, rate limit, gzip, strip-prefix, redirects, country rules)** · NEW · P2 · M · Deps: `NET-015`
  - Why/Problem: project settings `enableBasicAuth/basicAuthUsername/basicAuthPassword`, `ipWhitelist`, `allowedDomains` are stored and inert; the lane builder already has `middlewares` (`lane-traefik-config.ts:50-52`) and `traefik-middleware-library.service.ts` exists.
  - Do: expose a per-service/route UI backed by the middleware library; remove or wire the inert project settings; basic-auth password stored encrypted, not returned.
  - Done when: enabling basic auth/IP allowlist on a route changes live behaviour; inert settings no longer shown.
  - Status: todo · Verified-in-code: partial · Source: networking.md#6; projects-services.md#1.1; bench-dokploy-dockhand.md#1; bench-coolify.md#1; bench-market.md#G (IP allowlist/basic auth)
  - See also: `PROJ-083`, `FEAT-133`, `WEB-058`

- [ ] `NET-023` **Traefik effective-config viewer/validated editor, request analytics page, outdated-proxy notice** · NEW · P3 · M · Deps: `NET-043`
  - Why/Problem: `network/ingress` page (83 lines) has no router/service/middleware viewer; v1 had `/dashboard/traefik`; Dokploy has file editor + Requests page (access-log analytics); Coolify shows an outdated-Traefik notice.
  - Do: read-only effective-config viewer first, validated editor later; Traefik access-log analytics (status distribution, table); version-check notice.
  - Done when: operator can see the rendered lane config per node and request status stats.
  - Status: todo · Verified-in-code: no · Source: parity.md#1.4; bench-dokploy-dockhand.md#1; bench-coolify.md#1
  - See also: `FEAT-132`, `FEAT-134`, `WEB-059`, `OBS-051`

- [ ] `NET-024` **Domain lifecycle extras: automatic re-verification, transfer between projects, wildcard custom domains** · NEW · P3 · M · Deps: `NET-012`,`NET-030`
  - Why/Problem: verified domains are never re-checked; no transfer; no wildcard custom domain support (`*.example.com`).
  - Do: periodic re-verification with downgrade + alert; transfer flow with re-verification; wildcard domain support requiring DNS-01.
  - Done when: a domain whose TXT is removed is flagged; transfer works with audit event.
  - Status: todo · Verified-in-code: no · Source: networking.md#6; parity.md#3 rank 15; bench-market.md#G

- [ ] `NET-025` **Show the computed lane URL and an empty-state for domains; optional auto-generated default domain** · ENHANCE · P2 · S · Deps: none
  - Why/Problem: with no mapping the UI shows no URL although the lane route exists (`domain-routing.service.ts:143-145`); default domain is hardcoded `*.deployer.localhost` (bench: Dokploy traefik.me, Vercel/Render defaults).
  - Do: show `<service>-<project>.<lane domain>` next to deployment/service; decide on an auto default (sslip/nip-style or lane domain) via DEC-NET-8.
  - Done when: every deployed service shows its reachable URL.
  - Status: todo · Verified-in-code: partial · Source: journeys.md#quick win 19, new finding 2, J3 UX; bench-market.md#G
  - See also: `DEPLOY-068`, `JRN-028`

- [ ] `NET-026` **Surface domain-sync and TLS-provisioning failures instead of warn-only logs** · ENHANCE · P2 · S · Deps: `NET-032`
  - Why/Problem: deployment syncs routes and provisions TLS (`deployment-execution-workflow.service.ts:487-535`) but errors are only logged as warnings.
  - Do: record outcome on the deployment/domain, show in UI, emit event.
  - Done when: a failed route/TLS step is visible on the deployment and domain rows.
  - Status: todo · Verified-in-code: unverified · Source: projects-services.md#1.5 (Domain/TLS per service)

- [ ] `NET-027` **Delete dead helpers in `domain-verification.service.ts`** · FIX · P3 · S · Deps: `NET-012`
  - Why/Problem: `retryVerification`, `getPendingDomainsCount`, `getVerificationInstructions`, `generateVerificationToken` are dead (or become live under NET-011/012).
  - Do: remove what remains unused after NET-011/012; both trees.
  - Done when: no unused exported verification helpers remain.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#5

### TLS and certificates
- [ ] `NET-028` **Require the ACME email; remove the fake `admin@example.com` default** · FIX · P0 · S · Deps: none
  - Why/Problem: `DEPLOYER_TRAEFIK_ACME_EMAIL` defaults to `admin@example.com` (`packages/config/env/src/index.ts:255`, verified), which Let's Encrypt rejects.
  - Do: required when a public TLS lane is enabled; wizard/settings field; UI blocks enabling public TLS without it with an explanatory message; SETUP owns the wizard field.
  - Done when: no default; enabling public TLS without email is blocked.
  - Status: todo · Verified-in-code: yes · Source: networking.md#1.4,#3.10,#4.5; journeys.md#quick win 17, acceptance 6
  - See also: `JRN-026`, `SETUP-021`

- [ ] `NET-029` **Fix multi-node `direct` ACME (HTTP-01 lands on a node without the token)** · FIX · P1 · L · Deps: `NET-030`
  - Why/Problem: `direct` publishes A records for every node with per-node `acme.json` and HTTP-01 per host (`traefik-supervisor.service.ts:249-257`); validation can hit a node that does not hold the token; each app/preview is its own cert (rate limits).
  - Do: choose one: DNS-01 via NET-030, shared ACME storage, or sticky challenge routing; until then restrict `direct` to single-node and say so in the UI (DEC-NET-7).
  - Done when: multi-node `direct` issues certs reliably in the e2e.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.10,#4.5; ideas-mesh.md#C5

- [ ] `NET-030` **DNS-01 wildcard certificate provider reusing DNS accounts** · NEW · P1 · M · Deps: `NET-035`
  - Why/Problem: no wildcard cert, no DNS-01; needed for multi-node, failover, previews and wildcard custom domains. Dokploy has DNS providers + certificates.
  - Do: Traefik DNS-01 resolver configured from stored DNS provider accounts (Cloudflare first); wildcard `*.<lane domain>` cert; secrets via secret store.
  - Done when: a wildcard cert is issued via DNS-01 and served on all edge nodes.
  - Status: todo · Verified-in-code: no · Source: networking.md#1.4,#4.5,#6; ideas-mesh.md#E10; bench-market.md#G; bench-coolify.md#1 (SSL); parity.md#1.4

- [ ] `NET-031` **Implement or remove `provisionTlsCertificate`; add custom certificate upload** · FIX · P1 · M · Deps: `NET-032`
  - Why/Problem: `domain-routing.service.ts:264-300` only inserts a DB row; nothing requests, uploads or renews a cert; `sslProvider:"custom"` has no upload path; `sslEnabled` not honoured per host.
  - Do: wire to the real cert pipeline (Traefik ACME result / DNS-01) or delete; custom cert upload with encrypted storage and expiry parsing; honour per-host SSL.
  - Done when: no stub row-only path remains; uploaded cert is served for its host.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.4,#4.5; bench-dokploy-dockhand.md#1 (cert upload missing)

- [ ] `NET-032` **Certificate inventory (`domain_certificates`), expiry monitoring, alerts and UI** · NEW · P1 · L · Deps: `OBS-001`,`NET-028`
  - Why/Problem: no cert status, expiry data or alerts; v1 had `ssl-certificate.service` (cron renewal tracking) and project `ssl` tab with no v3 equivalent; Coolify has `SslCertificate` and SSL-expiry notifications.
  - Do: `domain_certificates` table (status, notAfter, issuer, lastError) fed by ACME result or TLS probe; expiry alerts through the event bus (OBS notifications); cert panel in domains UI and a project SSL tab.
  - Done when: each domain shows issuer/expiry; a cert nearing expiry triggers an alert.
  - Status: todo · Verified-in-code: no · Source: networking.md#1.4,#6; journeys.md#J3 W3.8, step 12; parity.md#1.4, rank 15; bench-coolify.md#1; bench-market.md#quick win 11
  - See also: `OBS-041`, `FEAT-124`, `FEAT-130`

- [ ] `NET-033` **Map ACME/TLS errors to causes in the UI (CAA, rate limit, proxied record, port 80 unreachable, propagation)** · NEW · P2 · M · Deps: `NET-032`
  - Why/Problem: certificate failures are opaque; Cloudflare proxy (orange cloud) breaks HTTP-01.
  - Do: classify ACME errors, show specific messages and next steps incl. "Cloudflare proxy is on".
  - Done when: simulated CAA/rate-limit/proxy cases produce specific messages (Pebble e2e).
  - Status: todo · Verified-in-code: no · Source: journeys.md#J3 UX failure messages

- [ ] `NET-034` **Internal CA for service/DB TLS** · NEW · P3 · L · Deps: `NET-032`
  - Why/Problem: Coolify has per-resource internal CA certs (twice-daily regeneration) for DB/service TLS; we have none.
  - Do: platform CA, per-service cert issuance/renewal, trust distribution for DB templates.
  - Done when: a managed DB can be reached over TLS signed by the platform CA.
  - Status: todo · Verified-in-code: no · Source: bench-coolify.md#1 (SSL)

### DNS providers and lane DNS
- [ ] `NET-035` **Implement Route53 and Google DNS adapters, or remove them from the UI; define the adapter interface** · FIX · P1 · M · Deps: none
  - Why/Problem: `provider-domain-form.tsx` lists Route53/Google DNS but the registry has only the Cloudflare adapter; web pages are "unavailable" stubs. Dokploy ships DNS Providers + Certificates.
  - Do: formal `DnsProvider` adapter interface (records, zones, DNS-01 challenge); implement Route53 + Google (+ optionally manual/RFC2136), or hide unimplemented options.
  - Done when: UI offers only working providers; each adapter has contract tests.
  - Status: todo · Verified-in-code: partial · Source: networking.md#1.4; parity.md#1.4 (DNS providers); bench-market.md#G
  - See also: `WEB-061`, `WEB-060`

- [ ] `NET-036` **Preview networking: choose the DNS account by zone ownership; cover previews with the tunnel wildcard/DNS-01** · FIX · P1 · M · Deps: `NET-030`
  - Why/Problem: preview DNS uses `findFirstActiveAccount` (first account of any provider, then a zone check); host is `<previewName>.<primary domain>` (`preview-provisioning.service.ts:79`); previews are not in the tunnel wildcard unless under the lane domain; DNS only supports Cloudflare. (The PR build/deployment attachment `findLatestDeploymentByService`, `prNumber != null` is DEPLOY's item.)
  - Do: pick the account that owns the zone; place previews under the lane/wildcard domain or add per-host tunnel rules; await DNS instead of fire-and-forget; naming shared with cleanup.
  - Done when: a preview hostname resolves and is served on the tunnel and `direct` edges; teardown removes its record.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.4,#3.12,#4.8; projects-services.md#1.4
  - See also: `DEPLOY-103`, `FEAT-065`

- [ ] `NET-037` **Validate lane domains: reject `private.domain === public.domain`, reserved hosts and overlaps** · FIX · P1 · S · Deps: `NET-006`
  - Why/Problem: the schema allows `private.domain === public.domain`; the public CNAME and private A plans then fight on every reconcile (`EdgeDnsService.reconcileOne` deletes the other's records); a public domain can overlap platform reserved hosts.
  - Do: server-side validation in `ingress-lanes.service.ts` and UI; also reject `.internal` as a public domain.
  - Done when: invalid configs are rejected with a clear error.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.13,#5; ideas-mesh.md#E15

- [ ] `NET-038` **DNS drift display and edge-change dry-run ("what will Cloudflare/DNS change")** · ENHANCE · P2 · M · Deps: none
  - Why/Problem: DNS records show only `synced/manual/error`; switching edge has no preview.
  - Do: show planned vs found; dry-run plan for edge/lane changes.
  - Done when: operator sees exact record changes before applying a switch.
  - Status: todo · Verified-in-code: no · Source: networking.md#5; ideas-mesh.md#E12

- [ ] `NET-039` **Health-aware DNS: drop a down `direct` node's A record** · FIX · P2 · M · Deps: `NET-087`
  - Why/Problem: DNS has no health-aware removal of a down node (A records for every node regardless).
  - Do: use node liveness (signed facts) to compute the healthy record set; idempotent writes; short TTL.
  - Done when: a stopped edge node's A record is removed within the reconcile window.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.10,#6; ideas-mesh.md#C5

- [ ] `NET-040` **Replace external `getPublicIp` calls with the agent's STUN** · ENHANCE · P3 · S · Deps: `NET-058`
  - Why/Problem: reachability service calls external IP services; STUN already exists in the agent (and privacy option, DEC-NET-4).
  - Do: use agent-reported reflexive address; optional self-hosted STUN.
  - Done when: no third-party IP lookup call remains.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#5

- [ ] `NET-041` **Remove platform-created DNS records and routes on service/project delete and member revoke** · FIX · P1 · M · Deps: `OBS-001`
  - Why/Problem: no teardown consumer for `project.deleted`/`service.deleted`; DNS records, Traefik routes and preview records remain (PROJ owns container/volume teardown; this is the network side).
  - Do: event consumers that delete platform-created DNS records, routes and domain mappings; show what will be removed in the confirmation.
  - Done when: deleting a service leaves no DNS records or routes behind.
  - Status: todo · Verified-in-code: unverified · Source: projects-services.md#3.7,#4.9; networking.md#3.16
  - See also: `PROJ-100`, `DEPLOY-079`, `PROJ-158`

### Edge, ingress and runtime defaults
- [ ] `NET-042` **Verify the Cloudflare tunnel edge against a real account and against a mock** · FIX · P1 · M · Deps: `NET-103`
  - Why/Problem: REAL but unverified live; specs mock Cloudflare (provision, wildcard ingress incl. catch-all 1056, connector replicas, adopt-by-name, teardown).
  - Do: manual live verification checklist + a `mock-cloudflare` fixture-based e2e; record results.
  - Done when: provision -> serve -> teardown passes on a real zone and in CI mock.
  - Status: todo · Verified-in-code: no · Source: networking.md#1.2,#2; bench-coolify.md#1; bench-market.md#G,#5

- [ ] `NET-043` **Retire the legacy `MANAGED_TRAEFIK_ENABLED` docker/file-provider Traefik profile** · FIX · P1 · M · Deps: none
  - Why/Problem: `infra/docker/compose/common/traefik/docker-compose.config.yml:19-22` runs Traefik with docker+file providers and only a `web` entrypoint; used by `docker-compose.dev.yml` and `docker-compose.services.dev.yml`; no lanes/doors apply. Dev does not exercise the production path.
  - Do: migrate dev compose to the HTTP-provider ingress (supervised profile) and delete the legacy profile and `web`/`websecure` assumptions.
  - Done when: dev default profile serves lane routes through the same ingress as prod.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.2,#3.14,#4.7; ideas-mesh.md#E16

- [ ] `NET-044` **Require `MESH_AGENT_DATAPLANE` in production; fail on `observe`** · FIX · P1 · S · Deps: none
  - Why/Problem: API env default is `observe` (`packages/config/env/src/index.ts:289`), so production without the compose override gets no real WireGuard.
  - Do: required in prod with startup failure on `observe`; document dev override.
  - Done when: prod boot with `observe` fails with a clear message.
  - Status: todo · Verified-in-code: partial · Source: networking.md#3.14,#4.9
  - See also: `OPS-029`

- [ ] `NET-045` **Pin door (`nginx:alpine`) and mesh-agent (`:latest`) image tags/digests** · FIX · P1 · S · Deps: none
  - Why/Problem: unpinned images; agent defaults to `deployer-mesh-agent:latest`.
  - Do: pinned tags/digests from the release manifest; no `latest` fallback.
  - Done when: rendered compose/agent env contain explicit tags/digests.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.20,#4.9
  - See also: `OPS-030`, `OPS-004`

- [ ] `NET-046` **Firewall docs and preflight for UDP 51820 (and 80/443 for `direct`); mesh doctor hooks** · FIX · P1 · S · Deps: none
  - Why/Problem: UDP 51820 not in firewall docs/preflight; NAT-limited nodes get no explanation. SETUP owns the installer preflight; NET owns the content.
  - Do: preflight check list (UDP 51820, kernel module, STUN reachability, public 80/443 for `direct`), docs.
  - Done when: preflight reports each condition with remediation.
  - Status: todo · Verified-in-code: no · Source: networking.md#4.9,#6
  - See also: `SETUP-023`, `OPS-021`

- [ ] `NET-047` **Agent supervision and rolling upgrade through the mesh** · ENHANCE · P1 · M · Deps: `NET-045`
  - Why/Problem: the agent container is created once (`MeshAgentBootstrapService.ensure()`, `restart: unless-stopped`) and replaced only when image/env differs; no health supervisor; no upgrade path.
  - Do: version in member labels, signed `agent.image` setting, rolling upgrade one member at a time with health guard, supervisor that restarts an unhealthy agent; recreate when declared address/env changes.
  - Done when: changing the image setting upgrades members one by one and rolls back on failure.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.1,#4.9; ideas-mesh.md#E4
  - See also: `OPS-018`, `IDEA-031`

- [ ] `NET-048` **Per-lane probe button, per-lane request metrics, connector replica placement and last-seen** · ENHANCE · P2 · M · Deps: none
  - Why/Problem: no end-to-end "probe this lane", no per-lane metrics from doors, no connector placement/last-seen in the edge UI.
  - Do: probe endpoint + UI, doors expose counters, edge status lists connector replicas.
  - Done when: each lane shows probe result and request rate; connectors list node + last seen.
  - Status: todo · Verified-in-code: no · Source: networking.md#5; ideas-mesh.md#E11

- [ ] `NET-049` **Per-key compare-and-set for cluster settings (`ingress.lanes`, `node.doors`)** · FIX · P1 · M · Deps: none
  - Why/Problem: settings are LWW on `version+1` (`roster.ts:626-639`); two nodes writing the same key lose one write; latent today.
  - Do: expected-version CAS with an explicit conflict error; UI handles conflict.
  - Done when: concurrent writes produce a conflict instead of silent loss (unit + gossip test).
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.15,#5; ideas-mesh.md#0 hygiene

- [ ] `NET-050` **Tailscale Funnel edge provider** · NEW · P2 · S · Deps: none
  - Why/Problem: cheapest second provider for users already on Tailscale; proves the plugin contract (`edge-provider.ts`).
  - Do: provider implementing `ingress/connector/dnsRecords/status/joinPath`; descriptor-rendered UI form.
  - Done when: selecting it exposes a lane publicly with no inbound port.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#E13; bench-market.md#5; networking.md#6

- [ ] `NET-051` **More edge providers: frp / WireGuard-relay VPS, NetBird expose, Caddy-on-VPS** · NEW · P2 · M · Deps: `NET-080`
  - Why/Problem: networking.md lists "alternative public edges" as missing; each is about one file against `edge-provider.ts`.
  - Do: implement as plugins, each with status/health and teardown; per-provider health in UI.
  - Done when: at least one non-Cloudflare, non-direct provider is selectable and verified.
  - Status: todo · Verified-in-code: no · Source: networking.md#1.2,#6; ideas-mesh.md#E13; bench-market.md#5

- [ ] `NET-052` **De-duplicate networking code between `apps/api` and `apps/api-services`** · FIX · P1 · L · Deps: `ARCH-031`
  - Why/Problem: edge, reachability, mesh-agent, platform-ingress, traefik, domain modules are duplicated (`apps/api/src/core/modules/*` vs `apps/api-services/shared` + `services/fleet|project`); every bug exists twice.
  - Do: single copy in the surviving tree; until then apply every NET FIX to both.
  - Done when: one implementation of each networking module remains.
  - Status: todo · Verified-in-code: yes · Source: networking.md#3.17,#4.12; parity.md (structural facts); projects-services.md#0
  - See also: `CLUSTER-071`, `ARCH-037`

- [ ] `NET-053` **Per-service/route visibility editing and per-member ACL UI (mesh-only / public / IP-allowlist)** · NEW · P2 · M · Deps: `NET-022`,`NET-082`
  - Why/Problem: `services.network.visibility` is not editable in the UI; no per-route "mesh-only/public/IP allowlist" toggle (NetBird bar); no per-member ACLs on the private lane.
  - Do: route visibility editor (local/private/public) + allowlists; per-member ACL via microsegmentation later.
  - Done when: visibility changes take effect on the lane router and are audited.
  - Status: todo · Verified-in-code: no · Source: networking.md#6; bench-market.md#G,#5
  - See also: `WEB-058`

- [ ] `NET-054` **Sticky sessions and load-balancing options across replicas** · ENHANCE · P2 · M · Deps: `CLUSTER-038`
  - Why/Problem: bench marks load balancing/sticky sessions PART (Traefik round-robin; services hardcoded to 1 replica).
  - Do: expose LB strategy and sticky cookie per route in the lane config.
  - Done when: multi-replica routes honour the setting (test).
  - Status: todo · Verified-in-code: no · Source: bench-market.md#G; ideas-mesh.md#C13

- [ ] `NET-055` **L4 (TCP/UDP) exposure through edges (TLS-SNI passthrough)** · NEW · P3 · L · Deps: `NET-053`
  - Why/Problem: no L4 exposure (NetBird/Tailscale serve have it); DB public-port toggles need it.
  - Do: Traefik TCP routers/entrypoints per lane; edge providers that support TCP.
  - Done when: a TCP service is reachable via a lane.
  - Status: todo · Verified-in-code: no · Source: bench-market.md#G

- [ ] `NET-056` **CDN/edge-cache guidance via Cloudflare provider (document or toggle)** · NEW · P3 · S · Deps: `NET-042`
  - Why/Problem: bench P3: use Cloudflare edge provider instead of building a CDN.
  - Do: document the Cloudflare cache/proxy option and expose a per-route cache toggle if cheap.
  - Done when: docs state the supported path.
  - Status: todo · Verified-in-code: no · Source: bench-market.md#G

### Mesh core fixes and enhancements
- [ ] `NET-057` **Wire declared public addresses into the agent** · FIX · P1 · S · Deps: none
  - Why/Problem: `MESH_AGENT_DECLARED_ADDRESSES` is honoured by the agent (`agent.ts:184`) but no caller passes `declaredAddresses` (setup `mesh-agent-launcher.service.ts:50-56`, API `mesh-agent-bootstrap.service.ts:51-54`); the UI's `node_network_config.publicAddress` never reaches the agent, so a public-IP node advertises only LAN + STUN.
  - Do: thread `publicAddress` through `meshAgentContainerEnv`; recreate the agent when it changes (NET-047).
  - Done when: a node with a declared address advertises it as a candidate and peers use it.
  - Status: todo · Verified-in-code: partial · Source: networking.md#1.1,#3.8,#4.3; ideas-mesh.md#0

- [ ] `NET-058` **Query STUN from the WireGuard port (correct reflexive port); optional self-hosted/no-external STUN** · FIX · P1 · M · Deps: none
  - Why/Problem: `endpoint-discovery.ts:49-85` queries from a random ephemeral UDP socket, so the reflexive port is only valid if the NAT preserves ports; IPv4 only; needs Cloudflare/Google STUN.
  - Do: perform STUN from the WG socket (or document the port-preserving assumption and detect CGNAT by port mismatch); allow operator STUN server or disable (DEC-NET-4).
  - Done when: behind port-restricted NAT the advertised candidate port is correct (netns NAT e2e).
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.1,#3.8,#4.4; ideas-mesh.md#0,#E3

- [ ] `NET-059` **Salt-retry loop on address collision during join; "Retry admission" UI action** · FIX · P1 · S · Deps: none
  - Why/Problem: `admitMember` throws `address-collision` but `MeshAdmissionService.admit` swallows it and returns null (`mesh-admission.service.ts:~46-50`); the join request always sends `addressSalt ?? 0` (`agent.ts:228`), so the loser is silently "not admitted".
  - Do: retry with the next salt; surface the error; UI retry action.
  - Done when: a forced collision resolves on retry (unit test).
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.9,#5; ideas-mesh.md#E6

- [ ] `NET-060` **Graceful `leave` caller and re-activation of `left` members** · ENHANCE · P2 · S · Deps: none
  - Why/Problem: `control-server.ts:87` exposes `leave`, but `MeshAgentHttpClient` has no `leave()` and no API/UI calls it; a `left` member never returns to `active`.
  - Do: client method, API procedure, UI action; re-join path.
  - Done when: a node can leave and rejoin from the UI.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#1.1,#5; ideas-mesh.md#E6

- [ ] `NET-061` **Show "relay/unreachable" as an explicit health error until relay exists; document NAT limits** · FIX · P1 · S · Deps: none
  - Why/Problem: planner emits `path:"relay"` with `endpoint:null` and cycles; relayed peers are excluded from gossip (`agent.ts:411`) so they never converge; UI does not say so.
  - Do: expose as error state in mesh health and pre-flight/NAT docs (DEC-NET-6); removed when NET-073 lands.
  - Done when: a pair of both-NATed nodes shows an explicit actionable error.
  - Status: todo · Verified-in-code: yes · Source: networking.md#1.1,#3.8,#4.4; journeys.md#decisions 3

- [ ] `NET-062` **Post-revoke cleanup workflow (Swarm node, DNS A records, `node_network_config`, secrets, local agent teardown)** · FIX · P1 · M · Deps: `NET-007`
  - Why/Problem: a revoked member is not removed from Swarm, the `node_network_config` row or DNS A records; its agent keeps the interface up (tick throws before applying) and old credentials.
  - Do: one workflow with checklist+results: Swarm removal, DNS record drop, tunnel/edge secret rotation, node row purge, revoked agent tears down its interface.
  - Done when: revoking shows each step's result and the node is gone from all four places.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.16; ideas-mesh.md#E7

- [ ] `NET-063` **Link telemetry: rx/tx, handshake age, RTT/loss, short history** · ENHANCE · P2 · M · Deps: none
  - Why/Problem: data exists in `wg show dump` but UI shows no rx/tx or latency, no history; basis for locality routing and health map.
  - Do: agent-measured RTT/loss, ring buffer per peer, link-state history tab; push over mesh (also serves OBS metrics history).
  - Done when: each link shows rx/tx, handshake age, RTT, 24 h history.
  - Status: todo · Verified-in-code: no · Source: networking.md#1.4,#5; ideas-mesh.md#E1; bench-coolify.md#1 (sentinel)
  - See also: `OBS-044`

- [ ] `NET-064` **Mesh health alerts and notifications (node/link down, handshake stale, cert expiry hookup)** · NEW · P1 · M · Deps: `OBS-001`,`NET-063`
  - Why/Problem: no alerts or notifications on mesh health; push notifications exist but nothing emits.
  - Do: emit mesh events to the notification dispatcher (OBS): link down, member unreachable, revoked, edge failure.
  - Done when: taking a node offline triggers a notification.
  - Status: todo · Verified-in-code: no · Source: networking.md#1.4,#5,#6
  - See also: `FEAT-124`, `CLUSTER-025`

- [ ] `NET-065` **Mesh doctor (UDP 51820, kernel module, STUN, clock skew, MTU black holes, CGNAT detection)** · NEW · P2 · M · Deps: `NET-058`
  - Why/Problem: no self-diagnosis for common failures.
  - Do: CLI command and UI panel running the checks with remediation.
  - Done when: each check reports pass/fail with advice.
  - Status: todo · Verified-in-code: no · Source: networking.md#6; ideas-mesh.md#E2

- [ ] `NET-066` **Roster size/tombstone GC with signed checkpoints** · ENHANCE · P2 · M · Deps: `NET-076`
  - Why/Problem: roster grows without bound (no GC); also needed by the audit-trail design.
  - Do: tombstone pruning with signed checkpoint snapshots; versioned roster envelope.
  - Done when: a roster with many revocations prunes while all nodes still converge (test).
  - Status: todo · Verified-in-code: no · Source: networking.md#1.1,#5; ideas-mesh.md#E5

- [ ] `NET-067` **IPv6 endpoint candidates and STUN** · NEW · P3 · M · Deps: `NET-058`
  - Why/Problem: IPv6 missing in discovery and candidates.
  - Do: IPv6 candidate kinds and ranking; STUN over IPv6.
  - Done when: two IPv6-only-reachable nodes link directly.
  - Status: todo · Verified-in-code: no · Source: networking.md#1.1,#5; ideas-mesh.md#E3

- [ ] `NET-068` **WireGuard preshared keys and periodic key rotation** · NEW · P3 · M · Deps: `NET-076`
  - Why/Problem: no PSK, no rotation of WG/identity keys.
  - Do: derive PSK from ECDH of identity keys, rotate via signed epoch.
  - Done when: links use PSK and rotate with no outage.
  - Status: todo · Verified-in-code: no · Source: networking.md#1.1; ideas-mesh.md#E9

- [ ] `NET-069` **Opt-in quorum-guarded revocation / sensitive settings (M-of-N)** · NEW · P3 · M · Deps: `NET-076`
  - Why/Problem: any active member can revoke any member including genesis, no quorum (by design); timestamps self-asserted; stolen key can backdate.
  - Do: optional M-of-N for revoke and sensitive keys, default stays peer-equal (DEC-NET-9).
  - Done when: with the option on, a single member cannot revoke alone.
  - Status: todo · Verified-in-code: yes · Source: networking.md#3.5; ideas-mesh.md#E8
  - See also: `IDEA-004`

- [ ] `NET-070` **Reduce mesh-agent privilege surface (docker socket + host network + NET_ADMIN)** · ENHANCE · P3 · M · Deps: none
  - Why/Problem: high privilege, justified in comments; any agent compromise equals host compromise.
  - Do: split door management/WG apply, drop docker socket where possible, capability review, read-only rootfs.
  - Done when: documented minimal capability set and the socket is removed or proxied with an allowlist.
  - Status: todo · Verified-in-code: yes · Source: networking.md#3.20
  - See also: `SEC-027`, `ARCH-060`

- [ ] `NET-071` **Audit events for revocations, edge/lane changes and node address changes** · NEW · P2 · S · Deps: `OBS-001`,`NET-078`
  - Why/Problem: settings overwrite history (`roster.ts:626-639`); no record of who changed lanes/edges/addresses/revocations.
  - Do: emit audit events (actor, subject, payload hash) from the API and from roster operations.
  - Done when: lane/edge/revocation changes appear in the audit log.
  - Status: todo · Verified-in-code: yes · Source: networking.md#6; bench-market.md#5
  - See also: `OBS-071`

### Mesh moat: differentiating features (ideas-mesh.md, in recommended build order)
- [ ] `NET-072` **Mesh hygiene bundle (build order step 0): finish before any moat feature** · ENHANCE · P1 · S · Deps: `NET-001`,`NET-003`,`NET-049`,`NET-057`,`NET-058`,`NET-059`
  - Why/Problem: without these, C1/C2/C12 are demos: declared addresses never wired, STUN socket mismatch, no salt retry, ungated DNS/tunnel/reachability endpoints, LWW settings.
  - Do: track completion of the listed items; effort S-M total.
  - Done when: all listed dependencies are done.
  - Status: todo · Verified-in-code: partial · Source: ideas-mesh.md#0, #3 build 0

- [ ] `NET-073` **C1 Relay-by-any-member (UDP-in-WireGuard relay, end-to-end encrypted)** · NEW · P1 · L · Deps: `NET-072`
  - Why/Problem: relay is a stub (`links.ts:176-188`, verified); two nodes behind symmetric NAT/CGNAT never converge; the "add a node with no inbound ports" claim is not yet true. No competitor ships a coordinator-free, any-member relay.
  - Do: per-agent UDP forwarder; relay endpoint kind `relay` (relay's mesh address + deterministic port from `hash(targetKey)`); relay chosen by lowest summed RTT, tie-break by member id; members publish fresh-handshake sets (`link.fresh`); relayed peers count as reachable for gossip (`agent.ts:411`); no chains (relay must have direct handshakes to both); rate cap and accounting; re-probe direct path and migrate off relay; MTU handling; status surface (NET-061 removed). Effort L; priority 1 of build order.
  - Done when: netns e2e (iptables symmetric NAT on both sides) converges via a third member and falls back to direct when possible.
  - Status: todo · Verified-in-code: yes · Source: ideas-mesh.md#C1,#3; networking.md#1.1,#4.4
  - See also: `IDEA-084`

- [ ] `NET-074` **C2 Mesh DNS and service discovery with split-horizon** · NEW · P1 · M · Deps: `NET-072`
  - Why/Problem: `.internal`, `.local`, `.lan`, `.home.arpa`, `.localhost` are never published (`lane-dns-plan.ts:28`) and no resolver exists, so the private lane default domain `deployer.internal` is unusable; no self-hosted PaaS has mesh DNS (Fly `.internal`, Tailscale MagicDNS do).
  - Do: agent DNS stub on mesh address :53 and loopback; records from roster members (`<name>.mesh`), a replicated `dns.records` setting written from lanes/routes (`*.<private domain>` -> door mesh addresses) and per-service records; opt-in reversible host resolver config via `resolvectl` or Docker `--dns`; split-horizon returns private answers to members for public names; health awareness with NET-087.
  - Done when: `api.deployer.internal` resolves on every member with no public DNS and survives partitions.
  - Status: todo · Verified-in-code: yes · Source: ideas-mesh.md#C2; networking.md#1.1,#1.3,#6; bench-market.md#G,#5

- [ ] `NET-075` **C3 Operator member (`deployer mesh connect`) with expiring and scoped admissions** · NEW · P1 · M · Deps: `NET-076`,`NET-074`
  - Why/Problem: `kind:"operator"` exists only as a schema enum (`schemas.ts:42-47`); no CLI or laptop packaging; private lane and console unreachable from a laptop. Time-boxed guest access without a server is new.
  - Do: add `expiresAt` and `scope` to `admissionRecordSchema` (`schemas.ts:86-93`); `validateRoster` treats expiry like revocation (same fixpoint); operator members excluded from swarm and from peer sets that do not need them; laptop packaging (userspace WG sidecar on macOS/Windows); CLI `deployer mesh connect`.
  - Done when: a laptop joins with no inbound port, reaches private routes and the console; a 4 h guest admission expires by itself.
  - Status: todo · Verified-in-code: yes · Source: ideas-mesh.md#C3; networking.md#1.1,#6; bench-coolify.md#4 (CLI hero)
  - See also: `FEAT-083`, `IDEA-084`

- [ ] `NET-076` **C21 Hybrid logical clocks and signed checkpoints (shared prerequisite)** · NEW · P1 · M · Deps: none
  - Why/Problem: timestamps are self-asserted; a stolen key can backdate; expiry (C3/C8/C20), audit ordering (C10) and revocation cut-off depend on trustworthy time.
  - Do: HLC counters on member entries/settings/events; per-signer monotonic validation; periodic signed checkpoint of the merged roster; version the on-disk envelope. Do as part of C10.
  - Done when: a backdated record contradicts an earlier checkpoint and is flagged (test).
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C21; networking.md#3.5
  - See also: `IDEA-099`

- [ ] `NET-077` **C9 Node-scoped sealed secrets over the mesh (ECIES wraps in roster)** · NEW · P1 · L · Deps: `NET-076`
  - Why/Problem: secrets replicate to everyone or live plaintext in the DB; the tunnel token is plaintext in the roster; Swarm secrets are cluster-wide; `swarm-spec.mapper.ts` never emits `Secrets`.
  - Do: data key per secret wrapped (ECIES, recipient x25519) per allowed member; store `{ciphertext, wraps}` as a roster setting; supervisor materialises to tmpfs/Swarm secret on entitled nodes only; leaderless re-wrap on revoke plus a "rotate after revoke" workflow for provider tokens; libsodium sealed boxes; security review. Effort M-L.
  - Done when: the tunnel token and a service secret are readable only by entitled nodes; a revoked node cannot read new values.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C9; networking.md#3.4
  - See also: `IDEA-027`, `SEC-022`

- [ ] `NET-078` **C10 Tamper-evident audit trail from the signed roster** · NEW · P1 · M · Deps: `NET-076`,`OBS-001`,`IDEA-004`
  - Why/Problem: no user-facing audit log (Dokploy/Dockhand paywall theirs); `setSetting` overwrites history; no append-only record kind.
  - Do: fifth roster map `events`: grow-only per-actor hash-chained signed events `{actor, seq, prev, kind, subject, payloadHash, issuedAt}` keyed `actor:seq`; automatic emission from setSetting/admit/revoke; API emits deploy/auth events through the outbox; verify command, JSON-Lines export, checkpoint hash; snapshot+prune design up front.
  - Done when: verification walks chains and reports gaps; export works; lane/edge/revocation changes appear.
  - Status: todo · Verified-in-code: yes · Source: ideas-mesh.md#C10; bench-market.md#5
  - See also: `IDEA-014`, `IDEA-015`, `OBS-071`, `FEAT-110`, `IDEA-057`

- [ ] `NET-079` **C4 Registry-less peer-to-peer image distribution (digest-addressed, pull-through)** · NEW · P1 · L · Deps: `NET-073`,`NET-077`
  - Why/Problem: multi-node Swarm cannot pull locally built images (CLUSTER/DEPLOY blocker); Dokploy needs a registry; P2P distribution does not exist for Swarm platforms.
  - Do: per-node OCI `registry:2` on the mesh address with loopback alias via a door; digest tags only; publish `images.have`; runner rewrites the reference to `localhost:5000/<digest>`; pull-through shim asks peers ranked by link path/RTT and verifies digests; layer GC tied to retention; relayed peers last resort.
  - Done when: a build on node A runs on node B with no external registry; peer outage tolerated.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C4; bench-market.md#3 (#18); bench-coolify.md#1
  - See also: `DEPLOY-051`, `CLUSTER-049`, `FEAT-043`

- [ ] `NET-080` **C12 Mesh-gateway edge provider (BYO VPS as front door) and home-lab hybrid** · NEW · P1 · M · Deps: `NET-073`,`NET-074`,`NET-030`,`NET-057`
  - Why/Problem: no "member is the front door" provider; `dnsRecords` only uses `publicAddress` facts of all nodes (`edge-provider.ts:37-41`); smallest path to "three houses, no static IPs".
  - Do: `mesh-gateway` provider with `gatewayMembers` label selector (`deployer.edge=gateway`, placement label `deployer.ingress`); publish :80/:443 only on gateways; A records for declared addresses; Traefik routes over the overlay; document TLS-termination trust concentration, TCP passthrough later.
  - Done when: a VPS member fronts apps running on a NATed home node.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C12; networking.md#6; bench-market.md#5

- [ ] `NET-081` **C5 Coordinator-less multi-site failover and active-active public edge** · NEW · P2 · L · Deps: `NET-074`,`NET-030`,`NET-039`,`NET-080`
  - Why/Problem: no multi-edge or failover; `direct` has no health-aware DNS.
  - Do: signed short-TTL `edge.alive` facts; deterministic healthy set; lowest-member-id healthy edge node performs idempotent DNS reconcile; DNS-01 so any node serves any host; per-connector health for tunnel edges; 30-60 s TTL and say so.
  - Done when: stopping one of two edge nodes moves traffic within the TTL window with no operator action.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C5; networking.md#6

- [ ] `NET-082` **C11 Microsegmentation from signed policy (node/identity level first)** · NEW · P2 · L · Deps: `NET-075`,`NET-049`
  - Why/Problem: no enforcement of who may reach what; `AllowedIPs=/32` binds source IP to a member but is not an ACL.
  - Do: replicated `mesh.policy` setting -> nftables sets on the mesh interface keyed by member mesh address; dry-run mode, lockout guard (always allow gossip/control port) and auto-rollback on lost handshake; service-level segmentation as a stretch.
  - Done when: an operator member can reach only door ports; a bad policy rolls back automatically.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C11
  - See also: `IDEA-034`

- [ ] `NET-083` **C6 Partition-tolerant "island mode" semantics, UI and chaos test** · NEW · P2 · M · Deps: `NET-073`
  - Why/Problem: Swarm raft cannot schedule in a minority partition; no partition detector or UI; Traefik polls the API so a restarted island node loses config.
  - Do: define island = reachable < roster total from `status()`; allowed actions per mode; on-disk last-good Traefik config on the door; UI banner; guided break-glass `--force-new-cluster` only; netns chaos test; exact wording ("keeps serving, cannot reschedule").
  - Done when: a partitioned site keeps serving local/private lanes, a restarted node serves from cached config, and re-converges.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C6

- [ ] `NET-084` **C7 Mesh-private preview URLs with shareable public escape hatch** · NEW · P2 · S · Deps: `NET-074`,`NET-085`, `DEPLOY-103`
  - Why/Problem: previews are public or SSO-gated elsewhere; private-by-default on a team's network is not offered; blocked by the previews rewrite.
  - Do: previews register routes with `visibility:"private"` and `<pr>-<svc>.<private domain>` names (no DNS leakage); promote = mark public for a TTL + share token.
  - Done when: a PR preview is reachable only on the mesh until promoted.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C7
  - See also: `DEPLOY-103`, `IDEA-046`

- [ ] `NET-085` **C8 Exposure-on-demand: temporary signed public share links** · NEW · P2 · M · Deps: `NET-076`,`NET-075`
  - Why/Problem: nothing ties a time-boxed public share to the lane model (Tailscale Funnel is standing exposure).
  - Do: capability `{route, exp, scope}` signed by the creator's ed25519 key; Traefik `forwardAuth` verifier checks signature, expiry and revocation (`share.revoked` setting); cookie exchange so tokens are not in URLs; rate limit; optional temporary edge provisioning.
  - Done when: a link works until expiry/revocation and dies when the issuing member is revoked.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C8

- [ ] `NET-086` **C18 `deployer proxy` port-forward to private services (identity-bound)** · NEW · P2 · S · Deps: `NET-075`,`NET-074`
  - Why/Problem: DBs need a public-port toggle today; identity-bound, audited laptop access to private services is missing.
  - Do: CLI opens a local port over the mesh to a service via a door-like forwarder on the owning node (overlay addresses are not directly routable from the host mesh).
  - Done when: `deployer proxy postgres:5432` reaches a private DB with no public port.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C18; bench-coolify.md#1 (databases public port)

- [ ] `NET-087` **C19 Signed multi-vantage health and uptime map** · NEW · P2 · M · Deps: `NET-063`, `OBS-030`
  - Why/Problem: single-vantage monitoring; alerts cannot tell "service down" from "my link down".
  - Do: members publish signed probe results; UI shows per-vantage uptime; feeds failover (NET-081) and locality routing (NET-089).
  - Done when: UI shows two vantages disagreeing for an asymmetric link.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C19
  - See also: `OBS-040`, `IDEA-075`

- [ ] `NET-088` **C20 Ephemeral invite capabilities (signed, TTL, max-uses, scope) minted by any member** · NEW · P2 · M · Deps: `NET-076`,`NET-078`
  - Why/Problem: join needs a one-time token held by the API (`mesh.controller.ts:597-645`); no offline/multi-use/TTL invite; wizard join UI unreachable.
  - Do: invite `{clusterId, issuer, exp, uses, scope}` signed by the issuer; use counts via append-only events (bounded overshoot under partition, documented); QR/one-liner.
  - Done when: an invite minted offline admits a node via any member and expires.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C20

- [ ] `NET-089` **C13 Locality- and latency-aware routing** · NEW · P3 · L · Deps: `NET-063`, `CLUSTER-038`
  - Why/Problem: Traefik round-robins across replicas; services are hardcoded to 1 replica today.
  - Do: publish `rtt.<memberId>`; per-node Traefik config variant weighted by RTT/locality via the derived token; hysteresis.
  - Done when: requests prefer local/near tasks with no flapping.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C13

- [ ] `NET-090` **C14 Data-gravity placement (site labels first slice)** · NEW · P3 · L · Deps: `NET-063`
  - Why/Problem: placement labels have no UI/API; "master election" metrics are invented constants.
  - Do: derive `deployer.site` automatically from LAN subnet clustering (S slice); `affinity`/`spread` on services to constraints; later RTT thresholds.
  - Done when: services declare affinity and the runner emits constraints on `node.labels.deployer.site`.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C14

- [ ] `NET-091` **C15 Peer-to-peer encrypted backups on the mesh** · NEW · P3 · L · Deps: `NET-077`,`NET-079`, `OPS-013`
  - Why/Problem: backups do not exist; peers could hold encrypted copies at other sites.
  - Do: N-replica/erasure-coded encrypted archives to K members with spare disk; signed manifest; repair loop.
  - Done when: restore works from any surviving peers.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C15
  - See also: `IDEA-029`, `FEAT-010`

- [ ] `NET-092` **C16 Offline-first signed desired state (nodes converge on signed intent)** · NEW · P3 · XL · Deps: DEC-NET-1
  - Why/Problem: strategic; duplicates Swarm's job and conflicts with the Postgres plan.
  - Do: decide first; per-service signed records with HLC, node-local reconciler for node-pinned workloads.
  - Done when: DEC-NET-1 resolved and a scoped design accepted.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C16; bench-market.md#5
  - See also: `IDEA-066`, `IDEA-058`

- [ ] `NET-093` **C17 Mesh-wide build offload (any member builds, others pull)** · NEW · P3 · M · Deps: `NET-079`
  - Why/Problem: build servers need SSH in competitors; capacity-aware peer builds are new.
  - Do: build job RPC over the mesh, source transfer, capacity labels, build sandbox for untrusted code.
  - Done when: a build runs on a chosen member and lands through C4.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C17
  - See also: `IDEA-051`, `DEPLOY-053`, `CLUSTER-077`

## Test coverage to add
- [ ] `NET-094` **Verification tests: `DomainVerificationService` unit + DNS e2e** · NEW · P0 · M · Deps: `NET-012`
  - Why/Problem: no tests for the verification service, `DomainProjectService`, or the instruction/verifier contract (the mismatch went unnoticed).
  - Do: unit tests for token/record generation vs verifier, backoff/retry, failed-row recovery; e2e with a scriptable authoritative DNS.
  - Done when: a contract test asserts instructions == what the verifier checks.
  - Status: todo · Verified-in-code: yes · Source: networking.md#3.19,#4.11

- [ ] `NET-095` **`DomainProjectService`, `DomainRoutingService`, domain-gate and route integration tests** · NEW · P1 · M · Deps: `NET-013`,`NET-015`
  - Why/Problem: no tests for these; verified-only routing and basePath behaviours need regression protection.
  - Do: service + integration tests incl. unverified-domain-not-routed, reserved hosts, controller requester test.
  - Done when: tests cover every J3 acceptance criterion 2-4.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.19,#4.11; journeys.md#quick win 1

- [ ] `NET-096` **`DirectEdgeProvider` and multi-node ACME tests** · NEW · P1 · M · Deps: `NET-029`
  - Why/Problem: no tests for `DirectEdgeProvider`.
  - Do: unit tests for ports/A records/ACME config; e2e with Pebble for HTTP-01 and DNS-01.
  - Done when: provider behaviours and failure modes are covered.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.19,#4.11

- [ ] `NET-097` **Preview provisioning (DNS/route/TTL) tests** · NEW · P2 · M · Deps: `NET-036`
  - Why/Problem: no tests for preview provisioning; cleanup/create name mismatch undetected.
  - Do: tests for account selection, naming parity with cleanup, tunnel coverage.
  - Done when: create/cleanup symmetric test passes.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3.19; projects-services.md#1.4

- [ ] `NET-098` **Controller authorization matrix for reachability, DNS, Cloudflare, mesh and domain controllers** · NEW · P0 · M · Deps: `NET-001`,`NET-003`,`NET-004`,`NET-005`
  - Why/Problem: no tests for the reachability controller; no negative authz tests (viewer 403, non-member 403).
  - Do: table-driven test per procedure x role (viewer/developer/admin/superAdmin, non-member); SSRF block-list tests.
  - Done when: every networking procedure has a role assertion.
  - Status: todo · Verified-in-code: yes · Source: networking.md#3.19,#4.11; journeys.md#J3 acceptance 7; projects-services.md#4.12
  - See also: `SEC-038`

- [ ] `NET-099` **NAT e2e (netns iptables: cone, port-restricted, symmetric) for STUN, link planning and relay** · NEW · P1 · L · Deps: `NET-058`,`NET-073`
  - Why/Problem: no real NAT traversal e2e; the netns script uses a flat bridge (`apps/mesh-agent/scripts/e2e-netns.sh`).
  - Do: extend netns harness with NAT topologies; assert candidate ports, relay fallback, direct migration, island chaos.
  - Done when: CI/nightly job passes for each NAT type.
  - Status: todo · Verified-in-code: yes · Source: networking.md#3.19,#4.11; ideas-mesh.md#C1,#C6

- [ ] `NET-100` **Playwright e2e `custom-domain.spec.ts` (journey J3)** · NEW · P1 · L · Deps: `NET-103`, `JRN-001`
  - Why/Problem: no browser e2e exists anywhere; J3 outline: Pebble ACME, scriptable DNS, mock Cloudflare, host-resolver rules.
  - Do: implement the 9-step outline: add domain, instructions panel, auto-verify within 60 s, cert issuing -> issued, HTTPS served by Pebble issuer, http->https redirect, negative cases (platform host, never-appearing TXT), removal, provider variant, viewer 403.
  - Done when: the spec passes nightly.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#J3 E2E outline
  - See also: `JRN-005`, `OPS-040`

- [ ] `NET-101` **Network UI tests (Mesh, Ingress & edge, DNS, Domains pages)** · NEW · P2 · M · Deps: none
  - Why/Problem: only one UI test file (`network.states.test.tsx`).
  - Do: component tests for edge form rendering from `edge.providers` descriptors, domain stepper states, mesh table states.
  - Done when: each page has loading/error/empty/data tests.
  - Status: todo · Verified-in-code: yes · Source: networking.md#1.2

- [ ] `NET-102` **Roster/agent tests for new semantics (CAS conflict, salt retry, expiry, checkpoints, relay planner)** · NEW · P1 · M · Deps: `NET-049`,`NET-059`,`NET-075`,`NET-076`
  - Why/Problem: new roster fields and conflict rules need property/gossip convergence tests (existing 21 roster + 4-node gossip tests are the base).
  - Do: add convergence tests for each new record kind and rule.
  - Done when: merge remains a total order with filter-before-compare under the new fields.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C3,#C10,#C21; networking.md#1.1

- [ ] `NET-103` **Network e2e fixtures: Pebble ACME, scriptable authoritative DNS, `mock-cloudflare`** · NEW · P1 · M · Deps: `JRN-001`
  - Why/Problem: no real Cloudflare/Let's Encrypt/DNS in CI; fixtures needed by NET-042, NET-096, NET-100.
  - Do: compose service definitions and fixtures implementing the zones/dns_records/tunnels subset used by `cloudflare.controller.ts`.
  - Done when: the J3 and tunnel e2e run against fixtures only.
  - Status: todo · Verified-in-code: no · Source: journeys.md#J3 E2E, #10 harness
  - See also: `OPS-040`

### Coverage-pass additions
- [ ] `NET-104` **Remove legacy reachability `getConfig`/`updateConfig` and dead web hooks** · FIX · P3 · S · Deps: none
  - Why/Problem: `updateConfig` ignores its input and just re-probes (`reachability.controller.ts:75-80`); `useUpdateReachabilityConfig`/`useReachabilityConfig` are unused; the public-access-point relay is the legacy shape superseded by lanes.
  - Do: delete the procedures, contract entries and unused hooks in both trees; keep only what previews still use and document it.
  - Done when: no reachability procedure ignores its input; no unused reachability hook remains.
  - Status: todo · Verified-in-code: yes · Source: networking.md#1.4, #5
- [ ] `NET-105` **Tests: declared-address wiring, prod `observe` dataplane failure, image pins, STUN-from-WG-port** · NEW · P1 · S · Deps: `NET-044`,`NET-045`,`NET-057`
  - Why/Problem: the hygiene bundle (NET-072) has no regression protection.
  - Do: unit tests that `publicAddress` reaches `meshAgentContainerEnv`, prod boot with `observe` fails, rendered env has no `latest`, STUN socket is the WG port.
  - Done when: each item has a failing-first test.
  - Status: todo · Verified-in-code: no · Source: networking.md#3.8, #3.14, #3.20
- [ ] `NET-106` **Mesh DNS resolver and split-horizon tests (partition survival, member names, private-lane answers)** · NEW · P2 · S · Deps: `NET-074`
  - Why/Problem: C2 touches host resolver config and must be reversible and partition-safe.
  - Do: resolver unit tests plus netns e2e: names resolve with no public DNS, after a partition, and rollback restores host config.
  - Done when: `api.deployer.internal` resolves on every member in the e2e.
  - Status: todo · Verified-in-code: no · Source: ideas-mesh.md#C2

- [ ] `NET-107` **Real multi-node mesh e2e, and the 12 mesh behaviours the monolith specs only listed as `it.todo`** · NEW · P2 · L · Deps: `ARCH-019`
  - Why/Problem: the monolith's `mesh-doc-compliance-matrix` listed behaviours documented in `FULL_MESH_HISTORY.md` as `it.todo` (removed with the matrix, step 8): (1) Global ownership durable stream integration against a real coordinator stream; (2) Node-owned routing resolved by the live ownership resolver and the remote SSE control plane; (3) Sharded fan-out: real multi-node SSE merge with the ownership resolver; (4) Replicated read path chooses the nearest/fastest replica by runtime policy; (5) Stream manager: persistent durable stream pool across the app lifecycle; (6) Real REQUEST flow over the distributed query engine with node call-many transport; (7) Real LISTEN flow over the distributed query engine with the server push envelope pipeline; (8) Promotion/demotion control frames (`mesh:promote` / `mesh:demote`) over a live SSE control channel; (9) SharedStreamStore acquire / release / has / snapshot / evict, reference-counted; (10) `computeStreamKey()` stream key derivation function; (11) `MeshStreamEventPayload` with namespace / entity / source / item / payload routing; (12) Stream manager persistent durable stream pool across app lifecycle (second pool variant of the above). No spec runs more than one mesh node: the two-instance harness test in `bff/src/e2e/platform-workflows/multi-instance.e2e-spec.ts` proves only that instances do not collide.
  - Do: build the multi-node e2e on that harness (or the mesh-6 rigs, `ARCH-019` history) and turn each item into a test or a recorded "not built".
  - Done when: each of the 12 is a passing test or a roadmap decision with a reason.
  - Status: todo · Verified-in-code: no · Source: e2e-port-plan.md (moved from `mesh-doc-compliance-matrix.e2e-spec.ts`)
- [ ] `NET-108` **`OwnershipResolverService` lists a node that answers `{ owns: false }` as an owner** · FIX · P2 · S · Deps: none
  - Why/Problem: `isOwnershipPayload` accepts any object and `resolveOwners` never reads `owns`, so a node that says it does not own the resource is still returned as an owner. `watchOwnership(resourceKey)` also ignores its argument and emits every resource's changes. Found porting the resolver spec, which leaves the first as `it.todo`.
  - Do: decide the `/ownership` answer contract (is a missing `owns` true?), enforce it, filter `watchOwnership` by key, enable the todo.
  - Done when: the todo test passes and a watcher of one resource sees only its own changes.
  - Status: todo · Verified-in-code: yes · Source: e2e-port-plan.md

## Decisions needed
- [ ] DEC-NET-1 Where does platform state live (Postgres replicas vs roster/log-replicated for network, secrets, audit, invites)? — options: all Postgres; hybrid (Postgres for projects/deployments, mesh for network/secrets/audit/invites); all mesh — recommendation: hybrid; blocks C16 (NET-092) and shapes NET-077/078/088.
- [ ] DEC-NET-2 Are members expected to relay for each other by default? — options: opt-out default with rate cap; opt-in per node label; — recommendation: opt-out default with rate cap.
- [ ] DEC-NET-3 Is a guest/operator member part of the product? — options: yes (C3/C8/C11/C20); no — recommendation: yes.
- [ ] DEC-NET-4 STUN privacy — options: external STUN allowed; operator-supplied STUN; self-hosted STUN on a gateway member — recommendation: operator-supplied default with external fallback toggle.
- [ ] DEC-NET-5 Swarm remains the scheduler (bounds island mode by raft)? — options: yes; swarm-free scheduler — recommendation: yes.
- [ ] DEC-NET-6 Interim stance on relay — options: implement relay now (NET-073); document NAT limitation with honest pre-flight (NET-061) — recommendation: NET-061 now, NET-073 next.
- [ ] DEC-NET-7 ACME strategy for multi-node `direct` — options: DNS-01 wildcard; shared ACME store; sticky challenge routing; single-node only — recommendation: DNS-01 wildcard via DNS accounts.
- [ ] DEC-NET-8 Default domain for services without a custom domain — options: lane domain only; auto sslip/nip-style domain; `*.deployer.localhost` — recommendation: lane domain with computed URL shown (NET-025).
- [ ] DEC-NET-9 Revocation model — options: any member (current); opt-in M-of-N quorum for sensitive actions — recommendation: keep default, add opt-in quorum (NET-069).
- [ ] DEC-NET-10 Verification scheme — options: TXT `_deployer-verify.<d>` = token only; add CNAME to a platform-owned name — recommendation: TXT only plus optional platform-owned CNAME.
- [ ] DEC-NET-11 DNS provider scope — options: implement Route53 and Google; hide them until implemented; manual only — recommendation: hide now, implement Route53 next.
- [ ] DEC-NET-12 Legacy single-node Traefik profile — options: delete; migrate dev compose to HTTP-provider ingress — recommendation: migrate then delete (NET-043).
- [ ] DEC-NET-13 `consoleVisibility` default — options: public; private/mesh-only; ask during setup — recommendation: private by default with explicit opt-in.

## Totals
108 items. Priority: P0 = 14, P1 = 45, P2 = 32, P3 = 17. Type: FIX = 41, ENHANCE = 13, NEW = 54. Plus 13 decisions (DEC-NET-1..13).
