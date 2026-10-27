# Audit: Auth / Identity / Users / Permissions / API keys / Invites

Scope: `packages/auth`, `apps/api/src/auth.ts` + `config/auth` + `core/modules/auth` + `modules/user|permission`,
`apps/api-services/services/identity`, `packages/contracts/identity`, web auth/settings/device pages, `docs/qa/permissions`.
All paths relative to `/home/sebille/Bureau/projects/tests/deployer/v3`. Method: read source; verified Better Auth 1.7.7
behaviour in `node_modules/.bun/better-auth@1.7.7+.../dist`. Only test run: `packages/auth` vitest (15 files / 486 tests pass).

Legend: REAL = implemented and wired end to end. PARTIAL = works with gaps. STUB = code exists, nothing runs it or it does not function. MISSING = absent.

---

## 0. Headline findings (read first)

1. **Critical: privilege escalation to superAdmin by any authenticated user via invite plugin.**
   `useInvite()` drops every option except `inviteDurationDays`/`roleSchema` (`packages/auth/src/server/plugins/index.ts:136-146`),
   so `canCreateInvite` is never set. `/invite/create` (`invite.ts:121`) only requires a session, accepts any role from
   `platformSchemas.roleNames` (includes `superAdmin`), creates the user with that role and **returns the token in the response**;
   `/invite/validate` (`invite.ts:321`) is unauthenticated and sets a password. `/invite/list` (`invite.ts:213`) returns every
   invite and token to any session. Chain: sign up (open) -> create invite for own second email with role superAdmin -> validate -> sign in as superAdmin.
2. **Critical: sign-up is open at the API.** `emailAndPassword: { enabled: true }` with no `disableSignUp` (`packages/auth/src/server/auth.ts:117`).
   Only the web UI hides it in production (`apps/web/src/app/auth/_utils/dev-only.ts:10`, comment admits "no server-side flag"). `POST /api/auth/sign-up/email` works in prod.
   New users get role `user`, which is not a defined role but passes `requireAuth()`, which is the only check on most endpoints (see 3).
3. **Critical: platform-level mutations are guarded only by `requireAuth()`.** Role checks (`requirePlatformRole`) exist on only two controllers
   (runtime deployment `deployment.controller.ts` x11, fleet reachability x4). Examples with only `requireAuth()`: DNS provider create/update/delete + Cloudflare tunnels
   (`services/fleet/.../dns-providers.controller.ts:36`), GitHub/GitLab app create/delete, swarm node labels incl. ingress (`cluster controller updateNode`), plus all of project/service/docker/analytics.
   Counts of `requireAuth()` vs role-checks: fleet 83/4, project 69/0, runtime 85/11, bff 18/0. Any signed-in `user`/`viewer` can reconfigure the platform.
4. **Critical: monolith user CRUD is open to any authenticated user.** `apps/api/src/modules/user/controllers/user.controller.ts:17-110`
   (list/create/update/delete/checkEmail use only `requireAuth()`; `update` takes `...updateData` straight to the repo, `repositories/user.repository.ts:~150`). The monolith `UserModule` is still in `AppModule`. The new identity service has the correct rules (below) but is a separate deployment.
5. **Critical: master-token backdoor is on by default, including prod compose.** `masterTokenPlugin` enabled when `DEV_AUTH_KEY && DEFAULT_ADMIN_EMAIL` (`auth.ts:188`),
   with no NODE_ENV gate. Compose defaults `DEV_AUTH_KEY=dev-fallback-key`, `DEFAULT_ADMIN_EMAIL=admin@admin.com`, `DEFAULT_ADMIN_PASSWORD=adminadmin`
   (`infra/docker/compose/common/api/docker-compose.config.yml:17-25`, also web prod + services compose). `Authorization: Bearer dev-fallback-key` then yields a superAdmin session on **every** endpoint
   (`masterTokenAuth.ts:~165`, before-hook matches all paths). `loginAs` (`loginAs.ts:35`) is enabled by `!!DEV_AUTH_KEY` alone and mints a session cookie for any userId. Comparisons are non-constant-time (`masterTokenAuth.ts:151`).
   Also `ENABLE_MASTER_TOKEN` is `z.coerce.boolean()` (`packages/config/env/src/index.ts:200`): the string `"false"` coerces to `true`.
6. **High: `admin` can self-promote to `superAdmin`.** Better Auth `/admin/set-role` has no hierarchy check; `admin` holds `user:set-role` (`permissions/config.ts` admin role) and the UI-only self-guard (`settings/users/page.tsx` handleRoleChange) is bypassable. Admin can also ban/demote superAdmin. The identity service domain only protects *minting* superAdmin through its own path, not Better Auth's.
7. **High: unauthenticated `/setup/*` on the monolith has no post-setup lock found.** `triggerInitialize`, `probeDatabase`, `remoteAuth`, `probeMesh` are `publicAccess()` (`apps/api/src/modules/setup/controllers/setup.controller.ts:44-290`); `triggerInitialize` does not check `setup_done` and the local flow *promotes an existing user with the given email to superAdmin* (`local-initialization.service.ts:~170-185,860`). `probeDatabase` opens a pg connection to an arbitrary caller URL (SSRF/port-scan). Not verified whether an edge (Traefik/setup app) blocks it in prod; no in-API gate exists.
8. **High: default-admin hardcoded fallbacks.** `ensureDefaultAdmin` falls back to `admin@admin.com` / `adminadmin` (`core/admin-bootstrap/default-admin.bootstrap.ts:48-50`), re-run on every boot for compose-managed DBs, and *promotes any pre-existing user with that email to superAdmin* (open sign-up makes that squattable).
9. **High: 2FA and API keys do not function end to end** (details in section 1).

---

## 1. Feature inventory

### Core authentication
| Feature | Status | Evidence |
|---|---|---|
| Better Auth instance factory (cookie cache 5 min, cross-subdomain cookie, trusted origins from `AUTH_BASE_DOMAIN`) | REAL | `packages/auth/src/server/auth.ts:86-292`; mounted by `core/modules/auth/auth.module.ts` + global `AuthGuard` (`guards/auth.guard.ts`) |
| Email + password sign-in | REAL | `auth.ts:117`; `web/app/auth/signin/page.tsx` |
| Email + password sign-up | PARTIAL (insecure) | open at API; UI hidden in prod; dev-only page `auth/signup/page.tsx` |
| Password change / reset / email verification / change email | MISSING | no `sendResetPassword`/`sendVerificationEmail` in config; no UI; no mail transport (`securityPlugins.ts` comment confirms) |
| Sessions: list/revoke/revoke-others UI | REAL | `components/account/security-cards.tsx` `ActiveSessionsCard`; `domains/account/hooks.ts` |
| Session policy (expiry, freshAge, rate limits, IP header config) | MISSING | no `session.expiresIn`/`rateLimit`/`advanced.ipAddress` in config (defaults only) |
| Multi-session (several accounts per browser) | REAL | `multiSession()` `auth.ts:185`; `web/app/auth/me/*`, `use-device-accounts.ts`, spec `accounts-section.test.tsx` |
| GitHub social login | STUB | factory supports it (`auth.ts:155`) but `config/auth/auth.ts` never passes `GITHUB_CLIENT_ID/SECRET`; no sign-in button; scope `repo` over-broad |
| Last-login-method hint | REAL | `useLastLoginMethod` + `LastUsedBadge` |
| Passkeys (WebAuthn) | PARTIAL / likely broken in default topology | server `usePasskey({rpName})` only (`securityPlugins.ts:~60`); `PASSKEY_RPID/PASSKEY_ORIGIN` appear only in compose, read by no code. Plugin default rpID = hostname of `NEXT_PUBLIC_API_URL` (`api.<domain>`) while the browser origin is `web.<domain>`, so WebAuthn rpID validation fails. UI: enrol/list/delete (`PasskeysCard`), sign-in button (`passkey-button.tsx:67`) |
| TOTP 2FA + backup codes | STUB | server `useTwoFactor` registered. Enrolment calls `twoFactor.enable({ password: '' })` (`domains/account/hooks.ts:263`, `devtools/plugins/security-panel.tsx:239`): fails for credential accounts; no TOTP URI/QR, no `verifyTotp` anywhere in web; controls live only in devtools (dev only); **sign-in page has no `twoFactorRedirect` handling** (`signin/page.tsx:~140-160`), so a user who did enable 2FA gets no challenge UI |
| Device authorization (RFC 8628) | PARTIAL | server plugin `useDeviceAuthorization` (`securityPlugins.ts`), table `device_code`, approval page `web/app/device/page.tsx` (approve/deny via `$fetch`). No client uses `/device/code`: CLI still uses master token / default creds / temp seed user (`apps/api/src/cli/services/cli-auth.service.ts:68-140`). Page does not show client name/scope (comment claims it does), and not-signed-in state has no sign-in link; `/device` is not in the middleware matcher (`middlewares/WithAuth.ts` matches `/dashboard*`, `/settings`, `/profile`). Agent page `/device/capabilities` does not exist |
| Agent Auth (AI agents) | STUB | `useAgentAuth` defined (`plugins/agentAuth.ts`) but registered nowhere (not in `auth.ts` plugin list); no agent/host tables in schema; web `useAgents/useAgentHosts` call `/agent/list`, `/host/list` which 404; `AgentConnectionsCard` renders errors |
| Master token / login-as (dev impersonation) | REAL (dangerous) | see headline 5; web `WithAuth.ts` dev cookie bypass is NODE_ENV-gated |
| Push notification plugin | REAL (outside scope; present) | `pushNotifications.ts`, identity `push` module (service spec 21 tests) |

### Users, roles, permissions
| Feature | Status | Evidence |
|---|---|---|
| Platform roles `superAdmin / admin / operator / viewer` (+ DB default `user`, undefined) | PARTIAL | `packages/auth/src/permissions/config.ts:62-120`. Default role `user` (`schema auth.ts:42`, admin plugin default) is NOT in `PLATFORM_ROLES`; `userSchema.role = z.enum(PLATFORM_ROLES)` (`contracts/identity/modules/user/schemas.ts`) will fail output validation for any `user`-role row; web `isPlatformRole('user')` -> null |
| Project roles `owner / maintainer / deployer / viewer` | REAL (project service) | `config.ts:178-260`; `services/project/.../project.entity.ts` rules (`assertNotOwnerMembership`, no grant owner), `shared/.../project-access.service.ts`, web `projects/[id]/team` |
| Org / "Owner/Admin/Developer/Viewer" model, Better Auth organization plugin | MISSING | `packages/auth/AGENTS.md`: `useOrganization` not implemented; `PermissionService` comment "No org layer - the mesh is the single tenant". `docs/qa/permissions/permission-system-design.md` (org-centric, dynamic roles) describes a design that was NOT built |
| PermissionEngine (filters, cascade, rule validator, SQL compiler) | REAL library, STUB integration | `packages/auth/src/permissions/engine/*` (~1.9k LOC with specs, pass); `PermissionService`+`role_rules` repo exist in `apps/api/modules/permission` and identity service, but **no consumer calls it** (grep: nothing outside the module); no contract, no endpoint, no UI to manage `role_rules`; `loadRoleRules` swallows errors `.catch(() => [])` (`permission.service.ts:34`) |
| Identity-service user domain (admin-only list/create/delete, self-or-admin read, self-service whitelist, no self-ban/delete, only superAdmin mints superAdmin, email normalisation, audit field guard) | REAL, UNTESTED | `apps/api-services/services/identity/src/modules/user/domain/user.entity.ts`, `services/user.service.ts`, `controllers/user.controller.ts`. Only an e2e happy path (admin actor) covers it; **no unit tests of the rules** (no `user.*.spec.ts`) |
| Monolith user module | REAL but insecure | headline 4. Has spec files (service/controller/repo) but no authorization tests |
| Ban/unban/set-role/remove user UI | REAL | `web/app/dashboard/settings/users/page.tsx` via `authClient.admin.*` (`domains/admin/endpoints.ts`), not via ORPC user contract. Offers "Remove" to `admin` although `admin` lacks `user:delete` (server rejects); search/filter is client-side over the 20 loaded rows; no total count; no create-user, no invite, no per-user sessions, no impersonation UI |
| ORPC `user.*` hooks in web | STUB | `domains/user/*` is imported by no page (only test mocks) |
| Platform-role UI policy | REAL | `web/src/lib/access/platform-role.rules.ts` + hooks + test; UI-only, server is the boundary |
| Better Auth `useAdmin` plugin with custom ac/roles | REAL | `plugins/index.ts:55` |
| Ban takes effect on existing sessions | PARTIAL | Better Auth admin ban revokes at next `get-session`; cookie cache keeps role/ban stale up to 5 min (`session.cookieCache`); identity service `setBanned` is a raw DB write, no session revocation |

### Invites
| Feature | Status | Evidence |
|---|---|---|
| Platform invite (create/list/check/validate), table `platform_invite` | PARTIAL (server only, insecure) | `plugins/invite.ts`; migrations present; `/invite/list` pending/expired filters compare `usedAt === undefined` but DB returns `null` (`invite.ts:264,272`) so "pending" returns nothing and "used" returns all; `validate` not atomic (race); no email send; no resend/revoke; token lives only in API response |
| Invite UI (admin create/list, accept page) | MISSING | no `authClient.invite.*` usage in web; sign-in page says "ask for an invitation" but no accept route exists |
| Project collaborator invite | PARTIAL | `services/project/.../project.service.ts:165` requires an existing user by email (404 otherwise); UI `InviteMemberDialog.tsx`; no pending invitations, no email |

### API keys
| Feature | Status | Evidence |
|---|---|---|
| Better Auth `apiKey` plugin (`dk_` prefix, session-for-key, metadata, rate-limit) | PARTIAL / broken transport | `plugins/index.ts:92-107`. Plugin reads header `x-api-key` only (`@better-auth/api-key dist/index.mjs:2324`); no `customAPIKeyGetter`. The devtools/orpc client sends `Authorization: Bearer <key>` (`web/lib/orpc/plugins/masterTokenClient.ts`), and the BFF fan-out forwards only cookie/authorization/mesh key, not `x-api-key` (`bff/src/clients/service-auth-context.ts:~60`). Net effect: minted keys do not authenticate via the documented paths |
| API key UI (create 90d, list, revoke) | REAL UI | `security-cards.tsx` `ApiKeysCard`; comment says "disable, record kept" but code calls `apiKey.delete` |
| Legacy hand-rolled project `ApiKeyService` (`dk_` + sha256) | STUB / dead | provided in `project.module.ts` (both apps) but no controller, no verifier (`findByHash` never used for auth); no scopes enforcement |

### Operational auth
| Feature | Status | Evidence |
|---|---|---|
| Setup admin seed (wizard) | REAL | `core/modules/setup/services/local-initialization.service.ts:~790-860` via `signUpEmail` then superAdmin |
| Restart-path default admin | REAL (unsafe defaults) | headline 8 |
| Mesh peer tokens (`v1.`/`v2.` HMAC, timing-safe, expiry) | REAL | `packages/auth/src/mesh/index.ts` + `requireMesh()` (`core/modules/auth/orpc/middlewares.ts`); bare shared secret accepted with `===` (non constant time) |
| BFF -> services credential propagation | REAL | `bff/src/clients/service-auth-context*.ts` (cookie/authorization forwarded; services re-resolve session with same secret) |
| Auth module duplicated in `apps/api` and `apps/api-services/shared` | PARTIAL (drift) | `diff -rq` shows differing copies |
| Web route protection | PARTIAL | `middlewares/WithAuth.ts` only checks cookie *presence* (`getSessionCookie`), not validity/role; `getCookieCache` result unused; relies on API for real enforcement |
| Tests | PARTIAL | `packages/auth`: 486 pass, but `server/auth.spec.ts` mocks all plugins (tests nothing real), `invite.spec.ts` checks shape only (no endpoint behaviour/authz). Monolith auth guard/role guard specs exist. No test for open sign-up, invite escalation, master-token gating, admin set-role |

---

## 2. What works end to end

- Admin created by setup wizard, sign in with email/password, cookie session shared across `api.` / `web.` subdomains, cookie-cache session reads in the Next server (`lib/auth/cookie-session.ts`), sign-out.
- Multi-account switching in one browser (`/auth/me`).
- Session device list and revoke; passkey list/add/delete UI calls (assuming rpID is fixed); API key create/list/delete UI calls (but keys are unusable, see above).
- Superadmin/admin user list, ban/unban, set role, remove via Better Auth admin plugin (server enforces `user:*` permissions for non-self targets).
- Platform-role gating on deployment actions and reachability config; project-level collaborator roles with owner protections in project service.
- Device-code approval page against Better Auth's `/device/approve|deny` (no client consumer yet).
- Mesh peer auth tokens.
- Identity-service user domain rules (unit-untested but exercised by one e2e).

## 3. Broken or risky (security first)

1. Invite-based superAdmin escalation (headline 1); invites list exposes tokens.
2. Open API sign-up in production (headline 2) combined with `requireAuth()`-only endpoints (headline 3) and monolith user CRUD (headline 4): an anonymous internet user can become a full operator.
3. Master token / login-as enabled by compose defaults with a public default key; `ENABLE_MASTER_TOKEN=false` still enables (coerce bug); plugin not gated by `NODE_ENV`; admin email default `admin@admin.com`.
4. Hardcoded `adminadmin` / `admin@admin.com` fallbacks; promotion of pre-existing user by email.
5. `admin` can grant itself `superAdmin` and act on superAdmin accounts (no role hierarchy); `admin` UI offers delete it cannot perform.
6. Unauthenticated `/setup/*` with no post-setup lock found; unauthenticated outbound DB/URL probes.
7. `AUTH_SECRET` / `BETTER_AUTH_SECRET` default to the literal `fallback-auth-secret` in all compose files and in `managed-web-supervisor.service.ts:202` and `apps/setup/.../env.schema.ts:149`; the same secret derives the ingress token and column-encryption key, so a default secret forges sessions. API env schema marks both optional (`packages/config/env/src/index.ts:189-190`); only `schema-codecs.ts:51` hard-fails in production.
8. 2FA: enrolment cannot complete and sign-in has no challenge; users could lock themselves out only via API since UI cannot finish; no recovery path.
9. Passkey rpID/origin mismatch across `web.` / `api.`; `PASSKEY_*` env unused.
10. API keys unusable (header mismatch) and two competing key systems; devtools "act as user" path likely non-functional after the master-token removal.
11. `PermissionService` swallows loader errors (`catch(() => [])`) - fail-open/closed ambiguity; engine unused.
12. Cookie cache (5 min) delays role change/ban; identity `setBanned` does not revoke sessions.
13. Spec drift: `docs/qa/permissions/permission-system-design.md` and AGENTS root describe org layer and Owner/Admin/Developer/Viewer; code has neither.
14. Role `user` not in enum -> contract output validation failures and invisible role in UI.
15. Test gaps listed in the Tests row; identity user rules have zero unit tests.
16. Non-constant-time secret comparisons (`masterTokenAuth.ts:151`, `loginAs.ts:35`, `requireMesh` bare secret).
17. `socialProviders.github` scope `repo` (if ever enabled) over-broad; `better-auth` `trustedOrigins` includes `setup.`/`docs.` subdomains by hard-coded list.

## 4. Required for production (ordered)

1. Set `emailAndPassword.disableSignUp: true` (or a `before` hook that only allows sign-up when no user exists / with a valid invite) and keep the dev UI as is. Test it.
2. Fix invites: pass `canCreateInvite` (superAdmin/admin only) and enforce "may not invite a role above own"; do not return the token to non-admins; fix null/undefined filters; make `validate` transactional; add admin UI + accept page (`/auth/invite?token=`); or delete the plugin and use `admin.createUser`.
3. Remove the master-token and login-as plugins from production builds: require `NODE_ENV !== 'production'` inside the plugins, make `ENABLE_MASTER_TOKEN` a strict boolean parser, delete `dev-fallback-key`/`fallback-auth-secret`/`adminadmin` defaults from every compose file and code path; make `AUTH_SECRET` and a non-default admin credential required (fail boot) outside dev. Use constant-time compares.
4. Add a platform-role (or permission) middleware to every mutation outside project scope: fleet (nodes, cluster, providers/DNS/Cloudflare/GitHub apps), runtime (images, containers, runners), analytics export, docker, domain, bff console. Decide read access for `viewer`/`user`. Add a test per controller asserting 403 for `viewer`/`user`.
5. Retire the monolith `apps/api/src/modules/user` controller or port the identity-service rules into it; add unit specs for `userRules` (privilege matrix, self-edit whitelist, self-destruct, superAdmin minting).
6. Add role hierarchy for Better Auth admin actions: a `before` hook on `/admin/set-role`, `/admin/ban-user`, `/admin/remove-user`, `/admin/update-user` that forbids acting on, or granting, a role >= caller's unless superAdmin.
7. Lock `/setup/*`: reject `triggerInitialize`, `probeDatabase`, `remoteAuth` and the rest when `setup_done` or when the caller is not the setup app / has no setup token; do not promote pre-existing users; seed only when the user table is empty.
8. Finish 2FA: pass the user's password (prompt), show TOTP URI/QR + `verifyTotp`, handle `twoFactorRedirect` on sign-in (TOTP + backup code + trusted device), move controls out of devtools into Account settings, add recovery policy.
9. Fix passkeys: set `rpID` to the parent domain (`AUTH_BASE_DOMAIN` without dot), `origin` to the web origin(s); read the existing `PASSKEY_*` env; e2e test enrol + sign-in.
10. Fix API key transport: `customAPIKeyGetter` that accepts `Authorization: Bearer dk_...` and `x-api-key`; forward `x-api-key` in `service-auth-context.ts`; delete the legacy `ApiKeyService`; add key scopes/permissions metadata mapped to roles.
11. Password lifecycle: change-password (needs fresh session), forgot/reset, email verification: requires an outbound mail transport (SMTP/Resend) plus a "mail not configured" operator path (admin-set temporary password).
12. Session hardening: set `session.expiresIn/updateAge/freshAge`, `rateLimit` (sign-in, invite, device), `advanced.ipAddress.ipAddressHeaders` for Traefik, revoke sessions on role change/ban in both Better Auth and identity service, reduce or bypass cookie cache for role-sensitive checks.
13. Make the web middleware validate the session server-side for `/device` and role-gated routes (not just cookie presence), add a sign-in redirect on `/device`.
14. Align the role model: define role `user` (or default new accounts to `viewer`), fix `userSchema`, and update the docs (`docs/qa/permissions`, root AGENTS) to the real 2-layer (platform + project) model, or build the org layer.
15. Decide the surviving auth module (`apps/api` vs `api-services/shared`) and remove the duplicate.

## 5. Recommended enhancements

- Wire `PermissionEngine` into project/service/deployment reads (SQL where-clause compile) or remove it plus `role_rules`; if kept, add contracts, CRUD UI, caching, and make loader failure explicit.
- Replace `authClient.admin.*` in the users page with the ORPC user contract (consistent hooks, server-side pagination with totals, server-side search); show per-user sessions, last login, 2FA status, role history.
- Audit log for auth events (sign-in, role change, ban, invite, key mint, device approval); Better Auth hooks are available and `system:audit` permission already exists with no producer.
- Use Better Auth `bearer`/API-key based CLI login through the device flow; add the CLI client (`deployer login`) and remove the temp-seed-user strategy.
- Device approval page: show client id/scope, expiry countdown, and re-auth for sensitive scopes.
- Behavioural tests: replace `auth.spec.ts` plugin mocks with an in-memory Better Auth integration test; add invite, admin-hierarchy, sign-up-disabled, master-token-off-in-prod tests.
- Passwordless/SSO: OIDC/SAML or GitHub/GitLab login (wire the existing GitHub option, minimal scopes, account linking policy with verified email).
- Per-project API tokens with scopes (deploy-only CI token) built on the apikey plugin metadata.
- Cache `getSession` per request in guards (guard and ORPC plugin both resolve it; with master-token hooks each call hits DB).

## 6. Recommended new features

- Org/team layer (or at minimum project-level groups) if the Owner/Admin/Developer/Viewer model in the docs is still the target; otherwise formally adopt platform+project roles and publish a permission matrix in the docs site.
- Admin impersonation with banner and audit (Better Auth admin impersonate is permitted for superAdmin only; no UI).
- Trusted-device and session-freshness prompts for destructive actions (re-enter password / passkey).
- Account lifecycle: self-service delete/export, email change with verification, recovery codes download, security notifications (new device sign-in via web push, which already exists).
- IP allow-listing / login rate-limit dashboard; lockout notifications.
- Service accounts (non-human identities) with expiry and rotation tied to mesh nodes.
- Agent Auth: either register `useAgentAuth` with the generated OpenAPI spec, add its tables, and build `/device/capabilities`, or remove the dead code and UI cards.
