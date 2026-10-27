# JOURNEYS + DOCS roadmap
> Owner prefix: JRN, DOC · Sources: journeys.md, parity.md (section 2), README.md, ROADMAP-AND-IDEAS.md, ops.md, setup.md, architecture.md, networking.md, docker-cluster.md, web.md, auth.md, deployments.md, projects-services.md, monolith-cutover.md, observability.md, bench-market.md · Last verified: 2026-10-26

## Summary
- JRN (journeys): 45 items (JRN-001..045). One Playwright harness, six journey e2e specs (J1..J6, all NEW), the 21 quick wins (one item each, owned by other areas but tracked here for sequencing), five phase-tracking items, and the new findings the earlier audit missed.
- DOC (docs): 46 items (DOC-001..046). Every stale or false doc claim from parity.md section 2 plus the other reports, three new docs to write (qa/setup, hardening guide, install and runbooks), a docs-in-same-change-set rule, and one item that reconciles contradictions between the audit reports themselves (verified against code in that item).
- Total 91 items (JRN 45 + DOC 46). Counts by priority (JRN+DOC): P0 6 · P1 52 · P2 26 · P3 7 (JRN: P0 6 · P1 33 · P2 6; DOC: P1 19 · P2 20 · P3 7).
- Counts by type: FIX 58 · ENHANCE 8 · NEW 25.
- JRN quick wins and journey specs now carry real owner-file IDs in `Deps:`; `See also:` marks the same work owned elsewhere (e.g. `JRN-001`=`OPS-040`, `JRN-004`=`DEPLOY-122`, `JRN-005`=`NET-100`, `JRN-006`=`OBS-087`, `DOC-030`=`SETUP-030`). Journeys depend on substrates `IDEA-001` (authz, = `SEC-001`), `IDEA-002` (release manifest), `IDEA-003` (event bus) for J2/J4/J6.
> Coverage pass: 2026-10-26 — 1 items added, 130 deps resolved
- Verified in this pass: `apps/api` imports `@repo/nest-*` while packages are `@deployer/nest-*` (cannot compile); no `playwright` dependency anywhere; `deployments/page.tsx:141` sends rollback without `targetDeploymentId`; two-BFF claim in setup.md has no code hits; `docs/qa/setup/` does not exist; root README is template text; `envNameSchema` is a strict 4-name enum; agentAuth plugin is exported but not registered in `auth.ts`.

## Items

### Playwright harness (F8)
- [ ] `JRN-001` **Create the Playwright e2e harness workspace `apps/e2e` and its support containers** · NEW · P1 · M · Deps: `DEPLOY-001` (so a deploy fixture can pass), `IDEA-001` (for viewer-403 assertions later); See also: `OPS-040` (same harness, tracked in OPS), `WEB-123`
  - Why/Problem: No Playwright or browser e2e exists anywhere (no `playwright` dependency in any `package.json`, re-checked); only Vitest + testcontainers API e2e (`apps/api/src/e2e`, `apps/api-services/bff/src/e2e`). Every journey acceptance criterion below is currently unverifiable. Journeys F8.
  - Do: Add workspace `apps/e2e` (Playwright Test), one project per journey, tags `@nightly` (J1, J5: need VM or DinD) and `@pr` (J2, J3, J4, J6). `stack` fixture drives `bun scripts/compose.ts --file docker-compose.services.dev-supervised.yml` (tier profile) and completes setup through the API so non-J1 specs start signed in; J1 uses the real installer. One support compose with `gitea` (git host + webhooks), `pebble` + challenge test server (ACME), scriptable authoritative DNS, `mailpit` (SMTP + API), `mock-cloudflare` (zones/dns_records/tunnels subset used by `cloudflare.controller.ts`), `webhook-sink`. J5 reuses `infra/docker/compose/docker-compose.mesh-6.dev-supervised.yml` + `apps/mesh-agent/scripts/e2e-netns.sh` patterns. Rules: selectors by role/label (web already has 451 `aria-*` usages), trace on first retry, per-journey time budget asserted as a test (J1 <= 5 min), video only on failure. No real GitHub/Cloudflare/Let's Encrypt in CI.
  - Done when: `bun run e2e` (or equivalent script) boots the stack and the support containers, runs one smoke spec green locally and in CI (nightly job at minimum), and the harness is documented in `apps/doc`.
  - Status: todo · Verified-in-code: yes (absence of Playwright) · Source: journeys.md#10, #9 new finding 10

- [ ] `JRN-002` **Wire the e2e harness into CI as a non-blocking then blocking gate** · NEW · P2 · S · Deps: `JRN-001`, `OPS-024` (green quality gate), `OPS-023` (CI gating deploy.yml)
  - Why/Problem: Browser e2e is listed as missing in ops.md (item 19) and README P2; journeys tag specs `@pr` / `@nightly`.
  - Do: Add a `@pr` job (J2, J3, J4, J6 specs) and a nightly job (J1, J5) to `.github/workflows/ci.yml`; non-blocking until stable, then required before `deploy.yml`.
  - Done when: CI shows both jobs, artifacts (trace, video on failure) uploaded, and deploy is gated on the `@pr` job.
  - Status: todo · Verified-in-code: unverified · Source: journeys.md#10, ops.md#4 item 19

### Journey e2e specs
- [ ] `JRN-003` **J1 e2e: first-run install to first deploy in under 5 minutes (`first-run.spec.ts`)** · NEW · P1 · M · Deps: `JRN-001`, `OPS-006` (installer), `OPS-004` (published images), `SETUP-003` (claim token), `SETUP-002` (lock `/setup/*`), `SETUP-001` (admin bootstrap never default), `SETUP-021` (Address step), `DEPLOY-001` (no `nginx:alpine`), `PROJ-060` (seed default environments), `IDEA-001`; See also: `SETUP-037`
  - Why/Problem: Nothing in the chain from install step 1 to 3 works on a fresh VPS (prod compose `build-api` builds the non-compiling monolith, `docker-compose.prod.yml:40`; no installer; no claim token; hostnames hard-coded `*.deployer.localhost`); steps 13-18 of the first deploy are silently wrong (journeys J1 verdict).
  - Do: Fixtures `stack` (clean VM or DinD running `install.sh` against a local registry) and `gitHost` (Gitea serving `fixtures/hello-http` with a Dockerfile). Steps: (1) run installer, capture claim URL, assert exit 0 and < 180 s; (2) open claim URL in a fresh context, assert `/setup/trigger` without token returns 401; (3) fill account, keep default address, assert progress reaches "Dashboard ready", Continue; (4) assert checklist visible, click New, paste Gitea URL, assert detected builder "Dockerfile"; (5) click Deploy, assert stage timeline advances and a `Step 1/..` build log line appears; (6) assert **Open** link appears and `request.get(url)` returns 200 body `hello`; (7) `docker restart` all platform containers, assert still signed in and `user` count == 1; (8) negative: repo without Dockerfile -> deployment `failed` with message containing "Dockerfile". Tag `@nightly`.
  - Done when (acceptance): (1) clean Ubuntu 24.04 + Docker only: installer reaches signed-in dashboard in <= 3:00 (warm registry cache) with no prompts besides the wizard; (2) `/setup/*` returns 401/409 without claim token and after completion; (3) after `docker restart` of every platform container exactly one admin exists; (4) public Dockerfile repo deploys via Quick deploy, HTTP 200 on displayed URL within 2:00 of Deploy; (5) no-Dockerfile repo fails naming the missing file, no `nginx:alpine` anywhere; (6) displayed URL loads from another machine over HTTPS.
  - Status: todo · Verified-in-code: yes (blocking gaps re-read) · Source: journeys.md#J1

- [ ] `JRN-004` **J2 e2e: deploy a repo, ship by push, previews, rollback, env/secrets (`deploy-and-ship.spec.ts`)** · NEW · P1 · L · Deps: `JRN-001`, `DEPLOY-001`, `DEPLOY-003` (honest deploy + persisted plan), `DEPLOY-074` (real rollback), `DEPLOY-017` (real cancel), `DEPLOY-014` (durable queue), `DEPLOY-092`, `DEPLOY-093`, `DEPLOY-095` (webhooks: raw-body HMAC, dedupe, push dispatch), `DEPLOY-103` (real PR previews), `DEPLOY-028` (private repo clone), `PROJ-020`, `PROJ-021` (encrypted env + masking), `IDEA-001`, `IDEA-002`; See also: `DEPLOY-122` (same spec, tracked in DEPLOY)
  - Why/Problem: Webhooks always 401 and push is skipped, previews never build, rollback is invalid from the UI and a silent no-op in the live tier, cancel is a DB flip, retry drops plan and env, env vars plaintext (journeys J2 steps 1-21).
  - Do: Fixtures `gitHost` (Gitea with webhooks to the platform), `fakeGithubSigner` (GitHub-shaped deliveries signed with the real secret), `stack`. Steps: (1) admin creates project `shop`, connects provider via PAT; (2) new service from `gitea/fixtures/web` main, assert detected builder/port, Deploy, wait `success`, URL returns `v1`; (3) set env `GREETING=hi` (secret on), redeploy, page prints `hi`, API `service.findById` returns `***`, DB column is ciphertext (test-only SQL); (4) push commit changing page to `v2`, new deployment appears without clicking, `success`, URL returns `v2`; (5) push `fail.txt`-marked commit breaking `/health`, poll URL every 500 ms during deploy, always `v2`, deployment `failed`, banner mentions "Still serving"; (6) rollback to v1 from table, URL returns `v1`, no `docker build` log line; (7) open PR, preview URL returns PR content, close PR, URL 404 within 60 s; (8) slow build + Cancel, `cancelled` after 10 s, no builder in `docker ps`; (9) replay step-4 delivery with same `x-github-delivery` -> `duplicate_delivery`, no new row; wrong signature -> 401; (10) viewer collaborator: Deploy/Rollback/Delete absent, API 403.
  - Done when (acceptance): (1) push to tracked branch -> `success` and new content within 90 s, commit status posted; (2) bad signature / replayed delivery / other-branch push -> 401 / `duplicate` / `skipped`, no deployment; (3) failing health gate keeps old content with 0 failed requests; (4) rollback to N-1 restores content in < 15 s without `docker build`; (5) env change shows "redeploy needed", plaintext never in any API body, log or job payload (DB grep no hits); (6) PR gets a distinct URL, closing removes route/DNS/container within 1 min; (7) cancel during build stays `cancelled`, build process gone; (8) viewer sees no destructive controls and gets 403 per action.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#J2

- [ ] `JRN-005` **J3 e2e: custom domain with HTTPS (`custom-domain.spec.ts`)** · NEW · P1 · L · Deps: `JRN-001`, `NET-010`, `NET-011`, `NET-012` (verification fixes), `NET-015` (routes from live mappings + ingress refresh), `NET-028`, `NET-029`, `NET-032` (ACME email, HTTP-01, cert table), `NET-001` (DNS/tunnel authz), `IDEA-001`; See also: `NET-100` (same spec, tracked in NET), `NET-103`
  - Why/Problem: Verify is Forbidden for everyone (`domain-project.service.ts:176`), instructions and verifier mismatch, routing frozen at deploy time, free-text domains bypass verification (journeys J3 steps 1-13).
  - Do: Fixtures `pebble`, `dns` (small authoritative resolver the test mutates), `mockCloudflare`; Chromium with `--host-resolver-rules="MAP *.e2e.test <node ip>"` and Pebble root trusted. Steps: (1) edge `direct` with ACME email, deploy fixture service; (2) add `app.e2e.test` on project page, instructions panel shows TXT `_deployer-verify.app.e2e.test`; (3) status "waiting for DNS", write TXT, flips to `verified` <= 60 s without click; (4) cert step issuing -> issued with notAfter, `page.goto(https://app.e2e.test)` works, issuer is Pebble; (5) `http://` redirects to https; (6) negative: `api.<platform domain>` rejected, never-appearing TXT stays pending naming what it looked for; (7) remove domain, HTTPS fails within 15 s; (8) provider variant: "Create records for me" creates TXT + A on `mockCloudflare`; (9) viewer: add/verify controls hidden, `POST dns record` returns 403.
  - Done when (acceptance): (1) both domain pages show the same instructions, correct records verify without pressing anything within 2 min of propagation; (2) Verify OK for owner/maintainer, 403 for viewer; (3) pending/failed domain never in `GET /traefik/config`, platform host rejected at add; (4) bind/remove changes routing within 10 s without redeploy; (5) handshake cert is for exactly that name, `http://` redirects 301/308; (6) no ACME email blocks enabling public TLS with a message; (7) viewer cannot call DNS/Cloudflare/tunnel procedures nor read the tunnel token.
  - Status: todo · Verified-in-code: partial · Source: journeys.md#J3

- [ ] `JRN-006` **J4 e2e: debug a failing service (`debug-failing-service.spec.ts`)** · NEW · P1 · L · Deps: `JRN-001`, `OBS-059`, `OBS-060` (real logs + retention), `OBS-031`, `OBS-033` (status model + explainer), `OBS-045` (metrics history), `OBS-012`, `OBS-014` (dispatcher + webhook channel), `OBS-071`, `OBS-073` (audit log/History tab), `CLUSTER-034`, `CLUSTER-035` (node-aware docker), `SEC-003`, `CLUSTER-001` (exec role gate), `IDEA-001`, `IDEA-003`; See also: `OBS-087` (same spec, tracked in OBS)
  - Why/Problem: Service Logs tab is synthesized sentences, overview status always "unknown" (`services/[serviceId]/page.tsx:150`), no health probes, no alerts, no audit, every docker procedure is `requireAuth()` only (journeys J4 steps 1-14).
  - Do: Fixtures `crashingApp` (logs `BOOM: missing DATABASE_URL`, exits 1 after 3 s unless `DATABASE_URL` set), `webhookSink`, `mesh6`. Steps: (1) admin deploys crashingApp, badge "Crash-looping" <= 60 s; (2) explainer card shows `BOOM: missing DATABASE_URL` and exit code 1; (3) Logs tab has the line, `docker rm -f` the replica, reload, line persists; (4) Metrics chart >= 2 points, wait 30 s, reload, history preserved; (5) Shell `env | grep DATABASE` on a running replica of a second fixture; (6) webhook channel -> sink, "Send test" delivers signed payload, crash alert delivered exactly once per incident; (7) "Edit env" CTA sets `DATABASE_URL`, redeploy, status Running, "resolved" delivered; (8) History shows env change with actor and no value; (9) viewer context: Shell disabled, `container.exec` returns 403; (10) mesh6: replica on node 2, logs render from node 1 UI.
  - Done when (acceptance): (1) crash-loop status within 60 s, card quotes `BOOM`, Logs tab has the exact line even after container removal; (2) node-2 replica logs render from node 1; (3) Metrics shows >= 15 min history after reload; (4) viewer 403 on exec/kill/remove/env-read, maintainer shell produces an audit entry with actor and container; (5) webhook gets a signed JSON within 30 s of `service.down`, no second delivery while still down; (6) History lists "<user> changed env var X on web (production)" without the value; (7) no page in the journey uses `as any` mutations or polls where a stream exists.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#J4

- [ ] `JRN-007` **J5 e2e: add, drain, replace a node (`node-lifecycle.spec.ts`)** · NEW · P1 · L · Deps: `JRN-001`, `CLUSTER-019` (Add-node dialog), `CLUSTER-016`, `CLUSTER-017` (lifecycle procedures + quorum pre-check), `CLUSTER-018` (remove saga), `CLUSTER-002` (strip join tokens), `CLUSTER-009` (truthful node health), `DEPLOY-058`, `DEPLOY-051` (swarm default + registry push), `NET-057`, `NET-061` (declared addresses / relay honesty), `CLUSTER-025` (node-down notifications), `IDEA-001`; See also: `CLUSTER-082`
  - Why/Problem: No Add node UI, no drain/promote/remove contract, join tokens (manager too) returned to every user, guarded cluster table dead, crashed node stays "active" (journeys J5 steps 1-15).
  - Do: Fixtures `mesh6`, `nodeShell`, `prober` (HTTP load generator recording failures), `mockCloudflare`. Steps: (1) node 1 UI shows 1 node + "Add a second node" empty state; (2) Add node (worker, region=eu), grant countdown + one-liner, run in node 2 via `nodeShell`; (3) stages tick (mesh admitted -> swarm joined -> ready) <= 180 s, node 2 appears with label region=eu; (4) deploy 2-replica fixture, one task per node, start `prober`; (5) drain node 2, dialog shows task count, confirm, tasks move, `prober` failures == 0, "Safe to remove"; (6) demote the only manager refused with quorum text; (7) remove node 2 (type its name): absent in UI, `docker node ls`, roster, DNS fixture, audit entry exists; (8) stop node 3's Docker engine: Down within 60 s and webhook alert; (9) replace node 3 with node 4: checklist completes, labels copied; (10) viewer: controls absent, `cluster.getSwarmConfig` response has no token fields.
  - Done when (acceptance): (1) admin adds a worker from UI <= 3 min after running the one-liner, viewer has no controls and gets 403; (2) no API response or log line for a non-admin contains a join token; (3) drain moves all replicated tasks with 0 failed requests at 10 req/s; (4) demote/drain/remove of last manager refused with quorum explanation; (5) after removal node absent from `docker node ls`, roster (left/revoked), fleet servers list, DNS A records, `node_network_config`; (6) stopped-engine node shows Down within 60 s and alert is sent.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#J5

- [ ] `JRN-008` **J6 e2e: team collaboration, invites, roles, approvals, audit (`team-collaboration.spec.ts`)** · NEW · P1 · L · Deps: `JRN-001`, `AUTH-001`, `AUTH-002`, `AUTH-009` (close sign-up + fix invite plugin), `AUTH-010` (Members page + accept page), `AUTH-015` (mail transport), `PROJ-110`, `PROJ-006` (project invites + role hierarchy), `PROJ-001`, `PROJ-002` (membership scoping), `WEB-016` (project-role-aware UI), `DEPLOY-009` (approvals gate), `OBS-071` (audit log), `AUTH-013` (revoke sessions), `IDEA-001`, `IDEA-003`
  - Why/Problem: Sign-up open at API (`packages/auth/src/server/auth.ts:117`), any user can mint a superAdmin invite (`plugins/index.ts:136-146`), no invite UI/accept page/mail, reads not membership-scoped, approvals unenforced, no audit (journeys J6 steps 1-13).
  - Do: Fixtures `mailpit`, `stack`, three Playwright contexts (`admin`, `dev`, `viewer`). Steps: (1) admin Members -> Invite `dev@example.test` as `operator` with project grant `deployer` on `shop`, pending row; (2) read invite email from `mailpit`, `dev` opens link, sets password, dashboard shows only `shop`; (3) admin invites `viewer@example.test` (no account) from project Team page, pending, accept in `viewer` context; (4) viewer: no Deploy/Delete/Shell controls, API 403, direct URL to another project shows no-access state; (5) enable "Require approval for production", `dev` triggers production deploy -> `awaiting_approval`, no build log; (6) admin Approves with comment, deployment runs to `success`, `dev` cannot approve own request; (7) webhook push to production branch also becomes `awaiting_approval`; (8) admin demotes `dev` to `viewer`, next `dev` API call 403 within 5 s without re-login; (9) Audit filtered by project: rows for invite, role changes, deploy request, approval, demotion; export CSV, row count matches; (10) negative: unauthenticated `POST /api/auth/sign-up/email` 4xx, non-admin `invite/create` 403.
  - Done when (acceptance): (1) sign-up returns 4xx in prod config, non-admin invite 403, admin cannot invite above own role; (2) invited user with no account accepts via link, sees only granted projects; (3) non-member gets 404/403 on `project.findById`, `service.findById`, `deployment.list`, logs, streams; (4) viewer sees no destructive controls and API returns 403; (5) with `requireApprovalForProduction`, UI and webhook deploys stay `awaiting_approval` until a maintainer approves, no self-approval unless sole owner; (6) every mutation yields exactly one audit row (actor, resource, redacted diff), export matches filter; (7) demote/ban terminates sessions within 5 s.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#J6

- [ ] `JRN-009` **Track "which P0 items block which journey" matrix as the e2e unblock order** · ENHANCE · P2 · S · Deps: `JRN-003`..`JRN-008`
  - Why/Problem: journeys.md section 8 maps audit P0/P1 items to hard (blocker) or weakening gaps per journey: J1 and J5 are gated by installer/topology (#8, #11); J2 by honest deploys + webhooks + secrets; J3 by authz + domain correctness; J4 by build-log/status honesty and notifications; J6 by auth P0s and the authorization layer. Without this a future agent may start a journey spec whose blockers are not done.
  - Do: Keep a short "blocked by" header comment in each journey spec listing the hard-blocker roadmap IDs (secrets, backdoors, sign-up/invites, setup lock, authz, injection, honest deploys, one topology, migrations, backups, reproducible install, green gate, webhooks/previews, swarm default+registry, env/secrets, notifications, health monitoring, domains, cluster ops/mesh gaps, auth completeness, frontend fixes) and re-evaluate when they close.
  - Done when: each spec file header lists current blockers and the list is empty before the spec is moved from `test.fixme` to required.
  - Status: todo · Verified-in-code: no · Source: journeys.md#8

### Quick wins (each < 1 day; owner area does the work, tracked here for the journey sequencing)
- [ ] `JRN-010` **QW1 Domain Verify: pass the real requester** · FIX · P1 · S · Deps: `NET-010`; See also: `NET-010` (same work, NET owns)
  - Why/Problem: Controller passes no user; service calls `assertProjectAccess(projectId, "verify")` so requesterId is the string "verify" and Forbidden for everyone including the owner. Evidence `apps/api-services/services/project/src/modules/domain/services/domain-project.service.ts:176`, `.../controllers/project-domain.controller.ts:~67-72`, `shared/.../project-access.service.ts:33-40` (from journeys, re-read there).
  - Do: Pass `context.auth.session.user.id` through `verifyProjectDomain`; add a controller test.
  - Done when: owner/maintainer Verify succeeds, viewer gets 403; controller spec covers both.
  - Status: todo · Verified-in-code: yes (per journeys re-read) · Source: journeys.md#7 QW1

- [ ] `JRN-011` **QW2 Show verification instructions after adding a domain, add Verify button** · FIX · P1 · S · Deps: `NET-011`, `JRN-010`; See also: `WEB-056`, `NET-019`
  - Why/Problem: `projects/[projectId]/domains/page.tsx:35-41` discards the `verificationInstructions` the API returns; `ProjectDomainRow.tsx` has no Verify action.
  - Do: Post-add panel rendering the returned instructions; Verify button on the row.
  - Done when: both domain pages (`projects/[id]/domains` and `network/domains`) show identical instructions and a Verify control.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW2

- [ ] `JRN-012` **QW3 GitHub PR webhook: resolve service via `findServiceBySourceUrl`** · FIX · P1 · S · Deps: `DEPLOY-094` (port of monolith fix); See also: `DEPLOY-094`
  - Why/Problem: `fleet/.../github.webhooks.controller.ts:138-140` sets `serviceId = payload.repository.full_name` placeholder; repository already has `findServiceBySourceUrl` (`github-apps.repository.ts:255`); monolith fixed at `apps/api/.../github.webhooks.controller.ts:212-222`.
  - Do: Port the monolith resolution into the fleet controller. Preview build itself still needs the previews item.
  - Done when: a PR event resolves to the real service id (unit test) and unknown repos are skipped with a reason.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW3

- [ ] `JRN-013` **QW4 Admin bootstrap default `never`; remove `adminadmin` fallbacks** · FIX · P0 · S · Deps: `SETUP-001`, `AUTH-005` (audit P0 #2); See also: `SETUP-001`, `AUTH-005`
  - Why/Problem: Default decision `always` falling back to `admin@admin.com` / `adminadmin` in both trees: `apps/api/src/core/admin-bootstrap/admin-bootstrap-policy.ts:~101`, `apps/api-services/shared/src/core/admin-bootstrap/default-admin.bootstrap.ts:48,50` (line 50 `passwordRaw.length > 0 ? passwordRaw : "adminadmin"` re-read).
  - Do: Default `never`, delete fallbacks, fail boot if a known-password admin would be created.
  - Done when: after restart `user` table has exactly one admin chosen in the wizard; grep for `adminadmin` returns no source hits.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#7 QW4

- [ ] `JRN-014` **QW5 `disableSignUp: true` (dev behind flag) and pass `canCreateInvite`** · FIX · P0 · S · Deps: `AUTH-001`, `AUTH-002` (audit P0 #3); See also: `AUTH-001`, `AUTH-002`
  - Why/Problem: `packages/auth/src/server/auth.ts:117` leaves email sign-up open; `plugins/index.ts:136-146` `useInvite()` drops options so `canCreateInvite` never set.
  - Do: Disable sign-up at API unless a dev flag is set; pass admin-only `canCreateInvite`; add tests.
  - Done when: `POST /api/auth/sign-up/email` returns 4xx in production config; non-admin invite create returns 403.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#7 QW5

- [ ] `JRN-015` **QW6 Strip `joinTokens` from snapshot / swarm-config responses** · FIX · P0 · S · Deps: `CLUSTER-002` (audit P0 #5); See also: `CLUSTER-002`, `SEC-005`
  - Why/Problem: Worker and manager join tokens go to every authenticated user: `swarm-cluster.service.ts:165,208`, `swarm-participation.service.ts:426-445`, `apps/web/.../swarm-config-panel.tsx:94`.
  - Do: Remove from `getSnapshot`, `streamSnapshot`, `getSwarmConfig`; expose only through an admin "issue join" procedure.
  - Done when: JSON-schema assertion shows no token fields for any non-admin; web panel updated.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#7 QW6

- [ ] `JRN-016` **QW7 `requirePlatformRole(["superAdmin","admin"])` on docker exec/terminal/kill/remove and all `cluster.*` mutations** · FIX · P0 · S · Deps: `IDEA-001` (interim per-handler gate until policy layer); See also: `CLUSTER-001`, `SEC-003`, `SEC-004`
  - Why/Problem: Every docker procedure is `requireAuth()` only (`runtime/.../docker/controllers/docker.controller.ts:240-290,...`, `cluster.controller.ts:19-131`): a viewer can exec, kill, remove, read env.
  - Do: One `.use()` per handler; 403 test per controller.
  - Done when: viewer receives 403 on each listed procedure in a controller spec.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#7 QW7

- [ ] `JRN-017` **QW8 Remove the `nginx:alpine` fallback; default builder to `dockerfile` when a Dockerfile exists** · FIX · P0 · S · Deps: `DEPLOY-001` (audit P0 #7, first half); See also: `DEPLOY-001`
  - Why/Problem: `docker-runtime-runner.service.ts:38`, `swarm-runtime-runner.service.ts:99`, trigger at `deployment.service.ts:457`; builder returns null fallback (`deployment-artifact-builder.service.ts:65-67`) so a missing image is reported `success`.
  - Do: Missing image => deployment `failed` with a message naming the missing file; auto-pick `dockerfile` if present.
  - Done when: repo with no Dockerfile and no builder fails; grep for `nginx:alpine` in runners returns none.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#7 QW8

- [ ] `JRN-018` **QW9 Rollback must not lie; UI sends `targetDeploymentId`** · FIX · P1 · S · Deps: `DEPLOY-074` (replaces interim); See also: `DEPLOY-075`, `DEPLOY-076`, `WEB-005`
  - Why/Problem: `deployments/page.tsx:141` sends `{ params: { id } } as any` while contract requires `body.targetDeploymentId` (`crud.ts:233-236`); worker marks rollback `success` without a runner (`deployment.service.ts:1396-1411`); fake rows are ignored by routing (`platform-routes-source.service.ts:224-225`).
  - Do: Until real rollback lands, fail with "not supported"; in the UI choose the previous successful deployment and send the body.
  - Done when: no rollback row is ever `success` without a run; UI call validates.
  - Status: todo · Verified-in-code: yes (UI call re-read) · Source: journeys.md#7 QW9

- [ ] `JRN-019` **QW10 Real service logs first cut** · FIX · P1 · S · Deps: `OBS-059`; See also: `WEB-001`
  - Why/Problem: `logs/page.tsx:73-95` and `logs/_utils/service-activity.ts:44-55` synthesize sentences ("KNOWN GAP — these are not log lines"); real hooks `useDockerContainerLogsStream`/`Snapshot` (`domains/docker/hooks.ts:1030,1044`) exist unwired.
  - Do: Replace `projectServiceActivity` with the hooks + `useDeploymentLogs`; label as local node only.
  - Done when: service Logs tab shows container stdout/stderr.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW10

- [ ] `JRN-020` **QW11 Build output into deployment logs** · FIX · P1 · S · Deps: `DEPLOY-044`; See also: `DEPLOY-044`, `IDEA-097`
  - Why/Problem: `docker.service.ts:455` never captures build output; `followStream` already takes a per-line callback (`:1152`).
  - Do: Pass `onProgressLine` from `buildImage` to `insertLog` (`deployment-artifact-builder.service.ts:~175`).
  - Done when: a failed Dockerfile build shows the Docker error lines in the deployment log.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW11

- [ ] `JRN-021` **QW12 Service overview status from latest deployment** · FIX · P1 · S · Deps: `OBS-031` (or BFF `serviceDetail`); See also: `OBS-032`, `WEB-003`, `PROJ-122`
  - Why/Problem: `services/[serviceId]/page.tsx:150` reads `s.status ?? s.state ?? 'unknown'`; fields do not exist so it is always "unknown".
  - Do: Derive status from latest deployment, or consume BFF `serviceDetail`.
  - Done when: badge shows real status.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW12

- [ ] `JRN-022` **QW13 Env "Config" link: pass environment id, not name** · FIX · P1 · S · Deps: `WEB-002`; See also: `WEB-002`, `PROJ-064`
  - Why/Problem: `configuration/environment/page.tsx:165-166` passes the env name where a UUID is required => "Environment not found".
  - Do: Pass the id.
  - Done when: link opens the environment config.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW13

- [ ] `JRN-023` **QW14 Seed default environments in `createProject`** · FIX · P1 · S · Deps: `PROJ-060`; See also: `PROJ-060`
  - Why/Problem: `project.service.ts:75-100` creates no environments, so the deploy dialog says "No environments defined".
  - Do: Seed production/staging/preview/development on create.
  - Done when: new project lists four environments.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW14

- [ ] `JRN-024` **QW15 Docker runner: attach to platform overlay, stop prior container after new is healthy** · FIX · P1 · S · Deps: `DEPLOY-056`, `DEPLOY-057` (stopgap until `DEPLOY-058`); See also: `DEPLOY-056`, `DEPLOY-057`
  - Why/Problem: `docker-runtime-runner.service.ts:60,73`: container is not on the overlay unless `DEPLOYER_NETWORK_MODE` is set, so Traefik cannot resolve it; old containers never removed.
  - Do: Default attach when `networkMode` unset; stop previous containers of the same service after health pass.
  - Done when: default deploy is reachable through the lane host and old containers disappear.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW15

- [ ] `JRN-025` **QW16 Wire `ClusterNodesTable` (quorum confirm) into `/dashboard/cluster`** · FIX · P1 · S · Deps: `CLUSTER-023`; See also: `CLUSTER-023`, `WEB-004`
  - Why/Problem: `cluster/page.tsx:63-86` calls `updateNode.mutate` immediately; guarded `cluster-nodes-table.tsx` + confirm dialog exist and are imported nowhere.
  - Do: Use the guarded table, delete the inline one.
  - Done when: role/label edits require confirmation with quorum text.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW16

- [ ] `JRN-026` **QW17 Require ACME email when a public TLS lane is enabled** · FIX · P1 · S · Deps: `NET-028`; See also: `NET-028`
  - Why/Problem: `packages/config/env/src/index.ts:255` defaults `admin@example.com` which Let's Encrypt rejects.
  - Do: No default; block enabling public TLS without it with a clear message.
  - Done when: enabling TLS without email is refused.
  - Status: todo · Verified-in-code: yes (per journeys/ops R-16) · Source: journeys.md#7 QW17

- [ ] `JRN-027` **QW18 Use `projects/_utils/trigger-source.ts` in the deploy page, drop `as any`** · ENHANCE · P2 · S · Deps: `WEB-008`; See also: `WEB-008`, `DEPLOY-110`
  - Why/Problem: `deployments/page.tsx:96-114` builds source for github only with `as any`; helper is written and unused.
  - Do: Adopt the helper and typed payload.
  - Done when: no `as any` in the page's mutations.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW18

- [ ] `JRN-028` **QW19 Show the computed lane URL next to a deployment/service** · FIX · P1 · S · Deps: `DEPLOY-068`; See also: `DEPLOY-068`, `NET-025`, `WEB-011`
  - Why/Problem: `deployment.domainUrl` is set only from domain mappings (`deployment-execution-workflow.service.ts:~600`; `domain-routing.service.ts:143-145` returns `no_domain_mappings`), so a default deploy shows no URL although the lane route exists.
  - Do: Compute `<service>-<project>.<lane domain>` and show in `deployment-detail.tsx:60` and service header.
  - Done when: Open link appears for any routed deployment.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW19

- [ ] `JRN-029` **QW20 Team page shows email/name; call `assertNotOwnerGrant`** · FIX · P1 · S · Deps: `PROJ-006`; See also: `PROJ-006`, `PROJ-112`, `WEB-027`
  - Why/Problem: `team/page.tsx:86` shows `userId`; `assertNotOwnerGrant` (`project.entity.ts:~212`) is defined and never called in `project.service.ts:165-228`.
  - Do: Resolve user display; call the guard on invite/update.
  - Done when: names shown; granting owner via invite is rejected.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW20

- [ ] `JRN-030` **QW21 Delete the free-text `customDomains` path or force it through verification** · FIX · P1 · S · Deps: `NET-013`, `NET-014`; See also: `NET-014`, `WEB-013`, `JRN-039`
  - Why/Problem: `platform-routes-source.service.ts:233` publishes `service.customDomains` (wizard step `StepDomains.tsx:145`) as a public host with no verification.
  - Do: Remove the field or route it through domain verification.
  - Done when: an unverified host never appears in generated routes.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#7 QW21

### Phased plan tracking (journeys sequencing, 13 weeks one team)
- [ ] `JRN-031` **Phase 0 (week 1): harness skeleton + quick wins 1-9, 14, 16, 17** · NEW · P1 · M · Deps: `JRN-001`, `JRN-010`..`JRN-018`, `JRN-023`, `JRN-025`, `JRN-026`
  - Why/Problem: Cheapest regression prevention; makes J3 verify work; lands slices of audit P0 #2/#3/#5. Note ROADMAP-AND-IDEAS Phase 0 also lists removing committed secrets, killing backdoors and real service logs.
  - Do: Execute the listed items.
  - Done when: all listed items checked; smoke e2e green.
  - Status: todo · Verified-in-code: no · Source: journeys.md#10

- [ ] `JRN-032` **Phase 1 (weeks 2-5): honest deploy, env encryption + masking, service logs/status/failure explainer, authz core** · NEW · P1 · XL · Deps: `DEPLOY-001`, `DEPLOY-003`, `DEPLOY-004`, `DEPLOY-044`, `DEPLOY-017`, `DEPLOY-074` (F2), `PROJ-020`, `PROJ-021`, `OBS-059`, `OBS-031`, `OBS-033`, `IDEA-001`, `IDEA-002`
  - Why/Problem: Unblocks J2 (without webhooks) and J4 core.
  - Do: Execute W2.1, W2.12, W2.4, W2.5, W2.2, W2.11, W4.1, W4.4, W4.5 and F1 core (owner files hold the IDs).
  - Done when: J2 steps 1-3, 6, 8 and J4 steps 1-4 of the e2e pass.
  - Status: todo · Verified-in-code: no · Source: journeys.md#10

- [ ] `JRN-033` **Phase 2 (weeks 4-8): installer/images/claim/address and domains/TLS** · NEW · P1 · XL · Deps: `OPS-004`, `OPS-005`, `OPS-006`, `SETUP-003`, `SETUP-021`, `NET-010`, `NET-015`, `NET-019`, `NET-028`, `NET-029` (domains/TLS W3.2-W3.5, W3.8)
  - Why/Problem: Unblocks J1 and J3.
  - Do: Execute F5 + W1.1-W1.7 and W3.2-W3.5 + W3.8.
  - Done when: `JRN-003` and `JRN-005` green.
  - Status: todo · Verified-in-code: no · Source: journeys.md#10

- [ ] `JRN-034` **Phase 3 (weeks 6-10): webhooks/previews, notifications + audit, team/approvals** · NEW · P1 · XL · Deps: `DEPLOY-013` (F3), `DEPLOY-092`, `DEPLOY-095`, `DEPLOY-103`, `DEPLOY-104`, `OBS-012`, `OBS-071`, `AUTH-010`, `PROJ-110`, `DEPLOY-009`, `IDEA-003`
  - Why/Problem: Unblocks J2 full, J4 alerts, J6.
  - Do: Execute F3 + W2.8-W2.10, F4 + W4.10/W4.11/W6.8, W6.1-W6.7.
  - Done when: `JRN-004` and `JRN-008` green and J4 alert steps pass.
  - Status: todo · Verified-in-code: no · Source: journeys.md#10

- [ ] `JRN-035` **Phase 4 (weeks 8-13): swarm default + registry, node lifecycle, metrics + probes, mesh gaps** · NEW · P1 · XL · Deps: `DEPLOY-058` (F7), `DEPLOY-051`, `CLUSTER-016`, `CLUSTER-017`, `CLUSTER-018`, `CLUSTER-019`, `CLUSTER-020` (W5.3-W5.10), `OBS-045`, `OBS-030`, `NET-057`, `NET-061` (W5.12)
  - Why/Problem: Unblocks J5 and J4 full.
  - Do: Execute F7 + registry, W5.3-W5.10, W4.6/W4.9, W5.12.
  - Done when: `JRN-007` and `JRN-006` green.
  - Status: todo · Verified-in-code: no · Source: journeys.md#10

- [ ] `JRN-036` **Track the eight shared foundations F1-F8 and their mapping to substrates** · ENHANCE · P2 · S · Deps: `IDEA-001`, `IDEA-002`, `IDEA-003`, `DEPLOY-013` (F3), `OPS-006` (F5), `PROJ-020` (F6), `DEPLOY-058` (F7), `JRN-001` (F8)
  - Why/Problem: journeys reduces work to F1 authz policy layer (= SUB-A), F2 honest deploy (+ execution_plan/env snapshot, precursor of SUB-B), F3 system actor/service token (reuse `x-mesh-internal-key`, `bff/src/clients/service-auth-context.ts:64`), F4 durable event journal (SUB-C; seed `core_event_logs` `packages/nest/schema/src/global/platform/events.ts:37`), F5 installer + published images + registry, F6 encrypted env/secret store (codec `codecs/codec-registry.ts:184`), F7 swarm default runner, F8 Playwright harness (`JRN-001`). Per-journey effort if foundations exist: J1 ~M, J2 ~L, J3 ~L, J4 ~M, J5 ~L, J6 ~M.
  - Do: Make sure each foundation exists as an owned roadmap item in the relevant area file and cross-link here.
  - Done when: each F-number has a checked-off owner item ID noted in the area files.
  - Status: todo · Verified-in-code: no · Source: journeys.md#0

### New findings not in the earlier audit
- [ ] `JRN-037` **Deployment `environment` is a strict 4-name enum while the UI advertises free-form names** · FIX · P1 · S · Deps: `PROJ-066`, `DEPLOY-007`; See also: `PROJ-066`, `DEPLOY-007`
  - Why/Problem: `packages/contracts/common/src/environment.schema.ts:60` `z.enum(['production','staging','preview','development'])` (re-read; comment says "New environments use free-form names") flows into `packages/contracts/runtime/modules/deployment/crud.ts:93`; deploy dialog `deployments/page.tsx:30-31` allows free-form.
  - Do: Accept environment id or free-form name in `deployment.trigger`; drop the strict enum at the deployment contract.
  - Done when: deploying to a custom-named environment succeeds and is stored.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#9 new finding 1

- [ ] `JRN-038` **Ingress hosts are frozen at deploy time; mapping changes do not refresh ingress** · FIX · P1 · M · Deps: `NET-015`; See also: `NET-015`
  - Why/Problem: Hosts read from `deployments.domainUrl` (`platform-routes-source.service.ts:228-229`); no `TraefikConfigRefresher` call on mapping change (callers only in runtime deploy, fleet reachability, managed-web); consequence: a custom domain needs a redeploy; no mapping => UI shows no URL although lane route exists (`:236`, `domain-routing.service.ts:143-145`); `basePath` and non-primary hosts ignored.
  - Do: Build routes from live verified `service_domain_mappings`; refresh ingress on mapping change; support multiple hosts/basePath.
  - Done when: bind/remove mapping changes routing within 10 s with no redeploy.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#9 new finding 2

- [ ] `JRN-039` **`service.customDomains` bypasses domain verification (security)** · FIX · P1 · S · Deps: `NET-013`, `NET-014`, `JRN-030`; See also: `NET-014`
  - Why/Problem: `platform-routes-source.service.ts:233` publishes free-text custom domains as public hosts; `addServiceDomain` also checks neither `verified` nor service-in-project (`domain-service.service.ts:62-110`).
  - Do: Verification enforced in `addServiceDomain`, route generation and the `customDomains` path (or delete it); reserve platform hosts.
  - Done when: unverified or foreign domains never routed; platform hosts rejected.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#9 new finding 3

- [ ] `JRN-040` **Retry drops `runtimeConfiguration` (env vars) as well as `executionPlan`** · FIX · P1 · S · Deps: `DEPLOY-003` (retry copies stored plan); See also: `DEPLOY-004`
  - Why/Problem: `deployment.service.ts:932-950` builds a new row + job whose payload omits both; retried deploy runs without env.
  - Do: Copy persisted plan + resolved env snapshot into the retry job.
  - Done when: retry of a deployment with env vars starts with identical env (test).
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#9 new finding 4

- [ ] `JRN-041` **Fake rollback rows are ignored by routing, so "rollback success" changes nothing** · FIX · P1 · S · Deps: `DEPLOY-074`, `JRN-018`
  - Why/Problem: Rollback row has no `containerName`, ignored at `platform-routes-source.service.ts:224-225`, but is marked `success`.
  - Do: Covered by honest rollback; add a regression test that rollback rows must have a run result.
  - Done when: no `success` rollback without a routed container.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#9 new finding 5

- [ ] `JRN-042` **GitHub App manifest flow needs a reachable public URL: make PAT/deploy key the first-run default** · ENHANCE · P1 · S · Deps: `DEPLOY-028`, `SETUP-021` (public address step); See also: `DEPLOY-102`
  - Why/Problem: `github-account.controller.ts:201-217` requires a configured reachable public access point; a fresh VPS may not have one, so J2 depends on J3's address. PAT path exists but clone ignores credentials (`git.service.ts:33`).
  - Do: First-run copy offers "paste public repo URL" and PAT; Network step must precede "Connect GitHub App"; hide nothing.
  - Done when: a fresh install can deploy a private repo via PAT without any public domain.
  - Status: todo · Verified-in-code: yes (per journeys) · Source: journeys.md#9 new finding 6

- [ ] `JRN-043` **Production compose builds the API image from source on the VPS** · FIX · P0 · M · Deps: `OPS-004`, `OPS-005`, `ARCH-001`; See also: `OPS-005`, `ARCH-021`
  - Why/Problem: `infra/docker/compose/docker-compose.prod.yml:40` (`build-api`) with `Dockerfile.api.prod:35-36` defaulting `PRUNE_SCOPE=@deployer/api`; monolith cannot compile (`apps/api/src/app.module.ts:18,25,28,69` import `@repo/nest-*`, packages named `@deployer/nest-*`, re-verified) and no prod compose sets `DEPLOYER_BFF_IMAGE` or the five `DEPLOYER_SVC_*_IMAGE` (`apps/setup/src/config/env/env.schema.ts:176-186`). Incompatible with a 5-minute install.
  - Do: Remove `build-api`, set tier image env, nothing in the prod path may reference `apps/api`.
  - Done when: `docker compose -f docker-compose.prod.yml config` references no `build-api`; prod boot pulls published images.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#9 new finding 9, #J1 steps 2-3

- [ ] `JRN-044` **Adopt the unused assets that shorten journey work** · ENHANCE · P2 · M · Deps: `WEB-033`, `DEPLOY-105`, `CLUSTER-048`, `DEPLOY-093`, `CLUSTER-023`, `CLUSTER-037`, `DEPLOY-044`
  - Why/Problem: Already-written, unused: BFF screen procedures + `apps/web/src/domains/bff/hooks.ts`, `useRealtimeMetrics` (`domains/docker/hooks.ts:703`), `projects/_utils/trigger-source.ts`, `PreviewEnvOverlayService`, `SwarmComposeRealizerService`, `WebhookIdempotencyService.claim()`, guarded cluster table, admin `createUser` (`apps/web/src/domains/admin/endpoints.ts:103`), `mesh.issueJoinGrant`, swarm service scale/remove/rollback wrappers (`docker.service.ts:2738-2806`), `followStream` per-line callback (`:1152`).
  - Do: When touching the matching area, wire these instead of rewriting; delete if truly dead after the decision.
  - Done when: each asset is either consumed or deleted (tracked in the matching area item).
  - Status: todo · Verified-in-code: partial · Source: journeys.md#9 new findings 7-8

### Journey UX and cross-journey work not covered by area files
- [ ] `JRN-045` **Journey UX contract: stage timeline, failure copy naming stage + cause, empty states, undo** · NEW · P2 · M · Deps: `WEB-111`, `WEB-112`, `WEB-113`, `WEB-114`, `WEB-115`, `JRN-006`
  - Why/Problem: journeys specify per-journey UX: install per-check ticks and image bars; deploy stage timeline (clone -> build -> start -> health -> route) with elapsed time; failure banners naming stage and cause with last 20 log lines and "Retry this step" and "Still serving vX"; non-leaky no-access empty state; reconnect indicators on streams instead of one global "Live" chip; destructive actions typed-name confirm; role-change undo for 10 s.
  - Do: Turn the UX details of J1-J6 into shared components and checks asserted by the e2e specs.
  - Done when: each journey spec asserts at least its empty state, failure copy and undo.
  - Status: todo · Verified-in-code: no · Source: journeys.md#J1-J6 UX details

## DOC items

### Stale or false documents (from parity.md section 2.1 and other reports)
- [ ] `DOC-001` **Correct `docs/feature-gap-catalogue.md` (S-1, D-1, D-6, A-1, A-2, A-3, N-3, X-3, W-1)** · FIX · P1 · M · Deps: none
  - Why/Problem: S-1 "env secrets plaintext" marked fixed but reality is worse: the encrypted `environment_variables` table (`encryptedText("value")`, `.../environment.ts:215`) has no readers/writers outside `backfill-env-secrets.command.ts`, while real vars stay plaintext jsonb (`packages/nest/schema/src/global/project/deployment.ts:118`, plus deployments/preview copies). D-1 "no rollback flow" and D-6 "no cancel endpoint" are false as stated (monolith has rollback; live tier has a record-only flow, cancel is a DB flip, neither claim is right for the product); A-2 API keys now Better Auth plugin; A-1 admin users page exists; N-3 `dashboard/network/mesh/page.tsx` exists; X-3 push UI exists on `/auth/me` (real gap: no event-triggered sends); W-1 now 70 pages (5 loading / 4 error / 1 not-found still right); A-3 apps now api, api-services, doc, mesh-agent, setup, web.
  - Do: Rewrite entries against current code with new `path:line`; or fold into the single re-verified catalogue (`DOC-034`).
  - Done when: each listed entry matches code and cites current paths.
  - Status: todo · Verified-in-code: partial · Source: parity.md#2.1

- [ ] `DOC-002` **Retire or rewrite `docs/feature-status/README.md` and `EXHAUSTIVE-FEATURE-LIST.md`** · FIX · P1 · M · Deps: `DOC-034`
  - Why/Problem: Claims Organization CRUD/members/invites and Admin Organizations WORKING (no org code), "Docker all 10 pages" and Stacks/Registry/Events pages WORKING (web has 7 docker dirs, none for these), "Fleet - no controller needed" (`fleet.controller.ts` has 15+ procedures), project/service pages "null-data UI shells" (pages are 160-370 lines of real hooks), test counts "API 108 / web 10" (now 153 / 61 and 139 in api-services), "Traefik PARTIAL (7 tests)", "Mesh 15 tests".
  - Do: Delete or replace with the re-verified catalogue.
  - Done when: no stale claim remains; README points to the new catalogue.
  - Status: todo · Verified-in-code: partial · Source: parity.md#2.1

- [ ] `DOC-003` **Fix contract paths in `enhancement-overview-100.md`, `enhancement-overview-platform-100.md` (and -50)** · FIX · P2 · S · Deps: none
  - Why/Problem: Every reference to `packages/contracts/api/modules/...` is dead; contracts were re-split into `packages/contracts/{bff,common,entities,fleet,health,identity,project,runtime}`. Items about `enabledEnvironments` and service logs ("KNOWN GAP") remain partly valid but line refs are useless.
  - Do: Re-point paths or mark superseded and link the new roadmap.
  - Done when: no reference to `packages/contracts/api` remains in these docs.
  - Status: todo · Verified-in-code: yes (path absent, root AGENTS lists it too) · Source: parity.md#2.1

- [ ] `DOC-004` **Mark/refresh `docs/implementation-plan-200.md`** · FIX · P2 · S · Deps: none
  - Why/Problem: Same dead contract paths; "CI never runs type-check" and "617 unchecked boxes" not re-verified and premise stale (CI runs lint+type-check `--affected`, ops.md). Parity: not re-verified here.
  - Do: Add superseded banner linking the roadmap or re-verify and rewrite.
  - Done when: banner present or claims re-verified.
  - Status: todo · Verified-in-code: no · Source: parity.md#2.1, ops.md#CI

- [ ] `DOC-005` **Supersede `docs/enhancement-audit-2026-08-12.md`** · FIX · P2 · S · Deps: none
  - Why/Problem: Claims `eventSyncContract` orphan and "only 3 `.errors()` sites, all mesh"; the 2026-09-17 catalogue found `.errors` universal and the events contract moved to `contracts/fleet/modules/events`; contradicts the catalogue.
  - Do: Banner "superseded by feature-gap-catalogue / this roadmap" or delete.
  - Done when: banner/deletion done.
  - Status: todo · Verified-in-code: partial · Source: parity.md#2.1

- [ ] `DOC-006` **Rewrite or remove `dead-code-audit-report.md` body** · FIX · P2 · S · Deps: none
  - Why/Problem: Lists `apps/api/src/system/modules/fleet`, `core/gateway`, `contracts/mesh`, `state-machine`, `sub-app-runner` as dead; most already deleted (`system/` holds only README/AGENTS); doc itself says cleanup done; dated 2026-07-17, predates the api-services split (ops.md).
  - Do: Replace with a fresh knip run result or delete.
  - Done when: doc lists only still-existing dead code or is gone.
  - Status: todo · Verified-in-code: partial · Source: parity.md#2.1, ops.md#knip

- [ ] `DOC-007` **Update root `AGENTS.md` module inventory, stack table and roadmap list** · FIX · P1 · S · Deps: none
  - Why/Problem: "V3 Module Inventory: health/user/organization partial/test; everything else not ported" and "Stack: ORPC 1.13, Bull queues, Redis" are false: 19 api modules + 5 services + BFF exist; Bull removed, deployment queue is in-process, Redis only a platform supervisor with no consumer (architecture.md#11, `preflight.service.ts:181-194`). Feature roadmap list "not yet in v3" (project, service, deployment, github, traefik, domain, analytics, jobs, push, cleanup...) is wrong: all but storage-backup, static-file, ci-cd pipelines, cleanup are present (though many inert, see parity vs README scorecard).
  - Do: Rewrite sections "Stack", "V3 Module Inventory", "Feature Roadmap" and "Migration Workflow step 2" ("currently health, organization, test, user"); mention BFF + 5 services topology.
  - Done when: inventory matches `ls apps/api/src/modules apps/api-services/services/*` and mentions no Bull.
  - Status: todo · Verified-in-code: yes (parity re-check) · Source: parity.md#2.1, architecture.md#11
  - Effect-impact (2026-10-26): add Effect to the stack table and conventions: `effect` 4.x, `@orpc/effect` `.effect()` handlers, `@deployer/nest-effect`; root AGENTS §2/§7 conflict with the new idiom (controller specs 'mock `implement`' vs `effectContext` + `callProcedure`; service specs `vi.fn()` literals vs `Effect.provideService`; constructor injection vs key-class tokens). No doc, AGENTS.md or package README mentions Effect today (searched). Deps: `EFF-035`, `EFF-039`, `EFF-035`. Evidence: `effect-architecture.md` §4.7.

- [ ] `DOC-008` **Remove the organization/Owner-Admin-Developer-Viewer promise from root AGENTS.md and align role docs** · FIX · P1 · S · Deps: DEC-JRN-2
  - Why/Problem: Root AGENTS describes org roles, `RequireOrganizationRole`, `useOrganizationPermissions(orgId)`, `organization` module; code has platform + project roles only, `PermissionService` comment "No org layer" (auth.md:67,129,150; parity.md:25; README decision 3).
  - Do: After DEC-JRN-2, either document "workspace = platform, 2-layer (platform + project) roles" or open an org epic; fix `packages/auth/AGENTS.md`; also define the `user` role or default to `viewer` (auth.md item 14).
  - Done when: no doc claims org plugin or org roles unless built.
  - Status: todo · Verified-in-code: yes · Source: auth.md#13-14, parity.md#2.1

- [ ] `DOC-009` **Fix contract paths and "API (apps/api)" instructions in root AGENTS.md, v3/AGENTS.md and `packages/contracts/AGENTS.md`** · FIX · P1 · S · Deps: `ARCH-030`, `ARCH-031`, `ARCH-012`
  - Why/Problem: Root AGENTS lists `v3/packages/contracts/api/AGENTS.md`, `packages/contracts/api/modules/<feature>/`, `@repo/api-contracts` -> `packages/contracts/api`; real paths are `packages/contracts/{...}`; `packages/contracts/AGENTS.md` cites `apps/api/bff`, `apps/api/services` (architecture.md#15). MCP guidance (`auth-generate`, `api-db`) targets `apps/api`, which monolith-cutover says is the only `db:generate` toolchain and goes away with it.
  - Do: Update after cutover step 2 (move drizzle/auth generate to `packages/nest/schema`); `grep -r "apps/api"`.
  - Done when: AGENTS files only reference existing paths.
  - Status: todo · Verified-in-code: yes · Source: parity.md#structural facts, architecture.md#15, monolith-cutover.md#13
  - Effect-impact (2026-10-26): also reconcile `apps/api-services/AGENTS.md` ('One class per file' vs key + impl in one file: `health.service.ts` has 3 classes; domain errors extend `AppError` vs `Data.TaggedError`) and ARCHITECTURE.md:196-197 ('Never `bun build` an app' vs `bun build ... --packages=external` in all six apps). Amend or split into `*.tag.ts`/`*.impl.ts` (D8, D9). Add a pointer to `node_modules/effect` `ai-docs` to counter v3-syntax drift. Deps: `EFF-035`, `EFF-039`, `EFF-035`.

- [ ] `DOC-010` **Correct AGENTS.md claim that `bun lint` / `lint:check` are non-mutating, and other tooling claims** · FIX · P1 · S · Deps: `OPS-025`
  - Why/Problem: ops.md R-14: `bun lint` auto-fixes by default (rewrote 6 files in bff), so the claim that `lint:check` is non-mutating is false; CI lint results untrustworthy. AGENTS "fix claims to match tooling" (ops.md enhancements).
  - Do: Fix the script or the doc, whichever the OPS item chooses; keep both in sync in the same change set.
  - Done when: doc matches actual behavior verified by `git status` after `bun run lint:check`.
  - Status: todo · Verified-in-code: no (not re-run: lint forbidden here) · Source: ops.md#R-14

- [ ] `DOC-011` **Replace root `README.md` (still "Next.js + NestJS Turborepo Template")** · FIX · P1 · S · Deps: `DOC-032`; See also: `OPS-036`
  - Why/Problem: Root README begins "# Next.js + NestJS Turborepo Template ... Production-oriented monorepo template" (re-read); describes none of the product; quick start (`bun run init`) is not an install path.
  - Do: Write a real README: what the platform is, status, architecture one-paragraph, link to install guide and docs site.
  - Done when: README describes the platform and links `DOC-032` install guide.
  - Status: todo · Verified-in-code: yes · Source: ops.md#R-19, bench-market.md#hardening guide

- [ ] `DOC-012` **Update `docs/swarm-orchestration/README.md` and `IMPLEMENTATION_TODO.md`** · FIX · P2 · S · Deps: none; See also: `CLUSTER-074`
  - Why/Problem: README line 3 still says "Design finalized, implementation pending" (re-read) though swarm services are built; IMPLEMENTATION_TODO leaves SW-045/054/055/056/061/062/063/072/073/033/015 open and marks SW-022/SW-025 "landed" although swarm is unselectable and the compose realizer is dead; term-in-shared-PG documented but implemented as local SQLite; secrets-to-swarm-secrets (SW-073) not done.
  - Do: Update status, close/prune items per code; correct the "landed" marks.
  - Done when: status header and TODO statuses match code.
  - Status: todo · Verified-in-code: partial · Source: docker-cluster.md#12,14, deployments.md#providers

- [ ] `DOC-013` **Fix `docs/API-CUTOVER-STATUS.md` (dead "reversible switch", test counts, "0 type errors")** · FIX · P1 · S · Deps: `ARCH-003`, `ARCH-031`
  - Why/Problem: Section 0b "Blocker 4 ... made reversible" describes dead code: `platformIngressApiBackend()` / `DEPLOYER_INGRESS_BACKEND=bff` (`platform-names.ts:98`) has no callers; the real switch is `DEPLOYER_API_TARGET` (`services-tier-provisioner.service.ts:302`; read at `traefik-supervisor.service.ts:313`, `platform-self-resolver.ts:20`); its "four-step cutover" is not how the system flips; test counts disagree internally; "0 type errors" retracted then restated. Re-read: heading is now "0b. Blocker 4 - the ingress switch (superseded 2026-10-26)", so the dead claim is partly labeled but body/line 27 and 414 still present it as the last structural step.
  - Do: Rewrite 0b and the status header against `DEPLOYER_API_TARGET`; reconcile counts; delete dead `platformIngressApiBackend` code or document it.
  - Done when: doc describes only the real switch; counts consistent.
  - Status: todo · Verified-in-code: partial · Source: architecture.md#ingress target, #15; monolith-cutover.md

- [ ] `DOC-014` **Rewrite `docs/edge-ingress-architecture.md` to the lane / pluggable edge model** · FIX · P1 · M · Deps: none
  - Why/Problem: Still describes old provider model (`local`/`wireguard`/`direct` modes, `LocalIngressForwarderService`); reality is lanes (local/private/public), doors, rescue lane, edge providers `direct` + `cloudflare-tunnel` (networking.md#18, #1.4). Also legacy `MANAGED_TRAEFIK_ENABLED=true` profile is STALE (`infra/docker/compose/common/traefik/docker-compose.config.yml:19-22`).
  - Do: Rewrite or replace; delete the stale compose or document it; `docs/edge-mesh-architecture.md` is honest about trust model (keep).
  - Done when: doc matches `lane-dns-plan.ts` and edge providers.
  - Status: todo · Verified-in-code: no (per networking.md) · Source: networking.md#18, #1.2

- [ ] `DOC-015` **Fix `FULL_MESH_HISTORY.md` and `docs/mesh-todo-implementation-plan.md` mismatch** · FIX · P2 · S · Deps: `ARCH-030`
  - Why/Problem: Both describe the application-level data mesh, not the WireGuard network; `FULL_MESH_HISTORY.md` is a 548 KB tracked file with e2e paths `apps/api/src/e2e/mesh-workflows/` (monolith-cutover.md#14, ops.md R-12).
  - Do: Banner explaining scope, move out of repo root or untrack; update e2e paths after cutover.
  - Done when: file not at repo root, banner present, paths valid.
  - Status: todo · Verified-in-code: partial · Source: networking.md#18, ops.md#R-12, monolith-cutover.md#14

- [ ] `DOC-016` **Delete or banner `docs/INITIALIZATION_PLAN.md`** · FIX · P2 · S · Deps: none
  - Why/Problem: 671 lines describing the deleted pre-setup API, no SUPERSEDED banner, while other `docs/setup-*.md` and `startup-flow-explained.md` carry banners (setup.md #40).
  - Do: Add banner or delete.
  - Done when: banner/deletion done.
  - Status: todo · Verified-in-code: yes (file exists, 671 lines) · Source: setup.md#40

- [ ] `DOC-017` **Correct `docs/FLEET-CENTRIC-FRONTEND-REWRITE.md` status table** · FIX · P2 · S · Deps: none; See also: `WEB-110`, `WEB-063`
  - Why/Problem: Claims "5 node drill pages/components: done - MeshPulse built" while per-node Services/Tasks/Images/Networks/Volumes/Logs/Shell pages do not exist; steps 2-3 (node-scoped docker procedures) left "deferred" (web.md#12, #10, nodes/[nodeId] has 4 tabs only).
  - Do: Update status table to real state, link node-aware docker procedures item.
  - Done when: table matches `dashboard/nodes/[nodeId]`.
  - Status: todo · Verified-in-code: partial · Source: web.md#12, docker-cluster.md#scope

- [ ] `DOC-018` **Retire `docs/qa/web-rebuild/feature-mapping-v1-v2-to-v3.md` (dated 2026-03-24) and `projects/_components/CREATION-ROADMAP.md`** · FIX · P3 · S · Deps: none
  - Why/Problem: Mapping is 7 months stale and describes organizations/admin pages that no longer exist; CREATION-ROADMAP stale (web.md#101, #15).
  - Do: Delete or banner; fold relevant parts into the new catalogue.
  - Done when: files removed or bannered.
  - Status: todo · Verified-in-code: no · Source: web.md#101,#15

- [ ] `DOC-019` **Fix or delete `docs/v2-v3-project-pages-comparison.md`** · FIX · P2 · S · Deps: none
  - Why/Problem: Header is literal `$(date +%Y-%m-%d)` (re-read line 3); says project Services tab and dependency CRUD missing in v3 while `services/page.tsx` (318 lines), `dependencies/page.tsx`, `environments/page.tsx` exist; says Configuration is one 878-line page (now 44 lines); "Zero mock data" (projects-services.md:18,140,157).
  - Do: Delete or regenerate after cutover.
  - Done when: doc accurate or removed.
  - Status: todo · Verified-in-code: yes (header) · Source: parity.md#2.1, projects-services.md

- [ ] `DOC-020` **Correct setup.md section 3.8 (two-BFF claim) inside the audit set** · FIX · P1 · S · Deps: none
  - Why/Problem: setup.md claims `deployer-bff` and `svc-bff` both run and `provision_api` creates a second BFF; journeys.md says removed. Verified: grep for `provision_api`, `BffServiceProvisioner`, `deployer-bff` in `apps/setup/src`, `apps/api-services/shared/src`, `apps/api-services/bff/src` has no hits; `docs/API-CUTOVER-STATUS.md` §0b documents the removal. journeys.md is right; setup.md section is stale. Note architecture.md:15 still lists shape A (`deployer-api`) provisioned by `ApiServiceProvisioner` when `DEPLOYER_BFF_IMAGE` unset, which does exist, so "two BFFs" is false but "setup can still deploy the monolith" is true.
  - Do: Edit setup.md 3.8 to the real state and keep the shape-A caveat.
  - Done when: setup.md has no two-BFF claim.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#9, setup.md

- [ ] `DOC-021` **Correct the parity.md matrix rows that are wrong at product level** · FIX · P1 · S · Deps: `DOC-037`
  - Why/Problem: parity.md marks REAL: Trigger deploy, Cancel, Retry, Rollback, GitHub webhooks (push, PR previews), Preview environments, ZIP upload, Domain management, Build strategies "REAL, wider", API keys, 2FA. Journeys/deployments/auth show: rollback invalid from UI (`deployments/page.tsx:141` re-read) and no-op in live tier; cancel DB flip; retry drops plan and env (`deployment.service.ts:932-950`); webhooks always 401 and push skipped; previews never build; no upload UI; domain verify Forbidden; compose/nixpacks run generic image; API key header mismatch; 2FA enrolment cannot complete. Parity's own "REAL" definition ("reachable from contract and UI") fails for these.
  - Do: Re-grade each row with a "live-tier" column; add legend "REAL = works end to end in the live tier".
  - Done when: matrix agrees with README scorecard and journeys.
  - Status: todo · Verified-in-code: partial · Source: journeys.md#9, parity.md#1.3

- [ ] `DOC-022` **Correct web.md "What works end to end" and networking.md section 1.4 domain-table claim** · FIX · P2 · S · Deps: none
  - Why/Problem: web.md lists trigger -> logs -> retry/rollback/cancel/delete as working; reality: trigger yields `nginx:alpine` success, rollback body invalid, cancel/retry broken. networking.md 1.4 says the Domains table shows the correct TXT name, true only on `/dashboard/network/domains`; the project domains page shows no instructions and no Verify.
  - Do: Edit both reports.
  - Done when: claims qualified.
  - Status: todo · Verified-in-code: partial · Source: journeys.md#9

- [ ] `DOC-023` **Fix `v1/memory-bank/progress.md` (overwritten with v3 notes)** · FIX · P3 · S · Deps: none
  - Why/Problem: Contains v3-era entries (mesh, docker, setup 2026), no longer documents v1; v1 truth is `v1/MIGRATION-FEATURE-INVENTORY.md`. Root AGENTS points to `v1/memory-bank/` as spec.
  - Do: Restore from git history or add pointer; update root AGENTS reference.
  - Done when: memory-bank describes v1 or points to the inventory.
  - Status: todo · Verified-in-code: no · Source: parity.md#2.1

- [ ] `DOC-024` **Rewrite `apps/api/ARCHITECTURE.md` and `docs/architecture/04..09` against reality** · FIX · P2 · M · Deps: `ARCH-031`, `ARCH-007`
  - Why/Problem: Mandates `src/screens/**`, `app.config.ts`, `scripts/build.ts`, `nest-cli.json`, `dto/`, `*.errors.ts` which services lack; says "no bundling" (rule at `ARCHITECTURE.md:196` is stale: bundle keeps `design:paramtypes`, 397 occurrences in `bff/dist/main.js`); claims a signed Actor claim (`:159-160`, plan item checked `09-implementation-plan.md:100`) while raw `cookie`/`authorization`/`x-mesh-internal-key` are forwarded (`bff/src/clients/service-auth-context.ts:59-66`); lists nonexistent `configurator` (`:22`); `deployer start/status` CLI (`:184-191`, unchecked `09-implementation-plan.md:146-150`) does not exist.
  - Do: Update, move to the surviving location (apps/api docs hold E2E_HANDBOOK, strategy worth keeping, monolith-cutover.md).
  - Done when: no claim without a code reference.
  - Status: todo · Verified-in-code: partial · Source: architecture.md#15, #29, #67, monolith-cutover.md

- [ ] `DOC-025` **Fix `apps/doc` `production-deployment.mdx` and `infra/infra/...` paths in docs and deploy.yml summary** · FIX · P1 · S · Deps: `OPS-023`, `OPS-038`; See also: `OPS-038`
  - Why/Problem: Says platform services are "NOT scheduled on Swarm" while setup schedules api/bff/services/Postgres/Redis/Traefik as swarm services; uses `infra/infra/...` paths (also printed by `deploy.yml`).
  - Do: Rewrite to the setup-driven flow and fix paths.
  - Done when: page matches `apps/setup` behavior; no `infra/infra`.
  - Status: todo · Verified-in-code: no (per ops.md) · Source: ops.md#R-19, #docs site

- [ ] `DOC-026` **Mark plan/design docs as design specs and archive them out of the published site** · ENHANCE · P2 · M · Deps: none
  - Why/Problem: `apps/doc` has 91 MDX pages, mostly design specs/plans, none operator-facing (ops.md); `deployment-trust-gate.mdx` is docs-only with zero TS references (ideas-security-resilience.md:21); `E2E_FINDINGS.md` is a March 2026 design note, not a defect list; `docs/providers-runners-unification.md` outdated (lists fake GitLab/Docker-Hub pages).
  - Do: Add front-matter `status: spec | implemented | superseded`, move plans to `docs/archive`, banner trust-gate "not implemented".
  - Done when: published nav lists only implemented features plus a clear "Roadmap/specs" section.
  - Status: todo · Verified-in-code: partial · Source: ops.md#20, ideas-security-resilience.md#21, deployments.md#76

- [ ] `DOC-027` **Fix `docs/qa/permissions/permission-system-design.md` (org-centric, dynamic roles, NOT built)** · FIX · P2 · S · Deps: `DEC-JRN-2`, `IDEA-001`
  - Why/Problem: Design describes an org layer and dynamic roles never built (auth.md:67,129); permission engine + `role_rules` exist unused (ROADMAP-AND-IDEAS#3).
  - Do: Rewrite to the 2-layer model or the SUB-A policy-gated design.
  - Done when: doc matches chosen model.
  - Status: todo · Verified-in-code: partial · Source: auth.md#13-14

- [ ] `DOC-028` **Fix stale code comments/headers and compose references** · FIX · P3 · S · Deps: none; See also: `SETUP-031`
  - Why/Problem: `apps/api/src/modules/setup/setup.module.ts` header claims plain `@Get/@Post` and "ORPC lazy-loaded" but code uses `@Implement`; `core/readiness/readiness.port.ts` docstring stale (setup.md#33, #115, #149); `infra/docker/compose/deployer/docker-compose.deployer.yml` references removed Phase-0 sub-app and "tgclub" names (setup.md#38); `.github/workflows/ci.yml` Directus-era env block at 127-129, 237-239, 341-343 (ops.md, belongs to OPS but doc-flavored).
  - Do: Update or delete (the monolith ones disappear with cutover).
  - Done when: no stale header remains in surviving files.
  - Status: todo · Verified-in-code: no · Source: setup.md#33,#38,#115, ops.md#CI

- [ ] `DOC-029` **Move `.github/instructions.backup-*` and `tmp/` content out of the repo; align `.github/copilot-instructions.md`** · FIX · P3 · S · Deps: `OPS-002`
  - Why/Problem: ops.md enhancements: "Move `.github/instructions.backup-*` and `tmp/` content out of the repo; fix AGENTS.md claims"; many such files show as modified in `git status`.
  - Do: Delete backups, keep canonical `.github/instructions`.
  - Done when: no `instructions.backup-*` directory.
  - Status: todo · Verified-in-code: yes (dir listed in git status) · Source: ops.md#5

### New docs to create
- [ ] `DOC-030` **Create `docs/qa/setup/*` per the root Q&A protocol** · NEW · P2 · S · Deps: `SETUP-030` (same work, SETUP owns)
  - Why/Problem: Root AGENTS requires `docs/qa/<module>/<category>.md`; `docs/qa/` has api-services, deployment, edge-mesh, permissions, platform-direction, system-metrics, web-rebuild and no `setup/` (re-verified; setup.md #41).
  - Do: Record the setup decisions (claim token, address step, installer vs CLI, retry semantics) in `business-logic.md`, `security.md`, `integrations.md`, `naming.md` using the Q&A format.
  - Done when: `docs/qa/setup/` exists with the standard files and each setup decision is recorded.
  - Status: todo · Verified-in-code: yes · Source: setup.md#41, root AGENTS Pre-Implementation Q&A

- [ ] `DOC-031` **Write a production hardening guide** · NEW · P1 · M · Deps: `SEC-023`, `SETUP-001`, `SETUP-002`, `AUTH-001`
  - Why/Problem: Missing (ops.md docs site; bench-market.md:167,244 shows Dokploy ships one, "cheap trust signal").
  - Do: Cover required secrets (`AUTH_SECRET` >= 32 random bytes), sign-up/invite policy, firewall ports (80/443/2377/7946/4789/UDP 51820), socket-proxy, TLS/ACME email, backup, rotation, role least privilege.
  - Done when: guide published in `apps/doc` and linked from README and wizard.
  - Status: todo · Verified-in-code: yes (absence) · Source: ops.md#docs site, bench-market.md#244

- [ ] `DOC-032` **Write the install guide (clean VPS to first deploy) matching the real installer** · NEW · P1 · M · Deps: `OPS-006`, `OPS-004`, `JRN-003`
  - Why/Problem: Only install doc is root `README` quick start (`bun run init`) and `deploy.sh` for "The Gossip Club" (journeys J1 step 1).
  - Do: Document prerequisites, pre-flight, installer, claim URL, address options, joining a node, troubleshooting.
  - Done when: a person follows it on a clean Ubuntu 24.04 VM and succeeds; guide tested by `JRN-003`.
  - Status: todo · Verified-in-code: yes (absence) · Source: journeys.md#J1, ops.md#20

- [ ] `DOC-033` **Write operator runbooks: backup/restore, upgrade, rotate secrets, node join/leave, disaster recovery, troubleshooting** · NEW · P1 · L · Deps: `OPS-013`, `OPS-018`, `SEC-019`, `IDEA-028`; See also: `OPS-037`
  - Why/Problem: ops.md#20: missing backup/restore, upgrade, troubleshooting, runbooks, security hardening, API reference for operators.
  - Do: One page each, tested against the real procedures; include founder-loss and manager-quorum recovery.
  - Done when: each runbook exists and was exercised once.
  - Status: todo · Verified-in-code: yes (absence) · Source: ops.md#20

- [ ] `DOC-034` **Replace `docs/feature-status/*` with one re-verified feature catalogue with current paths** · NEW · P1 · M · Deps: `DOC-001`, `DOC-002`, `DOC-021`
  - Why/Problem: parity.md#4: "retire `docs/feature-status/*` and the two overview-100 docs in favor of a single re-verified catalogue with current paths, and correct S-1". The audit README caveat says do not use the old docs as a roadmap.
  - Do: Generate catalogue from this roadmap (live-tier REAL vs inert), one status per feature with `path:line`.
  - Done when: single catalogue exists; old docs deleted or bannered.
  - Status: todo · Verified-in-code: no · Source: parity.md#4

- [ ] `DOC-035` **Docs-in-same-change-set rule: enforce documentation updates with behavior changes** · NEW · P1 · S · Deps: `OPS-032`, `OPS-039`
  - Why/Problem: Root AGENTS already says "Update docs in the same change set as behavior changes"; the drift found everywhere (README#3.6) shows it is not enforced. v3/AGENTS: "update all affected imports/tests/docs in the same change set and remove old files immediately".
  - Do: Add a PR template checklist item ("docs updated or N/A"), a CODEOWNERS rule for `apps/doc/**` and `AGENTS.md`, and a CI check that fails when changed contract or route files lack a matching `apps/doc` or `AGENTS.md` change (non-blocking first). Make each roadmap item's "Done when" include docs.
  - Done when: PR template + CI check merged; one example PR passes.
  - Status: todo · Verified-in-code: no · Source: README.md#3.6, root AGENTS#Documentation
  - Effect-impact (2026-10-26): enforce the docs-in-same-change rule for the Effect work first: `packages/nest/effect` has no README and the proposed `docs/architecture/13-effect-services.md` (outline in `effect-architecture.md` §7.1) does not exist. Deps: `EFF-035`, `EFF-039`.

- [ ] `DOC-036` **Post-cutover doc sweep: ~15 `apps/doc` pages, AGENTS, `.github/instructions` referencing `apps/api`** · ENHANCE · P2 · M · Deps: `ARCH-012`, `ARCH-030`, `ARCH-031` (cutover steps 2-13)
  - Why/Problem: Cutover step 13: "Move still-useful docs, run `grep -r "apps/api"`, update AGENTS.md and the doc site" (monolith-cutover.md#14, #150); `apps/api` docs (`ARCHITECTURE.md`, `AGENTS.md`, `docs/`, `README.openapi.md`, `src/e2e/E2E_*.md`) hold knowledge worth moving (E2E_HANDBOOK).
  - Do: Move then sweep.
  - Done when: `grep -r "apps/api" docs apps/doc AGENTS.md .github` returns only intentional history.
  - Status: todo · Verified-in-code: yes · Source: monolith-cutover.md#14,#114,#133,#150

- [ ] `DOC-037` **Reconcile contradictions between the audit reports themselves** · FIX · P1 · M · Deps: none
  - Why/Problem: Reports disagree; verified against code (where "right" is stated):
    1. Rollback/cancel/retry: parity.md says REAL; deployments.md and journeys.md say broken in the live tier. Right: journeys/deployments. UI sends `{ params: { id } } as any` with no `targetDeploymentId` (`deployments/page.tsx:141` re-read); README scorecard "works in monolith" is source-level only.
    2. GitHub webhooks/PR previews/ZIP upload: parity REAL vs README/deployments 🔴. Right: README/deployments (journeys: webhook always 401, push skipped).
    3. Two BFFs: setup.md #3.8 vs journeys.md. Right: journeys (no hits for `provision_api`/`deployer-bff` in setup, shared, bff).
    4. Does `apps/api` compile: README wave 2, architecture.md, monolith-cutover.md, journeys say no; parity.md, observability.md, docker-cluster.md, deployments.md and README scorecard rows treat monolith as a live comparison tree (e.g. "Rollback works in monolith", "every fix lands in two trees"). Right: it cannot compile: `apps/api/src/app.module.ts` imports `@repo/nest-lifecycle` / `@repo/nest-database-core` / `@repo/nest-schema` while packages are `@deployer/nest-*` (`packages/nest/lifecycle/package.json` name `@deployer/nest-lifecycle`); `apps/api/tsconfig.json` paths only map `@/*`, and `node_modules/@repo` does not exist. Yet CI, Dockerfiles, compose and setup still reference it; "monolith-only" fixes are therefore source reference only (port, not run).
    5. Compose/Nixpacks runners: parity "REAL, wider" vs README "Compose builds then deploys nginx:alpine; Nixpacks run generic image". Right: README.
    6. API keys, 2FA, passkeys: parity "REAL / NEW, REAL" vs README/auth.md 🔴 / 🟡 (header mismatch `x-api-key` vs `Authorization`; 2FA enrolment can't complete; passkey `rpID` defaults to api host). `useApiKey()` is registered (`auth.ts:178`) so the plugin exists but the flow is broken. Right: README/auth.md.
    7. Agent Auth: ROADMAP-AND-IDEAS says plugin "already wired" with per-operation capabilities; auth.md says registered nowhere (STUB). Verified: `plugins/index.ts:25` exports `agentAuth` but `auth.ts` does not register it. Right: auth.md. SUB-A / MCP ideas that rely on it need to register it first.
    8. Type/lint gate: ops.md cached logs "~345 type errors, lint 1180 errors in apps/api" vs live bff `bun check --no-script` clean (0 errors in 284 files) vs cutover doc "0 production type errors". Not reconciled: needs a fresh `bun check --no-script` (forbidden in this audit pass).
    9. E2E counts: ops.md 27 API e2e specs, README wave 2 "16 e2e specs" in monolith only; parity 153 spec files apps/api vs ops "~4,000 unit tests". Not reconciled (different scopes); record the method next time.
    10. Domain instructions: networking.md 1.4 correct on `network/domains` only; project page shows none (journeys).
    11. Domain management "REAL" (parity 1.4) vs README "domain verification 🔴 never enforced".
    12. Env encryption: gap catalogue S-1 "fixed" vs parity "worse: encrypted table unused" (parity right) .
  - Do: Add an "Errata" block at the top of parity.md, setup.md, web.md, networking.md, ROADMAP-AND-IDEAS.md (agent auth) pointing to the verified answers above, or fix inline; re-run the two unreconciled counts (8, 9) when the gate is allowed.
  - Done when: each contradiction has an errata or an edit and items 8 and 9 have measured numbers recorded.
  - Status: todo · Verified-in-code: partial · Source: parity.md, journeys.md#9, README.md, setup.md, ops.md, auth.md, ROADMAP-AND-IDEAS.md
  - Effect-impact (2026-10-26): the three `effect-*.md` reports (2026-10-26) now supersede earlier audit claims for health/identity (e.g. `OBS-028` cites `:64`, actual `:72`; 'no spec' statements for health); list them in the reconciliation. Deps: `EFF-035`, `EFF-039`.

- [ ] `DOC-038` **Add an errata pointer from the audit README to the roadmap files and mark stale audit-claims** · ENHANCE · P2 · S · Deps: `DOC-037`
  - Why/Problem: README links waves but not the corrections in journeys.md#9 ("Stale or wrong in the audit"), so a future LLM reading README first gets wrong claims (e.g. "Rollback 🟡 Works in monolith").
  - Do: Add "Read errata first" paragraph.
  - Done when: README top links errata and roadmap folder.
  - Status: todo · Verified-in-code: yes · Source: journeys.md#9, README.md
  - Effect-impact (2026-10-26): errata pointer must include `effect-architecture.md`, `effect-health-identity.md`, `effect-ecosystem-research.md` as authoritative for the Effect rewrite, health and identity state.

- [ ] `DOC-039` **Document the docs-truth hierarchy (code > this roadmap > audit reports > old plans)** · NEW · P2 · S · Deps: `DOC-035`
  - Why/Problem: Old docs (gap catalogue, feature-status, overview-100, implementation-plan-200, swarm README, cutover) contradict code and the audit README says not to use them as a roadmap (README#3.6).
  - Do: Add a short `docs/README.md` that declares the source of truth, lists superseded docs and the roadmap folder.
  - Done when: `docs/README.md` exists and is linked from root README.
  - Status: todo · Verified-in-code: no · Source: README.md#3.6

- [ ] `DOC-040` **Update `docs/edge-mesh-architecture.md` or record DEC-JRN-6 where it conflicts** · FIX · P3 · S · Deps: `DEC-JRN-6`
  - Why/Problem: ROADMAP decision 6 notes a conflict between "network state, secrets and audit in the mesh roster" and the Postgres-replica plan in `docs/edge-mesh-architecture.md`.
  - Do: After DEC-JRN-6, update the doc.
  - Done when: doc states the chosen home of network state/secrets/audit.
  - Status: todo · Verified-in-code: no · Source: ROADMAP-AND-IDEAS.md#6

- [ ] `DOC-041` **Document the project's real topology and layout (BFF + 5 services, contracts split, auth plugins) in one architecture page** · NEW · P1 · M · Deps: `ARCH-001`
  - Why/Problem: Contracts are `packages/contracts/{bff,common,entities,fleet,health,identity,project,runtime}`; auth plugins list in `packages/auth/src/server/auth.ts` (admin, apiKey, multiSession, masterToken, loginAs, openAPI, invite, push, passkey, twoFactor, deviceAuthorization, lastLoginMethod); BFF 7 screen procedures + 315 forwarders; no one doc states this (parity.md structural facts; architecture.md).
  - Do: Rewrite `apps/doc/.../architecture/architecture.mdx` and `internal-packages-monorepo.mdx` (referenced by root AGENTS) to match.
  - Done when: the three docs listed in root AGENTS "Documentation" match the tree.
  - Status: todo · Verified-in-code: yes · Source: parity.md#structural, architecture.md
  - Effect-impact (2026-10-26): the topology/layout page must also describe the service idiom (Effect `.effect()` handlers + Nest construction + oRPC contracts) and which services are on it (health, identity `user` only) and the mixed-mode rule (D11). Deps: `EFF-035`, `EFF-039`, `EFF-035`.

- [ ] `DOC-042` **Document known inert settings and unbuilt features until fixed ("stored but ignored")** · NEW · P2 · S · Deps: none; See also: `WEB-014`, `PROJ-080`, `FEAT-141`
  - Why/Problem: Users see service build/health/port, project quotas, retention, notification settings, retry policies, `isActive` persisted but ignored (README#3.4); parity 2.2 lists still-true schema-only items: dynamic vars, `environment_promotions`, `health_check_jobs`, health alert columns, notification settings with no sender, `refreshEnvironmentStatus` NotImplementedException (both `project.controller.ts` copies, line 388), mounted-but-unimplemented `template` contract, no CLI/analytics-report UI/fleet-admission UI.
  - Do: Add an "Implemented vs planned" table to the docs site and a visible "not yet active" hint in the UI (WEB item).
  - Done when: table published; removed per item as features land.
  - Status: todo · Verified-in-code: yes (parity re-check) · Source: parity.md#2.2, README.md#3.4

- [ ] `DOC-043` **Fix the `docs/domain-system-deep-*.md` placement and dates** · FIX · P3 · S · Deps: none
  - Why/Problem: Live in `docs/`, not the repo root, dated 2026-08 (networking.md#18); predate the lane model.
  - Do: Banner or archive; align with domain-enhancement-catalog.
  - Done when: banner/archive done.
  - Status: todo · Verified-in-code: yes (files in docs/) · Source: networking.md#18

- [ ] `DOC-044` **Document the CLI/installer plan decision once made and remove the competing story** · NEW · P2 · S · Deps: `DEC-JRN-1`
  - Why/Problem: Docs say delete `apps/setup` for a CLI (`ARCHITECTURE.md:184-191`, `docs/architecture/09-implementation-plan.md:146-157`); neither finished (README#6.2).
  - Do: After DEC-JRN-1, update ARCHITECTURE/implementation plan and README quick start.
  - Done when: one install story documented.
  - Status: todo · Verified-in-code: yes (no CLI app) · Source: README.md#2,#6, setup.md#39

- [ ] `DOC-045` **Document admin/operator API surface and OpenAPI** · NEW · P3 · S · Deps: none
  - Why/Problem: ops.md lists "API reference for operators" as missing; OpenAPI exists (`openapi.ts`, BFF `openapi-docs.controller.ts`, `/openapi.json` + `/reference`).
  - Do: Publish a page pointing to `/reference` plus auth (API keys, device flow) usage.
  - Done when: page exists once API keys work.
  - Status: todo · Verified-in-code: partial · Source: ops.md#docs site, parity.md#1.6

### Coverage-pass additions
- [ ] `DOC-046` **Mark monolith-fixed vs live-tier status on deployments report items (push trigger, PR->service resolution)** · FIX · P2 · S · Deps: `ARCH-034`, `ARCH-035`; See also: `DOC-037`, `JRN-012`
  - Why/Problem: journeys.md section 9: several deployments.md items marked BROKEN are already fixed in the uncommitted monolith tree (`apps/api/src/modules/deployment/triggers/*`, `apps/api/.../github.webhooks.controller.ts:212-222`) but absent from the live tier, so readers cannot tell "fixed" from "needs port".
  - Do: Add a "monolith-fixed, live-tier port pending" tag to those rows in deployments.md and the DEPLOY roadmap items; drop the tag when ported.
  - Done when: each such row says which tree has the fix and links the porting item.
  - Status: todo · Verified-in-code: partial · Source: journeys.md#9 (stale or wrong table, last row)

## Decisions needed
- [ ] DEC-JRN-1 Installer script vs CLI (J1, J5, DOC-044): journeys recommend script first (`install.sh`, `--join` mode) and wrap it in a CLI later; `apps/setup` fate follows.
- [ ] DEC-JRN-2 Organizations in or out (J6, DOC-008, DOC-027): if out, document "workspace = platform" with platform + project roles and delete org promises; if in, add an L epic.
- [ ] DEC-JRN-3 Relay vs documented NAT limitation (J5): relay favours the mesh-first principle; until built add an honest pre-flight (affects `JRN-007` fixtures).
- [ ] DEC-JRN-4 Which backend survives (J1, J5, DOC-009, DOC-013, DOC-036): everything assumes BFF tier and deleting `apps/api`; this decides the dead docs vs corrected docs.
- [ ] DEC-JRN-5 Single- vs multi-tenant (J6): journeys assume single-tenant; decides whether quotas/billing appear.
- [ ] DEC-JRN-6 Where network state, secrets and audit live (roster vs Postgres) (DOC-040): conflicts with the Postgres-replica plan in `docs/edge-mesh-architecture.md`.
- [ ] DEC-JRN-7 Where e2e runs mandatory gating (`JRN-002`): which journeys are `@pr` vs `@nightly` given Docker-in-Docker cost.
- [ ] DEC-JRN-8 Is the e2e harness in `apps/e2e` or a different location, and may specs run against a real Cloudflare/GitHub sandbox in nightly (journeys say mocks only)?

> Effect-impact pass: 2026-10-26 — 6 items annotated
