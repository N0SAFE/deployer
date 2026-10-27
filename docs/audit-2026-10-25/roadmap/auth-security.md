# AUTH + SECURITY roadmap
> Owner prefix: AUTH, SEC · Sources: auth.md, ops.md (security sections), architecture.md (inter-service auth, setup surface), docker-cluster.md, projects-services.md, networking.md, deployments.md (authz findings), ideas-security-resilience.md (section 3 authorization best-in-class, codec/key-rotation items) · Last verified: 2026-10-26

## Summary
Authentication works for the happy path (setup-seeded admin, cookie sessions, multi-account) but the authorization model is "logged in", not "allowed": sign-up is open at the API, the invite plugin lets any session mint a superAdmin, the master-token backdoor is on by default, and nearly every ORPC procedure outside deployment/reachability is guarded only by `requireAuth()`. Encryption at rest is effectively keyless for the shipped `AUTH_SECRET`. Secrets sit in clear in swarm specs, API responses and a committed cookie file. Second-factor, passkeys and API keys are all half-wired. The `PermissionEngine` library exists but has no consumer; SUB-A (policy-gated authz on every procedure) is the structural fix. Most fixes must land twice (monolith `apps/api` + `apps/api-services`) until the monolith is retired.
Counts: 175 items (AUTH 73, SEC 102) excl. decisions; P0 50, P1 76, P2 33, P3 16; FIX 51, ENHANCE 20, NEW 104; 32 decisions (detail in the "Counts" line at end of file). The target authN/authZ design ("Grants + Guardrails", `authz-authn-design.md`) is itemised under "Authorization & authentication target design" (`SEC-048..102`, `AUTH-051..073`, `DEC-AUTH-9..26`); it OWNS SUB-A (`SEC-001`) and re-scopes many existing items via `Design-impact (2026-10-26)` bullets.
> Authz design pass: 2026-10-26 — 78 items added (AUTH-051..073 = 23, SEC-048..102 = 55), 18 decisions added (DEC-AUTH-9..26), 55 existing items and 9 existing decisions re-scoped with Design-impact notes
> Coverage pass: 2026-10-26 — 4 items added (AUTH-050, SEC-045..047), 16 deps resolved (SUB-A -> SEC-001, SUB-C -> OBS-001, SUB-D -> IDEA-004), 1 wrong in-body ref fixed (AUTH-005), 0 unresolved; duplicates listed under "Cross-file duplicates". Spot-verified in code on 2026-10-26: open sign-up (no `disableSignUp`), `role` field `input: true` (`packages/auth/src/server/auth.ts:135`), master-token/loginAs enabled by env presence (`auth.ts:186-193`), invite options dropped (`plugins/index.ts:130-140`), `Buffer.from(secret,"hex")` (`schema-codecs.ts:45`), `execSync unzip` (`git.service.ts:135`), tracked `200` cookie file, `ENABLE_MASTER_TOKEN` coerce (`env/src/index.ts:200`), no `requirePlatformRole` in docker/cloudflare controllers.
Cross-references (not duplicated here): webhook signature/idempotency (DEPLOY), roster flat-authority/quorum I-02 and epoch I-20 (NET/IDEA, SUB-D), tamper-evident audit I-03, JIT/break-glass I-06, node-scoped secrets I-05, secret reveal discipline I-21 (IDEA), migration 0040/backfill (ARCH), ACME email default (NET/OPS), CI supply chain/images (OPS).

## Items

### Critical access-control holes (auth)
- [ ] `AUTH-001` **Disable public sign-up and block client-set `role`** · FIX · P0 · S · Deps: none
  - Why/Problem: `emailAndPassword: { enabled: true }` has no `disableSignUp` (`packages/auth/src/server/auth.ts:117`); `role` additional field has `input: true` (`auth.ts:135`); web only hides the link (`apps/web/src/app/auth/_utils/dev-only.ts:10`). `POST /api/auth/sign-up/email` works in prod, possibly with `role:"superAdmin"`. New users get role `user`, which passes `requireAuth()` everywhere.
  - Do: set `emailAndPassword.disableSignUp: true` (or a `before` hook allowing sign-up only when the user table is empty or with a valid invite); set `role` `input:false`; add a `before` hook stripping `role`; keep the dev-only UI. Apply in `packages/auth` (shared by both trees).
  - Done when: `POST /api/auth/sign-up/email` (with and without `role`) returns 403/ignored in a production-mode instance; test AUTH-041 passes.
  - Status: todo · Verified-in-code: yes · Source: auth.md#0 (2), ops.md#R-01, ops.md#4 P0-1
  - Design-impact (2026-10-26): still the P0 quick fix, same scope (`disableSignUp: true`, `role` `input:false`), but the end state is `AUTH-052` (`user.role` as write-protected projection set only by `Grants.assign/revoke`) + `AUTH-070` (sign-up `before` hook allows only a valid invitation or the setup claim; new accounts get baseline `member`, `DEC-AUTH-15`). Do not wait for the design; land the minimal fix now.

- [ ] `AUTH-002` **Fix invite-based superAdmin escalation** · FIX · P0 · M · Deps: `AUTH-001`
  - Why/Problem: `useInvite()` drops all options except `inviteDurationDays`/`roleSchema` (`plugins/index.ts:130-146`), so `canCreateInvite` is never set; `/invite/create` (`invite.ts:121`) needs only a session, accepts any role incl. `superAdmin`, and returns the token; `/invite/validate` (`invite.ts:321`) is unauthenticated and sets a password; `/invite/list` (`invite.ts:213`) leaks every token to any session. Chain: sign up -> invite own second email as superAdmin -> validate -> superAdmin.
  - Do: pass `canCreateInvite` (superAdmin/admin only); enforce "cannot invite a role above own"; never return tokens to non-admins on list; or delete the plugin and use `admin.createUser` (see DEC-AUTH-2).
  - Done when: a plain session gets 403 on `/invite/create` and `/invite/list`; an admin cannot invite superAdmin; AUTH-042 passes.
  - Status: todo · Verified-in-code: partial (option drop confirmed) · Source: auth.md#0 (1)
  - Design-impact (2026-10-26): approach changes from "gate/cap the plugin" to "delete it" in the end state: the `platform_invite` plugin is replaced by the own `invitations` table + service (`AUTH-065`, `DEC-AUTH-17`) where `grant_template` is capped by `Grants.assertGrantable` and `superAdmin` is never inviteable. Interim (before P4): `admin.createUser` via our service, no email invites. The P0 quick fix (pass `canCreateInvite`, cap roles) may still land first.

- [ ] `AUTH-003` **Gate master-token and login-as plugins out of production** · FIX · P0 · S · Deps: none
  - Why/Problem: `masterTokenPlugin` enabled when `DEV_AUTH_KEY && DEFAULT_ADMIN_EMAIL` with no `NODE_ENV` gate (`auth.ts:186-188`); `loginAsPlugin` enabled by `!!DEV_AUTH_KEY` alone (`auth.ts:191-192`). Compose defaults ship `DEV_AUTH_KEY=dev-fallback-key` + `admin@admin.com` (`infra/docker/compose/common/api/docker-compose.config.yml:17-25`, also web prod + services compose); `Authorization: Bearer dev-fallback-key` yields a superAdmin session on every endpoint (`masterTokenAuth.ts:~165`); `loginAs` mints a cookie for any userId (`loginAs.ts:35`). `.env.example:197` ships `dev-secret-key-change-me`; `.env.prod.example` suggests reusing AUTH_SECRET.
  - Do: require `NODE_ENV !== "production"` inside both plugins (not only at call site); make Zod forbid `DEV_AUTH_KEY` when `NODE_ENV=production`; delete `dev-fallback-key` defaults from every compose file; drop the `.env.prod.example` suggestion. Consider removing the plugins from production bundles.
  - Done when: in a prod-mode instance `Authorization: Bearer <DEV_AUTH_KEY>` yields 401 even if the env var is set (boot fails or plugin inert); AUTH-043 passes.
  - Status: todo · Verified-in-code: yes · Source: auth.md#0 (5), ops.md#R-05, architecture.md#4 (17)
  - Design-impact (2026-10-26): re-scoped from "gate out of production" to DELETE, not gate: `masterTokenAuth`, `loginAs`, `DEV_AUTH_KEY` and every `dev-fallback-key` default are removed ("a gate can be misconfigured; a deleted plugin cannot"). Replacements: device-code login (`AUTH-068`), service-account tokens (`AUTH-066`, dev seed), host recovery CLI (`SEC-081`). Impersonation replaces `loginAs` (`AUTH-067`).

- [ ] `AUTH-004` **Make `ENABLE_MASTER_TOKEN` a strict boolean** · FIX · P0 · S · Deps: none
  - Why/Problem: `z.coerce.boolean()` (`packages/config/env/src/index.ts:200`) turns the string `"false"` into `true`, so `ENABLE_MASTER_TOKEN=false` still enables the backdoor.
  - Do: replace with a strict parser (`"true"|"false"` enum transform) and apply to other boolean flags that use coerce.
  - Done when: `ENABLE_MASTER_TOKEN=false` parses to `false`; unit test on the schema.
  - Status: todo · Verified-in-code: yes · Source: auth.md#0 (5)
  - Design-impact (2026-10-26): with the plugins deleted (`AUTH-003`) the strict-boolean fix remains useful for other flags but no longer guards the backdoor; mark this item done when `ENABLE_MASTER_TOKEN` is removed entirely.

- [ ] `AUTH-005` **Remove hardcoded default-admin fallbacks and stop promoting pre-existing users** · FIX · P0 · M · Deps: `SEC-016`,`SEC-017`
  - Why/Problem: `ensureDefaultAdmin` falls back to `admin@admin.com` / `adminadmin` (`core/admin-bootstrap/default-admin.bootstrap.ts:48-50`), re-runs every boot for compose-managed DBs and promotes any existing user with that email to superAdmin (squattable via open sign-up). Setup local flow also promotes an existing user by email (`local-initialization.service.ts:~170-185,860`).
  - Do: no default credential anywhere (code + compose); require explicit admin email + strong password (or setup claim token, AUTH-016) outside dev; seed only when the user table is empty; never promote an existing account.
  - Done when: boot with no admin env in prod mode fails fast or skips seeding; a pre-registered `admin@admin.com` is not promoted.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#0 (8), auth.md#3 (4), auth.md#4 (3)
  - Design-impact (2026-10-26): the design adds the `SetupClaim` principal (one-time claim bound to a passkey enrolment, `AUTH-059`/`AUTH-016`); seed only on an empty user table; there is NO promote-by-email path in the model because grants are explicit rows (`SEC-054`); bootstrap superAdmin is a `source='seed'` owner grant; lock-out recovery is the host CLI (`SEC-081`).

- [ ] `AUTH-006` **Add role hierarchy to Better Auth admin actions** · FIX · P0 · M · Deps: none (feeds `SEC-001`)
  - Why/Problem: `/admin/set-role` has no hierarchy check and `admin` holds `user:set-role` (`permissions/config.ts`), so admin can grant itself superAdmin, ban or demote superAdmin; the UI self-guard (`settings/users/page.tsx` handleRoleChange) is bypassable; identity-service domain rules only guard its own path.
  - Do: `before` hooks on `/admin/set-role`, `/admin/ban-user`, `/admin/remove-user`, `/admin/update-user` forbidding acting on or granting a role >= caller's unless superAdmin; express as one rule set shared with the identity service (best-in-class #6).
  - Done when: admin gets 403 granting/acting on superAdmin or equal role; AUTH-044 passes.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#0 (6), ideas-security-resilience.md#3 (6)
  - Effect-impact (2026-10-26): scope +: the identity `user` domain reproduces the gap (`assertCanAdminister` is the only check for delete/update/setBanned; `assertRoleIsAssignable` guards only the NEW role, so an `admin` can delete, ban or change the email of a `superAdmin`). Add the hierarchy rule ('no acting on a target whose role >= actor unless superAdmin') in `domain/user.rules.ts` as well as the Better Auth hook, with matrix tests; the rules are pure so this is cheap. Evidence: `effect-health-identity.md` §4.3, N-7.
  - Design-impact (2026-10-26): hierarchy is no longer a set of `before` hooks: `set-role` is REMOVED from Better Auth's surface; role assignment is `Grants.assign` (subset rule + strictly-lower rank, `role:assign` critical with step-up) and the remaining BA admin endpoints sit behind one hook calling `Authz.require` (`AUTH-053`, `SEC-054`). The identity `userRules` hierarchy (`EFF-073`) maps to the same rank rule. Closed by consequence once `AUTH-053` + `SEC-054` land; `AUTH-044` stays the test.

- [ ] `AUTH-007` **Retire or fix the monolith user CRUD controller** · FIX · P0 · M · Deps: `SEC-001`
  - Why/Problem: `apps/api/src/modules/user/controllers/user.controller.ts:17-110` list/create/update/delete/checkEmail use only `requireAuth()`; `update` spreads `...updateData` into the repo (`user.repository.ts:~150`). Any signed-in user can create/modify/delete users. `UserModule` is still in `AppModule`. The identity service (`apps/api-services/services/identity/.../user.controller.ts`) has the correct rules.
  - Do: delete the monolith controller (preferred, tied to monolith retirement) or port `userRules` (admin-only list/create/delete, self-service whitelist, no self-ban, only superAdmin mints superAdmin, audit field guard).
  - Done when: no route in any shipped app lets a non-admin create/update/delete another user; AUTH-049 passes or module removed.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#0 (4), auth.md#4 (5)
  - Effect-impact (2026-10-26): the intended replacement now exists but is in flux: identity `user` Effect domain (list/count/findById/checkEmail/create/update/delete, `@deployer/identity-contracts`, 7 procedures) with rules ported; the monolith user module is not yet removed. Status: in-progress (replacement lacks unit specs and negative tests). Deps: `EFF-104`.
  - Design-impact (2026-10-26): the monolith user module is deleted with the cutover (design §7: "retire module"); identity rules are re-expressed as catalog permissions (`user:*`) + `assertGrantable`; the identity `user` procedures get `.access(...)` in `SEC-064`.

- [ ] `AUTH-008` **Use constant-time comparisons for all secret checks** · FIX · P1 · S · Deps: none
  - Why/Problem: `token !== devAuthKey` (`masterTokenAuth.ts:151`), `loginAs.ts:35`, `requireMesh` bare shared secret accepted with `===` (`core/modules/auth/orpc/middlewares.ts`). HMAC mesh tokens already use `timingSafeEqual`.
  - Do: `crypto.timingSafeEqual` over equal-length digests everywhere secrets are compared.
  - Done when: grep shows no `===`/`!==` on secret values in auth paths.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#3 (16), ops.md#R-05

### Invites
- [ ] `AUTH-009` **Fix invite plugin correctness** · FIX · P1 · M · Deps: `AUTH-002`
  - Why/Problem: `/invite/list` pending/expired filters compare `usedAt === undefined` but DB returns `null` (`invite.ts:264,272`) so "pending" returns nothing and "used" returns all; `validate` is not atomic (race: double-use); no email send; no resend/revoke; token lives only in the API response.
  - Do: fix null filters; make `validate` transactional (single `UPDATE ... WHERE used_at IS NULL RETURNING`); add revoke/resend; optional email delivery when a mail transport exists (AUTH-015).
  - Done when: concurrent `validate` calls succeed once; list filters return correct sets.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (Invites), auth.md#4 (2)
  - Design-impact (2026-10-26): `AUTH-009` fixes target the plugin that the design deletes; do only what is needed until `AUTH-065` (own `invitations` table: hashed token, 72 h, atomic single-use consume, revoke/resend, never listed) replaces it; its test cases carry over to `AUTH-042`/`AUTH-072`.

- [ ] `AUTH-010` **Build invite admin UI and accept page** · NEW · P1 · M · Deps: `AUTH-002`,`AUTH-009`
  - Why/Problem: no `authClient.invite.*` usage in web; sign-in page says "ask for an invitation" but there is no accept route.
  - Do: admin create/list/revoke invites in settings; public `/auth/invite?token=` accept page (set password, redirect to sign-in); show role chosen.
  - Done when: admin invites a user by email/link and the invitee can complete signup end to end in the UI.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (Invites)
  - Design-impact (2026-10-26): the UI builds against the `invitations` service (`AUTH-065`) with a grant-template editor (platform role + optional project grants capped by the inviter's own grants); project collaborator invites become grants with `source='invite'`.

- [ ] `AUTH-011` **Project collaborator invitations: pending/accepted flow** · ENHANCE · P2 · M · Deps: `AUTH-015`
  - Why/Problem: `services/project/.../project.service.ts:165` requires an existing user by email (404 otherwise); `acceptedAt` stays null; no email/notification; UI `InviteMemberDialog.tsx`. (Project-domain owner PROJ; role-escalation fix is `SEC-007`.)
  - Do: pending invitation records, accept/decline, optional email, expiry.
  - Done when: inviting an unknown email creates a pending invite that becomes a collaborator on accept.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (Invites), projects-services.md#1.1, projects-services.md#5

### Sessions and lifecycle
- [ ] `AUTH-012` **Set session policy and trusted-proxy IP handling** · NEW · P1 · M · Deps: `SEC-024`
  - Why/Problem: no `session.expiresIn/updateAge/freshAge`, no `rateLimit`, no `advanced.ipAddress.ipAddressHeaders` (defaults only); Traefik forwards client IP in headers.
  - Do: configure session lifetimes and freshness, IP header for Traefik, per-endpoint rate limits (sign-in, invite, device) via `SEC-024` shared store.
  - Done when: config present and covered by a test; rate-limited sign-in returns 429.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (session policy), auth.md#4 (12)
  - Design-impact (2026-10-26): session policy is specified in `AUTH-063` (absolute 30 d, idle 7 d, max 10 concurrent, `requireMfaFor`, device trust, new-device notification, revoke-all) and the trusted-proxy/IP part in `AUTH-064`; `freshAge` is set only for BA's own sensitive endpoints, not for step-up (`AUTH-062`).

- [ ] `AUTH-013` **Revoke sessions and API keys on ban/role change; bypass cookie cache for sensitive checks** · FIX · P1 · M · Deps: `SEC-001`
  - Why/Problem: Better Auth ban revokes only at next `get-session`; `cookieCache` (5 min) keeps stale role/ban; identity service `setBanned` is a raw DB write with no session revocation (best-in-class #7).
  - Do: revoke sessions/keys on ban/role change in both Better Auth and identity service; tag `sensitive` procedures to skip the cookie cache.
  - Done when: a banned/demoted user's next request is rejected immediately.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (ban), auth.md#3 (12), ideas-security-resilience.md#3 (7)
  - Effect-impact (2026-10-26): identity `setBanned` (`user.service.ts:164`) is a raw DB write, ported but exposed by no procedure; `update` can ban without `assertNotSelfDestruct`. Session revocation and cookie-cache bypass are still missing there. Evidence: `effect-health-identity.md` §4.3.
  - Design-impact (2026-10-26): satisfied structurally: authz never reads role or ban from the cookie cache (`AUTH-055`), grants come from the DB with epoch invalidation (`SEC-055`), and ban/disable is one transaction {grant revoke, session revoke, token revoke, epoch bump}; `user.role` is only a projection. Keep this item as the ban-transaction deliverable.

- [ ] `AUTH-014` **Validate session server-side in web middleware for `/device` and role-gated routes** · FIX · P2 · S · Deps: none
  - Why/Problem: `middlewares/WithAuth.ts` checks only cookie presence (`getSessionCookie`); `/device` not in the matcher; not-signed-in state on the device page has no sign-in link.
  - Do: validate session (cookie-cache result is already computed but unused), add `/device` to matcher with sign-in redirect.
  - Done when: invalid/forged cookie cannot reach role-gated pages; `/device` redirects to sign-in.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (web route protection), auth.md#4 (13)

- [ ] `AUTH-015` **Password lifecycle and mail transport** · NEW · P1 · L · Deps: none
  - Why/Problem: no change-password, forgot/reset, email verification or change-email (`sendResetPassword`/`sendVerificationEmail` absent); no mail transport. Needs a "mail not configured" operator path.
  - Do: SMTP/Resend adapter (pluggable), change-password (fresh session), reset, verify email; admin-set temporary password when no mail transport.
  - Done when: a user can reset a forgotten password end to end; without mail, an admin can set a temporary password.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (core), auth.md#4 (11)

- [ ] `AUTH-016` **Setup claim token bound to a passkey (replace default-admin bootstrap)** · NEW · P1 · L · Deps: `AUTH-005`,`AUTH-018`
  - Why/Problem: bootstrap relies on default admin/password; best-in-class #12 proposes a one-time claim token printed in the operator terminal, consumed at first superadmin creation, with immediate passkey enrolment and recovery kit (SETUP owns the wizard; recovery kit I-08 in IDEA).
  - Do: claim-token flow in setup + API; enrol passkey on claim; one-shot token consumed atomically.
  - Done when: a fresh install can only be claimed with the token; no default credentials exist.
  - Status: todo · Verified-in-code: no · Source: ideas-security-resilience.md#3 (12), auth.md#4 (3)
  - Design-impact (2026-10-26): the claim token becomes the `SetupClaim` principal (`AUTH-059`): one-time, atomic consume, bound to passkey enrolment (AAL3 after enrolment), replacing default-admin bootstrap; no default credentials anywhere.

### Second factor, passkeys, API keys, device flow
- [ ] `AUTH-017` **Finish TOTP 2FA end to end** · FIX · P1 · L · Deps: `AUTH-016` (recommended)
  - Why/Problem: enrol calls `twoFactor.enable({ password: '' })` (`domains/account/hooks.ts:263`, `devtools/plugins/security-panel.tsx:239`) which fails for credential accounts; no TOTP URI/QR, no `verifyTotp` in web; controls only in devtools; sign-in page has no `twoFactorRedirect` handling (`signin/page.tsx:~140-160`), so an enrolled user gets no challenge UI; no recovery path.
  - Do: prompt for password, show TOTP URI/QR + `verifyTotp`, handle `twoFactorRedirect` (TOTP, backup code, trusted device), move controls to Account settings, define recovery policy.
  - Done when: user enrols, signs out, signs in with TOTP and with a backup code; e2e test AUTH-047.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (TOTP), auth.md#3 (8), auth.md#4 (8)

- [ ] `AUTH-018` **Fix passkey rpID/origin** · FIX · P1 · M · Deps: none
  - Why/Problem: `usePasskey({rpName})` only; `PASSKEY_RPID/PASSKEY_ORIGIN` appear only in compose and are read by no code; plugin default rpID is `api.<domain>` while the browser origin is `web.<domain>`, so WebAuthn validation fails.
  - Do: set `rpID` to parent domain (`AUTH_BASE_DOMAIN` without leading dot), `origin` to web origin(s); read the `PASSKEY_*` env.
  - Done when: enrol + sign-in with a passkey works across `web.`/`api.`; test AUTH-047.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (passkeys), auth.md#3 (9), auth.md#4 (9)
  - Design-impact (2026-10-26): prerequisite, not part of the model: passkey rpID/origin is required for step-up (`AUTH-062`, passkey UV = AAL3) and for the setup claim; the AAL used by guardrails (`requireStepUpForCritical`) assumes working passkeys.

- [ ] `AUTH-019` **Fix API key transport and unify key systems** · FIX · P1 · M · Deps: none
  - Why/Problem: apikey plugin reads only `x-api-key`; devtools/orpc client sends `Authorization: Bearer <key>` (`web/lib/orpc/plugins/masterTokenClient.ts`); BFF fan-out forwards only cookie/authorization/mesh key, not `x-api-key` (`bff/src/clients/service-auth-context.ts:~60`). Minted keys authenticate nowhere.
  - Do: `customAPIKeyGetter` accepting `Authorization: Bearer dk_...` and `x-api-key`; forward `x-api-key` in `service-auth-context.ts`; keys resolve to a session actor.
  - Done when: a key minted in UI authenticates a CLI/HTTP call through the BFF to a service; test AUTH-048.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (API keys), auth.md#4 (10)
  - Design-impact (2026-10-26): this becomes `ApiTokenVerifier` (`AUTH-056`): `customAPIKeyGetter` accepting `Authorization: Bearer dk_…` and `x-api-key`; once the BFF forwards a signed actor claim instead of credentials (`AUTH-057`) the `x-api-key` forwarding in `service-auth-context.ts` is deleted, not fixed. Keys resolve to an Actor (principal = owner, credential = `api_token`, ceiling from `token_constraints`).

- [ ] `AUTH-020` **Delete the legacy hand-rolled project `ApiKeyService`** · FIX · P2 · S · Deps: `AUTH-019`
  - Why/Problem: provided in `project.module.ts` (both apps) with no controller or verifier (`findByHash` never used); role check uses nonexistent `"admin"` (see SEC-007); competing key system.
  - Do: remove service/repo/tests; keep one key system (Better Auth apikey).
  - Done when: no `ApiKeyService` references remain.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (API keys), projects-services.md#1.1
  - Design-impact (2026-10-26): confirmed: legacy `api_keys` table + `ApiKeyService` deleted (also tracked in `SEC-086`); Better Auth `apikey` plugin is the only key store, with `token_constraints` as side table (`AUTH-051`).

- [ ] `AUTH-021` **Align API key UI with behaviour** · FIX · P3 · S · Deps: none
  - Why/Problem: `ApiKeysCard` comment says "disable, record kept" but code calls `apiKey.delete`.
  - Do: either implement disable (retain record) or fix the comment/UX copy.
  - Done when: UI wording matches behaviour.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (API key UI)

- [ ] `AUTH-022` **Scoped per-project API tokens (deploy-only CI token)** · NEW · P2 · L · Deps: `AUTH-019`,`SEC-033`
  - Why/Problem: no scopes enforcement; best-in-class #9: key metadata maps to `ResourceRule[]` enforced by the same engine, never ad-hoc scope checks.
  - Do: key metadata (project/env/actions) compiled to rules; UI to mint per-project tokens.
  - Done when: a deploy-only token can deploy one project/env and gets 403 elsewhere.
  - Status: todo · Verified-in-code: no · Source: auth.md#5, ideas-security-resilience.md#3 (9)
  - Design-impact (2026-10-26): superseded by `AUTH-061` (scoped token lifecycle): scopes are NOT compiled to `ResourceRule[]`/`role_rules`; effective permission is evaluated live as owner grants ∩ token ceiling (`token_constraints`: kind, scopes, `maxRisk`, `readOnly`, IP allowlist, mandatory expiry, overlap rotation). Mint is capped by `assertGrantable`; a token can never mint tokens. Keep this ID as the deploy-only CI token acceptance case; also see `FEAT-080`. Deps now `AUTH-061`.

- [ ] `AUTH-023` **Device authorization: ship CLI client and improve approval page** · ENHANCE · P2 · M · Deps: `AUTH-014`
  - Why/Problem: server plugin and `/device` page exist; no client uses `/device/code`; CLI still uses master token/default creds/temp seed user (`apps/api/src/cli/services/cli-auth.service.ts:68-140`); page does not show client name/scope, no expiry countdown/re-auth; `/device/capabilities` missing. (CLI product item belongs to FEAT.)
  - Do: `deployer login` via device flow + bearer/API key; remove temp-seed-user strategy; show client id/scope/expiry, re-auth for sensitive scopes.
  - Done when: CLI authenticates via device flow with no master token.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (device), auth.md#5
  - Design-impact (2026-10-26): scope +: device flow yields a bearer session bound to a CLI device row whose approval page lists client, exact scopes, `maxRisk` and expiry (passkey tap for sensitive scopes), inheriting the approver's AAL capped at 2 (`AUTH-068`); also the mint path for agent tokens (`AUTH-069`).

### Role model and permissions
- [ ] `AUTH-024` **Define role `user` (or default new accounts to `viewer`) and fix `userSchema`** · FIX · P1 · S · Deps: `DEC-AUTH-4`
  - Why/Problem: DB default role `user` (`schema auth.ts:42`) is not in `PLATFORM_ROLES`; `userSchema.role = z.enum(PLATFORM_ROLES)` fails output validation for such rows; web `isPlatformRole('user')` returns null.
  - Do: pick the default (viewer recommended), migrate existing rows, fix contract schema and UI.
  - Done when: no row/response has a role outside the enum; contract tests pass.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (roles), auth.md#4 (14)
  - Decision (2026-10-26): `DEC-AUTH-15` accepted: default role for new accounts is `member` with no capabilities (not `viewer`, not `user`); legacy `user` migrates to `member`.
  - Effect-impact (2026-10-26): still open and visible in new code: `actorOf` defaults role to `'user'` (identity `user.controller.ts`), `ADMIN_ROLES` is a string set not tied to `PLATFORM_ROLES`, `userSchema.role` enum lacks `user`. Fix once in the shared Actor type when the Actor service is built. Deps: `EFF-014`.
  - Design-impact (2026-10-26): `DEC-AUTH-4` is superseded by `DEC-AUTH-15`: new accounts get baseline role `member` with NO capabilities (not `viewer`); legacy role `user` migrates to `member` (`SEC-052`); the role enum becomes the catalog-driven system role list (`SEC-049`) and `userSchema.role` is generated from it.

- [ ] `AUTH-025` **PermissionService: fail loud and seed default `role_rules`** · FIX · P1 · S · Deps: `SEC-001`
  - Why/Problem: `loadRoleRules` swallows errors via `.catch(() => [])` (`permission.service.ts:34`); empty rules mean DENY (`permission-engine.ts:106`) so naive wiring locks everyone out; superAdmin bypass at `:100`.
  - Do: propagate loader errors; seed `role_rules` from `permissions/config.ts` statements; audited break-glass for superAdmin.
  - Done when: loader failure surfaces an error (no silent allow/deny); a fresh install has working default rules.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#3 (11), ideas-security-resilience.md#3 (2)
  - Decision (2026-10-26): `DEC-AUTH-10` accepted: remove the `superAdmin -> ALLOW` bypass, BUT only after the host recovery CLI (`SEC-081`, `deployer authz recover`) and break-glass (`SEC-073`) exist. Sequencing (Deps): `SEC-081` and `SEC-073` before deleting the bypass in `SEC-053`; until then the bypass stays and fail-loud behaviour must not lock out the owner.
  - Effect-impact (2026-10-26): permission domain (`permission.service.ts:35` swallows loader errors `catch(() => [])`, 13 specs, no contract/consumer) is the next natural Effect port and becomes the policy service for SUB-A. Keep the fail-loud fix S on its own; the Effect port is a separate step. Deps: `EFF-104`, `EFF-014`.
  - Design-impact (2026-10-26): re-scoped (owned by the design): fail-closed `AuthzUnavailable` (503) replaces `.catch(() => [])` (`SEC-055`); the `superAdmin → ALLOW` bypass is DELETED (owner role holds all capabilities, guardrails apply to everyone, `DEC-AUTH-10`); no "seed `role_rules`": `role_rules` is DROPPED (no consumer, empty) and replaced by `authz_roles` + `authz_grants` seeded from `platformRolesConfig` (`SEC-050`, `SEC-052`); lock-out recovery is `deployer authz recover` (`SEC-081`), not an in-engine break-glass; boot invariant makes health not-ready instead of denying everyone.

- [ ] `AUTH-026` **`role_rules` management contracts and UI** · NEW · P2 · L · Deps: `SEC-033`
  - Why/Problem: no contract, endpoint or UI to manage `role_rules`; if the engine is kept it needs CRUD, caching and invalidation (see DEC-AUTH-8).
  - Do: standard.zod contracts + service/controller, TTL cache with event invalidation, admin UI with effective-permission view.
  - Done when: an admin edits a rule in UI and the next request reflects it.
  - Status: todo · Verified-in-code: no · Source: auth.md#5, ideas-security-resilience.md#3 (2)
  - Design-impact (2026-10-26): re-scoped to "roles & grants admin UI" (`SEC-089`) over `authz_roles`/`authz_grants`/`authz_policies` with the effective-permission view (`SEC-090`); there is no `role_rules` to manage. Deps now `SEC-054`, `SEC-089`.

- [ ] `AUTH-027` **Implement org/team layer (only if DEC-AUTH-1 says so)** · NEW · P3 · XL · Deps: `DEC-AUTH-1`
  - Why/Problem: Better Auth organization plugin not implemented; docs (`docs/qa/permissions/permission-system-design.md`, root AGENTS) describe org-centric Owner/Admin/Developer/Viewer that was not built; `PermissionService` says "No org layer".
  - Do: either build org/team (or project groups) or formally adopt platform+project roles and publish a permission matrix (docs owner DOC).
  - Done when: DEC-AUTH-1 decided and code/docs agree.
  - Status: todo · Verified-in-code: yes (absence) · Source: auth.md#1 (org), auth.md#6
  - Design-impact (2026-10-26): resolved as "do not build" (`DEC-AUTH-23`/D15): close `DEC-AUTH-1` as platform + project; the design leaves one extension point (new `org` ancestor scope type + nullable `projects.org_id`); mark `[~]` obsolete when the decision is recorded and docs are fixed (`SEC-102`, `DOC-008`). Groups come later (`SEC-101`).

- [ ] `AUTH-028` **Replace `authClient.admin.*` users page with ORPC user contract** · ENHANCE · P2 · M · Deps: `AUTH-006`
  - Why/Problem: `settings/users/page.tsx` uses Better Auth admin directly; offers "Remove" to `admin` though `admin` lacks `user:delete`; client-side search over 20 rows, no total count; no create-user, per-user sessions, last login, 2FA status, role history; `domains/user/*` ORPC hooks imported by no page.
  - Do: server-side pagination/search with totals via `userHooks`, per-user sessions/2FA/last login, hide actions the role cannot perform.
  - Done when: users page uses ORPC hooks with server pagination and correct action visibility.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (users, ORPC hooks), auth.md#5
  - Effect-impact (2026-10-26): web users page depends on identity-contracts behaviour that is currently incomplete: `user.create` cannot assign a role (contract and controller omit `role`), `user.update` does not apply the self-destruct guard for `banned`, `setBanned` is unexposed. Resolve before switching the page. Evidence: `effect-health-identity.md` §3, §4.3.
  - Design-impact (2026-10-26): the page consumes the capability set (`SEC-059`/`SEC-088`) to hide actions the actor cannot perform; role changes call `Grants.assign` (no `authClient.admin.set-role`); service accounts are filtered by `kind` (`AUTH-051`).

- [ ] `AUTH-029` **Auth audit events (system:audit producer)** · NEW · P2 · M · Deps: `OBS-001`
  - Why/Problem: `system:audit` permission exists with no producer; sign-in, role change, ban, invite, key mint, device approval are unrecorded (tamper-evident chain I-03 is an IDEA item).
  - Do: Better Auth hooks emit audit events to an append-only table/outbox.
  - Done when: listed auth events appear in an admin-viewable log.
  - Status: todo · Verified-in-code: no · Source: auth.md#5
  - Design-impact (2026-10-26): auth events are produced by the decision log (`SEC-068`, every decision) plus Better Auth hooks into `OBS-071`; the `audit:read`/`audit:export` permissions are catalog entries; coverage guard `OBS-085` is satisfied by the gate, not per controller.

- [ ] `AUTH-030` **Step-up / session freshness prompts for destructive actions** · NEW · P2 · M · Deps: `AUTH-018`,`AUTH-012`
  - Why/Problem: no re-auth for destructive actions; `require: fresh-passkey` primitive missing (I-18).
  - Do: freshAge policy + re-enter password/passkey prompt, usable as a policy `require`.
  - Done when: a destructive action older-than-fresh session triggers a prompt.
  - Status: todo · Verified-in-code: no · Source: auth.md#6, ideas-security-resilience.md#I-18
  - Design-impact (2026-10-26): owned by the design: `AUTH-062` (`POST /authz/step-up` wraps BA passkey verify, writes `step_up_events` for the CURRENT session; `session.freshAge` is NOT used for this) + `SEC-070` guardrail `requireStepUpForCritical` (AAL3 within 300 s) + `SEC-072` approvals with passkey assertions. Tokens cannot step up (AAL0).

- [ ] `AUTH-031` **Admin impersonation with banner and audit** · NEW · P3 · M · Deps: `AUTH-029`
  - Why/Problem: Better Auth admin impersonate is superAdmin-only; no UI.
  - Do: UI + persistent banner + audit entries.
  - Done when: superAdmin can impersonate with a visible banner and an audit record.
  - Status: todo · Verified-in-code: no · Source: auth.md#6
  - Design-impact (2026-10-26): owned by `AUTH-067`: read-only by default (`DEC-AUTH-25`), step-up + reason, never to an equal-or-higher principal, TTL 1 h, `onBehalfOf=[admin]` with effective permissions = target ∩ admin; BA `impersonate` wrapped via `AUTH-053`, not exposed raw. Priority raised only when `loginAs` removal needs a replacement (P2).

- [ ] `AUTH-032` **Account lifecycle: self-delete/export, email change, recovery codes, new-device notifications** · NEW · P3 · L · Deps: `AUTH-015`
  - Why/Problem: none exist; web push already exists for security notifications.
  - Do: implement items; new-device sign-in via web push.
  - Done when: each listed lifecycle action works.
  - Status: todo · Verified-in-code: no · Source: auth.md#6

- [ ] `AUTH-033` **IP allow-listing, login rate-limit dashboard, lockout notifications** · NEW · P3 · M · Deps: `SEC-024`
  - Why/Problem: no visibility/controls on login abuse.
  - Do: allow-list setting, dashboard of limited attempts, lockout notification.
  - Done when: operators can view and act on login throttling.
  - Status: todo · Verified-in-code: no · Source: auth.md#6

- [ ] `AUTH-034` **Service accounts (non-human identities) with expiry and rotation** · NEW · P3 · L · Deps: `AUTH-019`
  - Why/Problem: background/system paths have no identity (see SEC-030); machine identities tied to mesh nodes absent.
  - Do: service-account principal with expiry/rotation, usable by supervisors/webhooks.
  - Done when: a supervisor can call peers as a named service account.
  - Status: todo · Verified-in-code: no · Source: auth.md#6, architecture.md#2.4
  - Design-impact (2026-10-26): owned by `AUTH-066` (service accounts = Better Auth `user` rows with `kind='service_account'`, `DEC-AUTH-13`; own tokens, never sign in) and `SEC-075` (system actors for jobs) / `SEC-074` (service principals); mesh-node identities map to `MeshMember` principals (`AUTH-058`).

- [ ] `AUTH-035` **Agent Auth: register properly or remove dead code** · FIX · P3 · M · Deps: `DEC-AUTH-6`
  - Why/Problem: `useAgentAuth` defined but unregistered; no agent/host tables; web `useAgents/useAgentHosts` call 404 routes; `AgentConnectionsCard` renders errors.
  - Do: register plugin + tables + `/device/capabilities`, or delete plugin and UI cards.
  - Done when: no UI card calls a 404; decision applied.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (Agent Auth), auth.md#6
  - Decision (2026-10-26): `DEC-AUTH-18` accepted: the Agent Auth plugin is DELETED (`agentAuth.ts` and dead UI cards); agent tokens + device flow replace it (`AUTH-069`); revisit only if the spec stabilises. Not "register properly".
  - Design-impact (2026-10-26): decided: DELETE `agentAuth.ts` and the dead UI cards (`DEC-AUTH-18`/D10); agent tokens + device flow replace it (`AUTH-069`); revisit only if the Agent Auth spec stabilises. Effort drops to S (deletion).

- [ ] `AUTH-036` **Wire GitHub social login with minimal scopes (optional)** · ENHANCE · P3 · M · Deps: none
  - Why/Problem: factory supports GitHub (`auth.ts:155`) but `config/auth/auth.ts` never passes client id/secret; no sign-in button; scope `repo` over-broad.
  - Do: wire env, minimal scopes, verified-email account-linking policy; or remove option.
  - Done when: GitHub sign-in works with narrow scope, or code is removed.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (GitHub), auth.md#3 (17), auth.md#5

- [ ] `AUTH-037` **SSO: OIDC/SAML or GitLab login** · NEW · P3 · XL · Deps: `AUTH-036`
  - Why/Problem: no passwordless/SSO.
  - Do: OIDC/SAML provider support with account-linking policy.
  - Done when: login via an external IdP works.
  - Status: todo · Verified-in-code: no · Source: auth.md#5
  - Design-impact (2026-10-26): scope narrowed to OIDC only, Phase 6, via `@better-auth/sso` (`AUTH-073`); SAML explicitly not built, SCIM only on customer demand, LDAP no; JIT provisioning creates baseline `member`, optional `idp_group_mappings` create grants `source='sso'`. Deps +`AUTH-073`.

### Auth structure and hygiene
- [ ] `AUTH-038` **Pick one auth module and delete the duplicate** · ENHANCE · P2 · M · Deps: `DEC-AUTH-3`
  - Why/Problem: auth module duplicated in `apps/api` and `apps/api-services/shared` (`diff -rq` differs).
  - Do: keep the surviving copy, remove the other, move to a shared package.
  - Done when: single auth module.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#1 (operational), auth.md#4 (15)

- [ ] `AUTH-039` **Cache `getSession` per request** · ENHANCE · P3 · S · Deps: none
  - Why/Problem: AuthGuard and ORPC plugin both resolve the session; master-token hooks make each call hit DB.
  - Do: request-scoped cache.
  - Done when: one session lookup per request.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#5

- [ ] `AUTH-040` **Replace hard-coded trusted-origins subdomain list** · ENHANCE · P3 · S · Deps: none
  - Why/Problem: `trustedOrigins` includes `setup.`/`docs.` by hard-coded list.
  - Do: derive from config.
  - Done when: no hard-coded host list.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#3 (17)

### Substrate: authorization
- [ ] `SEC-001` **SUB-A: policy-gated authorization on every ORPC procedure (annotate, enforce, generate)** · NEW · P0 · XL · Deps: none (this is `SUB-A`)
  - Why/Problem: authorization is "logged in": counts of `requireAuth()` vs role checks: fleet 83/4, project 69/0, runtime 85/11, bff 18/0; BFF delegation (315 forwarders) adds none by design; delegation header claims services enforce gates, which is false for docker/cluster/fleet. New endpoints keep shipping with only `requireAuth()`.
  - Do: put `{resource, action}` metadata on every contract procedure via `standard.zod`; one middleware evaluates (platform role + project role + ownership); default-deny; build-time test fails if any procedure lacks metadata or explicit `publicAccess()`; generate the permission matrix doc page and the per-controller "403 for viewer/user" tests from the same metadata. Apply in services and (until retired) monolith.
  - Done when: lint/test fails on unannotated procedures; matrix page generated; `SEC-002..011` closed.
  - Status: todo · Verified-in-code: partial (counts from audit) · Source: auth.md#0 (3), architecture.md#4 (3), ideas-security-resilience.md#3 (1), docker-cluster.md#3 (1)
  - Effect-impact (2026-10-26): approach set (SUB-A) on Effect: procedure `meta {resource, action, risk}` + one oRPC middleware providing an `Actor`/`CurrentActor` Context service and calling an `Authz` policy service (typed `R` gives default-deny at compile time; shadow mode logs the would-be decision). Prerequisite: a per-request Effect context in `@deployer/nest-effect` (`EffectRuntime.context()` is process-global, actor is hand-threaded via `actorOf(context)`) and a settled error model. Only svc-health and identity `user` are `.effect()`; project/runtime/fleet/BFF are classic `.handler`, so ship the gate as a plain oRPC middleware (works for both idioms, `apps/api-services/shared/src/server/orpc-host.ts:137`) with Effect-based policy behind it. Effort XL unchanged, +S for prerequisites. Deps: `EFF-014`, `EFF-012`. Evidence: `effect-health-identity.md` §4.2, `effect-ecosystem-research.md` §2.14.
  - Design-impact (2026-10-26): `SEC-001` is OWNED by `authz-authn-design.md` ("Grants + Guardrails"); the approach (annotate with `{resource, action, risk}`, default-deny, shadow then enforce, 403 matrix) is kept but the mechanism is concrete: catalog (`SEC-048`), `.access()` builder (`SEC-061`), global gate middleware (`SEC-062`), `Authz` service (`SEC-057`), annotation (`SEC-064`), CI checks (`SEC-065`), generators (`SEC-066`), witness (`SEC-067`), rollout (`SEC-082..084`). Gate placement: `createOrpcModule` global middleware (works for `.effect()` and classic handlers); oRPC meta/input ordering is unverified (`DEC-AUTH-26`, spike `SEC-063`). Do NOT use `requireAuth()`/ad-hoc `requirePlatformRole` as the end state; interim coarse gates are tracked in `SEC-080`. Effort stays XL, now itemised as SEC-048..SEC-067. Deps now `SEC-063`.

- [ ] `SEC-002` **Platform-role gates on fleet providers, DNS, Cloudflare, GitHub/GitLab apps, keyring, node network config** · FIX · P0 · M · Deps: `SEC-001`
  - Why/Problem: `requireAuth()` only on: Cloudflare record create/delete (`cloudflare.controller.ts:152,180`), tunnel list/create/delete and `getTunnelToken` (`:248-253`), DNS provider account CRUD (`dns-providers.controller.ts:36`, stores API tokens), GitHub/GitLab app create/delete, `meshContract.trustKeyringSecrets` (`mesh.controller.ts:310`), `updateNodeNetworkConfig`, `getPublicIp`, `checkDomainGate`, `reachability.updateConfig`. A viewer can read the stack tunnel token, delete the tunnel, edit the zone or rewrite a node public address (the `direct` edge then publishes it into A records). Only lane/edge changes use `requirePlatformRole(["superAdmin","admin"])`. Duplicated in `apps/api-services/services/fleet`.
  - Do: `requirePlatformRole(["superAdmin","admin"])` (reads: operator+) on all listed procedures; stop returning the tunnel token to any client; apply to monolith copy or retire it.
  - Done when: viewer/user get 403 on each listed procedure; controller authz tests pass.
  - Status: todo · Verified-in-code: partial (cloudflare/docker controllers confirmed no role gate) · Source: auth.md#0 (3), networking.md#3 (1), networking.md#4 (1), architecture.md#4 (3)
  - Design-impact (2026-10-26): "role gates" become catalog permissions (`dns.provider:write` critical owner-only, `node:*`, `mesh:*`, `token:*`) enforced by the gate (`SEC-062`), not per-controller `requirePlatformRole`; any interim `requirePlatformRole` is temporary (`SEC-080`) and deleted at flip (`SEC-083`, first area: fleet/cluster/docker/secrets/dns). Tunnel token is `secret:reveal`-class (step-up + audit, `SEC-077`).

- [ ] `SEC-003` **Authorize and protect the docker domain (terminal, files, actions, env, platform containers)** · FIX · P0 · M · Deps: `SEC-001`
  - Why/Problem: `docker.controller.ts` uses only `requireAuth()`: any authenticated account (incl. Viewer) can open a shell and write/delete/rename files in any container (platform ones too), kill/remove any container (API, Postgres, Traefik, mesh), and read raw container env (`docker.repository.ts:1085` returns `Config.Env` unredacted; redaction `:598-606` applies only to service entities). No tenancy check tying a container to a project. Affected: terminal open/stream/input/close, filesystem list/read/write/delete/rename/mkdir, `actions.run`, image/runtime reads, `docker.entity.*`.
  - Do: read = any member; lifecycle/exec/files = admin/operator via `requirePlatformRole`; add project-scoped checks (container -> project label -> membership); deny kill/remove/exec on platform-managed containers unless superAdmin; redact container env for non-privileged readers; terminal audit log + idle timeout; mesh action routing must carry the same checks.
  - Done when: Viewer gets FORBIDDEN on each; platform containers protected; negative tests pass.
  - Status: todo · Verified-in-code: partial · Source: docker-cluster.md#3 (1), docker-cluster.md#4 (1), docker-cluster.md#5, ideas-security-resilience.md#0 (container exec)
  - Design-impact (2026-10-26): `container:exec` and `container:file.write` are `critical` (owner-only by default, production requires approval via `SEC-072`, session recording via `OBS-075`); `container:read` platform observation vs project-scoped actions use `byParent` container → service → project ancestry (`SEC-056`); platform containers need a `systemOnly`-style protection or deny grant. First area in the enforce order (`SEC-083`).

- [ ] `SEC-004` **Authorize cluster/fleet procedures and fix admission/allocation scoping** · FIX · P0 · M · Deps: `SEC-001`
  - Why/Problem: `cluster.controller.ts`, `fleet.controller.ts` only `requireAuth()`: any user can change swarm participation, node roles and ingress labels (`cluster.updateNode`), set node capacity, create/delete allocations, approve own admission request. `reviewedByUserId` always written `null` (`fleet.repository.ts:227`); `listMyAllocations` (`fleet.service.ts:104`) and `listMyAdmissionRequests` (`:169`) return everyone's rows; `checkMyAdmission` ignores `userId`.
  - Do: admin/operator gates on `setSwarmConfig`, `updateNode`, capacity, allocations, admission resolution; record reviewer; scope `listMy*`/`checkMyAdmission` to the caller.
  - Done when: viewer 403 on mutations; `listMy*` return only the caller's rows; reviewer recorded.
  - Status: todo · Verified-in-code: unverified · Source: docker-cluster.md#3 (1), docker-cluster.md#1.2 (fleet), docker-cluster.md#4 (1)
  - Design-impact (2026-10-26): gates become `node:update`/`node:label`/`node:drain` (high) and admission decisions record the reviewer from `CurrentActor`; `listMy*`/`checkMyAdmission` use `access.self()` scoping; `operator` keeps node ops (`node.operator` role, `SEC-078`) per `DEC-AUTH-24`.

- [ ] `SEC-005` **Stop leaking swarm join tokens to every authenticated user** · FIX · P0 · M · Deps: `SEC-004`
  - Why/Problem: `cluster.getSnapshot`/`streamSnapshot` return `joinTokens {worker, manager}` (`swarm-cluster.service.ts:176-178`); `cluster.getSwarmConfig` returns them (`swarm-participation.service.ts:434`). Manager token + reachable address = full cluster takeover. Tokens are stored plaintext in local SQLite (`cluster-node.repository.ts` `joinToken*`, `node_config.swarmConfig`).
  - Do: remove tokens from these responses; expose only through an explicit admin "issue join token/grant" procedure (join-grant flow exists); encrypt or avoid persisting at rest; rotate after use.
  - Done when: no snapshot/config response contains a token; tokens not present in SQLite plaintext.
  - Status: todo · Verified-in-code: unverified · Source: docker-cluster.md#3 (2), docker-cluster.md#4 (2)
  - Design-impact (2026-10-26): `node:join-token.reveal` is `critical`, platform scope only, step-up + audit, never part of list/info outputs (design §7). Land the P0 coarse `requirePlatformRole` + response stripping now (tracked in `SEC-080`); the permanent form is the catalog gate.

- [ ] `SEC-006` **Scope project/service reads, lists, streams, network and dependency endpoints to access** · FIX · P0 · M · Deps: `SEC-001`,`SEC-033`
  - Why/Problem: any authenticated user lists and reads every project and service (incl. env vars, provider config): `project.service.ts:63-73`, `service.service.ts:88-102`; `dependencies.list` has no access check; project/service event streams unscoped (replay always emits `projectCreated`); `getNetwork/updateNetwork` (project `project.controller.ts:183-195` and service) pass no user and do no access check; `project.list` supports only id/name/ownerId filters.
  - Do: `ProjectAccessService` read-level check on every list/get/stream/network/dependency procedure; scope `list` and streams to owned/collaborating projects (platform admins excepted); require admin/deploy level for network updates; server-side `projectId` filter (see WEB).
  - Done when: a non-member cannot read or stream another project's data; SEC-044 passes. Decision: DEC-SEC-6.
  - Status: todo · Verified-in-code: unverified · Source: projects-services.md#3 (1), projects-services.md#4 (1)
  - Design-impact (2026-10-26): `DEC-SEC-6` is resolved by the design: project data (services, deployments, logs) only via project grants; platform `admin`/`superAdmin` hold platform-scope `project:read`; platform `viewer`/`operator` read fleet/node/health views only; non-members get 404 concealment (`DEC-AUTH-14`). Implemented via `Authz.filter` SQL push-down (`SEC-058`) and stream re-validation on `authz_changed`; membership = grants, no `ProjectAccessService` owner shortcut.

- [ ] `SEC-007` **Fix project-role escalation and enforce collaborator rules** · FIX · P0 · S · Deps: none
  - Why/Problem: `assertNotOwnerGrant` and `assertRoleIsAssignable` (`domain/project.entity.ts:117,212`) are never called; `inviteCollaboratorSchema.role` includes `owner` (`collaborators.schema.ts:27-29`); maintainers can invite/promote anyone to owner and demote/remove other maintainers. `webhook.service.ts`/`api-key.service.ts` gate on nonexistent `"admin"` (monolith project service passes `["owner","admin"]`). Per-collaborator `permissions` JSON (canDeploy, canViewLogs...) is stored and never enforced; `deploy`/`manage` access levels unused by any caller.
  - Do: call the assertions on invite/update; add "cannot modify equal/higher role"; fix or delete the `"admin"` strings; decide enforce-or-drop of `permissions` JSON and use `deploy`/`manage` levels.
  - Done when: maintainer invite/promote to owner returns 403; tests cover the matrix.
  - Status: todo · Verified-in-code: unverified · Source: projects-services.md#1.1, projects-services.md#3 (2), projects-services.md#4 (2)
  - Design-impact (2026-10-26): collaborators become `authz_grants` at `project:<id>` (data migration `SEC-052`, table dropped `SEC-086`); `project:member.manage` is `high`; maintainers capped at ≤ maintainer by `assertGrantable` (`SEC-054`); owner grant only by an existing project owner/superAdmin; the dead `permissions` JSON (`canDeploy`…) is dropped, not enforced; the nonexistent `"admin"` strings disappear with the legacy services.

- [ ] `SEC-008` **Validate and authorize DNS record provisioning (project/service network)** · FIX · P0 · M · Deps: `SEC-001`
  - Why/Problem: `service-network.service.ts:181` `provisionDnsRecord` creates arbitrary DNS records (type/name/content) in the platform zone for any service on behalf of any authenticated user; no hostname-under-zone validation; same unchecked path in project network (`project-network.service.ts:61-185`).
  - Do: access check; hostname must lie within the project's zone; record-type allowlist; same validation in both network services.
  - Done when: record outside zone or by a non-member is rejected; tests added.
  - Status: todo · Verified-in-code: unverified · Source: projects-services.md#3 (1), projects-services.md#4 (1), projects-services.md#5

- [ ] `SEC-009` **Close cross-project injection and template scoping** · FIX · P0 · S · Deps: none
  - Why/Problem: sub-service create uses `child.projectId` from the request (`service.repository.ts:276`) while only the root's project is access-checked (`service.service.ts:108`); `parentId` not checked for same-project/access. Variable templates table is global (`project.repository.ts:699-715` TODO, `_projectId` ignored): all projects see and any project admin can edit/delete any template.
  - Do: force `child.projectId = parent.projectId` and verify `parentId` ownership; scope templates to project and check ownership on get/update/delete.
  - Done when: creating a child in a foreign project is rejected; template ops reject cross-project ids.
  - Status: todo · Verified-in-code: unverified · Source: projects-services.md#1.2, projects-services.md#1.3, projects-services.md#4 (1)
  - Design-impact (2026-10-26): resource selectors resolve ancestry from the STORED resource (`SEC-056`), so a client-supplied `projectId`/`parentId` mismatch is `Forbidden`; applies to both DNS provisioning (`domain:attach` high, `dns.record:write` critical) and cross-project injection (`SEC-009`).

- [ ] `SEC-010` **Authorize deployment reads, streams, queue, uploads and in-memory writes** · FIX · P0 · M · Deps: `SEC-001`
  - Why/Problem: `requireAuth()` only on list, get, logs, `stream*` (`deployment.controller.ts:37-78,155-174,204-268`), `queueFindJobById/queueListJobs` (`:429-445`), `uploadBundle` (no role, no size limit, `/tmp/deployer-uploads`), `createCompiledPlanSnapshot`, `upsertTemplateProvenance`, `compilePlan`. Any logged-in user can read logs, list/subscribe to any project's deployments, and see env vars (potential secrets) in queue job results.
  - Do: project-scoped access on reads/streams/queue; role + size limit on uploads; role gates on memory writes; strip env/secret values from job results and responses; per-event filter on streams.
  - Done when: non-members get 403/empty on each; secrets absent from queue job views.
  - Status: todo · Verified-in-code: unverified · Source: deployments.md#3 (10,12), deployments.md#4 (6), ideas-security-resilience.md#3 (4)
  - Design-impact (2026-10-26): streams authorize on subscribe, re-validate on `authz_changed` (or every 60 s) and close on loss of access (`SEC-058`); uploads need `deployment:create`-class permission + size limit; `deployment:rollback` is `high`; env/secret values stripped from job results (`SEC-077`).

- [ ] `SEC-011` **Lock down BFF/service surfaces that are anonymous or weakly gated** · FIX · P1 · M · Deps: `SEC-001`
  - Why/Problem: `console.webState` has no auth, other `console.*` only `requireAuth()` (`console-control.controller.ts`) so any viewer can toggle/restart/repoint the web origin or enable a tunnel; fleet `PlatformManagedWebController` (6 handlers) has no `requireAuth`/role (`platform-managed-web.controller.ts`); `DocsModule` publishes the whole API anonymously (`/openapi.json`, `/reference`); `test.*` controller (8 procedures + REST `test/*`) is mounted in the production BFF (`bff.module.ts:161`); `health.*` procedures unauthenticated (detailed output); `template.*` contract has no implementation.
  - Do: admin-gate console/managed-web; make openapi/reference/test/health.detailed non-anonymous or disabled in production; implement or remove `template` contract (FEAT owns implementation).
  - Done when: anonymous request to each returns 401/404 in prod mode.
  - Status: todo · Verified-in-code: unverified · Source: architecture.md#2.1, architecture.md#4 (3,17), architecture.md#5 (2)
  - Effect-impact (2026-10-26): Status -> partial: BFF `PlatformHealthController` is now explicitly `@AllowAnonymous()` (uncommitted); svc-health `check`/`detailed` still declare no stance (verified no `requireAuth`/`AllowAnonymous` in `health.controller.ts`), probably session-gated by the global guard (`auth.module.ts:226`, unverified at runtime) while the monolith had a public rate-limited `check` and `requireAuth()` `detailed`. Evidence: `effect-health-identity.md` N-5.
  - Design-impact (2026-10-26): the global default-deny gate makes "anonymous by accident" impossible: every anonymous procedure must declare `access.public({reason})` and appears in the reviewed public-allowlist snapshot (`SEC-065`); `health.*`/`openapi` stances are explicit entries there.

### Setup surface, SSRF, injection
- [ ] `SEC-012` **Lock down the anonymous `/setup/*` surface after setup** · FIX · P0 · M · Deps: none (coordinate with SETUP)
  - Why/Problem: BFF `setup.controller.ts:27` is class-level `@AllowAnonymous()` + `publicAccess()` on every handler; monolith `setup.controller.ts:44-290` same. `triggerInitialize` has no `setup_done` guard and promotes an existing user by email to superAdmin (`local-initialization.service.ts:~170-185,860`); `existingDatabaseUrl` lets a caller repoint the node to another Postgres; `probeDatabase` opens a connection to a caller URL (internal port-scan/oracle, returns driver error); `probeMesh`/`remoteAuth` make server-side requests and `remoteAuth` posts credentials to caller-supplied `${meshOrigin}`. `SetupGateService` exists only in `apps/setup`; no post-setup lock on the BFF path; `listPostSetupHints` returns literals.
  - Do: reject every `setup.*` procedure when `setup_done` or when caller is not the setup app/has no setup token; do not promote existing users; seed only when user table empty; restrict probe targets (see SEC-013).
  - Done when: after setup, every `setup.*` call returns 403/404; SEC-042 passes.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#0 (7), architecture.md#4 (2), architecture.md#5 (2)

- [ ] `SEC-013` **Add SSRF controls for probes, reachability checks and git clone URLs** · FIX · P1 · M · Deps: none
  - Why/Problem: `reachabilityContract.check` (`reachability.controller.ts:38-66`), `checkDomain` (`reachability.service.ts:278-380`), `probePeer` fetch arbitrary URLs/hosts for any logged-in user with no private-range filtering; `setup.probeDatabase/probeMesh/remoteAuth` (SEC-012); `git.service.ts:33` clones any URL on the API host (`--branch <user value>` unchecked, option-injection risk for leading `-`); no allow/deny logic for webhook/provider URLs.
  - Do: shared URL guard (scheme allowlist, resolve and block loopback/private/link-local unless explicitly allowed), apply to probes, git URLs, provider URLs; admin-only for probes; `--` separators and branch validation on clone.
  - Done when: probes to `127.0.0.1`/RFC1918/metadata addresses are refused; tests added.
  - Status: partial — probes and reachability checks are fixed in the live tier (see `NET-004`, 2026-10-27): `SafeHttp` + `EgressService`, setup `remoteAuth` included (it was an unauthenticated SSRF that also POSTed admin credentials; now operator-policy, refuses loopback/link-local/metadata, generic errors; also fixed `extractSessionCookie`, which could not split cookies joined by `, `). STILL OPEN: git clone URL/branch validation (`GitClient`, F2, `DEPLOY-030`); `setup.probeDatabase` (SEC-012); admin-only gating of probes; provider/webhook URLs (`OBS-019`, `FEAT-082`); internal call sites that carry the master/internal key (credential-leak concern for `SEC-003`) — updated 2026-10-27 · Verified-in-code: unit tests as listed on `NET-004` · Source: networking.md#3 (3), ops.md#1 (SSRF), ops.md#R-06, deployments.md#3 (11)

- [ ] `SEC-014` **Fix archive extraction (command injection, Zip-Slip) and client-controlled upload paths** · FIX · P0 · M · Deps: none
  - Why/Problem: `git.service.ts:133-135` runs `execSync(\`unzip -q "${filePath}" -d "${extractPath}"\`)` through a shell; `extractTar` (`~150-185`) does `path.join(extractPath, header.name)` with no containment so `../` entries write outside the workspace; `filePath` may be the client-supplied `uploadPath` (`upload-source-provider.service.ts:97-109`, contract `crud.ts:55`) and an arbitrary server directory can be the build context (`artifact-builder.service.ts:106-113`); `unzip` blocks the event loop; runs in a process holding docker.sock; duplicated in `apps/api`. Custom build commands also run arbitrary code as root alpine with `curl | bash` for bun (DEPLOY owns builder isolation).
  - Do: use a library with entry-path containment and size/entry-count limits (no shell strings); derive upload paths server-side from `uploadId` only; size/type limits; same fix in both trees.
  - Done when: a zip/tar with `../` entries or shell metacharacters in the name cannot write outside the workspace; SEC-040 passes.
  - Status: partial — the live-tier code path is FIXED: `apps/api-services/shared/.../git.service.ts` `extractUploadedFile` now delegates to `ArchiveExtractor` (no `execSync(unzip)`, no unchecked tar join; format sniffed from content; hostile archives -> `BAD_REQUEST`; 8 specs incl. a hostile-filename injection regression that reproduces on the old code). STILL OPEN: (1) the frozen monolith copy `apps/api/src/core/modules/git/git/services/git.service.ts` is untouched (AGENTS.md: monolith frozen; closed by deleting `apps/api`, ARCH cutover); (2) client-controlled `uploadPath` and upload authz/size (`DEPLOY-031/032`); (3) git URL/branch validation (`DEPLOY-030`, `SEC-013`) — updated 2026-10-26 · Verified-in-code: yes (execSync confirmed) · Source: ops.md#R-06, deployments.md#3 (9), deployments.md#4 (6)

- [ ] `SEC-015` **Sanitise upstream error messages returned to clients** · FIX · P2 · S · Deps: none
  - Why/Problem: BFF `optional()` returns raw `error.message` (internal URLs) (`screen-read.service.ts`); `probeDatabase` returns driver error text; down services surface as generic 500s.
  - Do: ProblemDetails-style mapping; log details server-side, return safe messages.
  - Done when: no internal hostnames/driver strings in client responses.
  - Status: todo · Verified-in-code: unverified · Source: architecture.md#2.1, architecture.md#6
  - Effect-impact (2026-10-26): Effect rule: undeclared failures are rethrown raw (`Cause.squash`) and become 500; sanitising belongs in the central `effect/wrap` mapper with a defect policy (500 body + correlation id + server-side log). Today `HealthCheckFailed.cause` is dropped with no log (N-4). Deps: `EFF-012`.

### Secrets and encryption
- [ ] `SEC-016` **Fix the encryption key derivation (R-02)** · FIX · P0 · M · Deps: none
  - Why/Problem: `schema-codecs.ts:37-46` does `Buffer.from(AUTH_SECRET, "hex")`; for the shipped non-hex `AUTH_SECRET` (`.env.example:174`, `.env.prod.example`) this is a 0-byte key, so ciphertexts (env vars, GitHub private keys, DNS credentials, cluster secret material, webhook secrets, GitLab token) depend only on the stored salt and are decryptable by anyone with the DB; non-production silently uses `scryptSync("temporary-fallback-key","salt",32)`; copy exists in `api-services/shared`.
  - Do: require a dedicated `ENCRYPTION_KEY` (32 bytes, Zod-validated hex/base64, production refinement); derive with HKDF; remove silent fallback outside tests; treat all currently stored secrets as exposed and rotate them; re-encrypt existing rows (coordinate with ARCH backfill).
  - Done when: boot fails in production without a valid key; unit test proves a non-hex secret is rejected; stored secrets re-encrypted under the new key.
  - Status: implemented, pending the operator reseal run — live tier: `registerSchemaCodecs()` now seals every write (`enc:v1:`, AES-256-GCM, HKDF from `DEPLOYER_ROOT_SECRET` falling back to `AUTH_SECRET`), production refuses to boot on a missing/weak/placeholder root, and legacy rows stay readable through an unchanged legacy reader (known-answer vectors from the old algorithm, incl. the empty-key case). Verified on all 11 real encrypted columns (write sealed, round-trip, legacy readable) and the reseal SQL on a real Postgres (450 uuid rows, batches, CAS, idempotent). Sweep: `reseal-secrets` CLI in the BFF, dry-run by default. STILL OPEN: operator must set the root secret, run `reseal-secrets --apply`, then rotate credentials if the old key was empty (docs/runbooks/secrets-encryption.md); delete the legacy path afterwards (`EFF-272`); the frozen monolith still writes the legacy form; the CLI was not run end-to-end (its pieces were) — updated 2026-10-26 · Verified-in-code: yes (`Buffer.from(secret,"hex")` at `schema-codecs.ts:45`) · Source: ops.md#R-02, ops.md#4 (P0-2), architecture.md#2.3
  - Effect-impact (2026-10-26): once the Effect infra layer exists, read the key via `Config.redacted` (fail-fast with all missing keys, `Redacted` never printed) and unwrap only at the codec; the fix itself (derivation) is unchanged. Deps: `EFF-028`. Evidence: `effect-ecosystem-research.md` §2.9.

- [ ] `SEC-017` **Harden env schema: security-critical vars required and validated in production** · FIX · P1 · M · Deps: `AUTH-003`
  - Why/Problem: `AUTH_SECRET`, `BETTER_AUTH_SECRET`, `DEV_AUTH_KEY`, `DEFAULT_ADMIN_PASSWORD` are all `optional()` (`packages/config/env/src/index.ts:188-193`); both secrets default to the literal `fallback-auth-secret` in all compose files, `managed-web-supervisor.service.ts:202` and `apps/setup/.../env.schema.ts:149` (a default secret forges sessions and derives the ingress token and column-encryption key); `MANAGED_GLOBAL_DB_PASSWORD` defaults to `"deployer"` (`index.ts:340`); only `schema-codecs.ts:51` hard-fails in production.
  - Do: required-in-production refinements (min length, reject placeholders/`fallback-auth-secret`/`adminadmin`); remove all fallback literals from compose and code; run `check-env` in CI.
  - Done when: boot in production mode with a placeholder secret fails; grep finds no `fallback-auth-secret`.
  - Status: todo · Verified-in-code: unverified · Source: auth.md#3 (7), ops.md#1 (env validation), ops.md#4 (P1-13)
  - Effect-impact (2026-10-26): env hardening can also feed an Effect `Config` layer at runtime build; keep `EnvService` (zod) as the single source and expose values as an Effect service instead of raw `process.env` (health redis indicator reads it raw). Deps: `EFF-028`.

- [ ] `SEC-018` **Separate secrets by purpose (session, column encryption, ingress token)** · ENHANCE · P1 · M · Deps: `SEC-016`,`SEC-017`
  - Why/Problem: one `AUTH_SECRET` signs sessions, encrypts columns and derives the ingress token, and is injected as plain env into every swarm service; any rotation makes stored secrets unreadable.
  - Do: independent secrets (`AUTH_SECRET`, `ENCRYPTION_KEY`, ingress token key) with HKDF domain separation.
  - Done when: rotating the session secret does not affect decryptability.
  - Status: todo · Verified-in-code: unverified · Source: architecture.md#4 (14), architecture.md#6, ops.md#R-02

- [ ] `SEC-019` **Key ring: key id, AAD binding, HKDF data key, rotation tool** · ENHANCE · P1 · L · Deps: `SEC-016`
  - Why/Problem: ciphertext has no key id/versioning, no AAD (rows can be swapped), `scryptSync` per decrypt blocks the event loop; no rotation/re-encrypt tool.
  - Do: format `v2:kid:...` (back-compat read of old), AAD = `table.column.rowId`, derive data key once via HKDF and cache, `rotate-secrets` CLI/job re-encrypting all `encryptedText` columns, optional KMS/Vault backend later.
  - Done when: rotating to a new key id re-encrypts all rows with zero downtime; swapped ciphertext fails to decrypt; benchmark shows no per-read scrypt.
  - Status: todo · Verified-in-code: unverified · Source: ops.md#4 (P0-2), ops.md#5, ops.md#6 (4), ideas-security-resilience.md#3 (11), ideas-security-resilience.md#0 (codec)

- [ ] `SEC-020` **Move platform secrets to Docker secrets / `*_FILE`; no default passwords** · FIX · P1 · L · Deps: `SEC-017`
  - Why/Problem: secrets are plain env or CLI args visible via `docker service inspect`/`ps`: `POSTGRES_PASSWORD` (`postgres-service.provisioner.ts:137`), BFF env (`bff-service.provisioner.ts:85`), Redis `--requirepass`, Traefik ingress token (`traefik-supervisor.service.ts:~382`), `DEFAULT_ADMIN_PASSWORD`; DB password default `"deployer"`; Redis has no password by default; `swarm-spec.mapper.ts` never emits `ContainerSpec.Secrets/Configs` (CLUSTER owns secret mounting for user workloads).
  - Do: Swarm secrets / `*_FILE` for platform services; require a Redis password; no default DB password.
  - Done when: `docker service inspect` shows no secret values for platform services.
  - Status: todo · Verified-in-code: unverified · Source: ops.md#R-08, ops.md#4 (P1-11), architecture.md#4 (14), docker-cluster.md#1.1

- [ ] `SEC-021` **Stop returning/storing secrets in clear in API responses and settings** · FIX · P1 · M · Deps: none
  - Why/Problem: `getSecurityConfig` returns `webhookSecret` and `basicAuthPassword` in clear to any reader (`project.service.ts:593-613`) and they sit unencrypted in `projects.settings` JSONB; service env vars (plain JSONB) returned in clear by `findById`; encrypted `environment_variables` table has no v3 consumer; `authSecretRef` options (Vault/AWS/GCP/Azure) are fake; env vars travel plaintext through queue job results (SEC-010); join tokens stored plaintext (SEC-005). (Env secret store itself is PROJ; reveal discipline I-21 is IDEA.)
  - Do: encrypt these fields via `encryptedText`, write-only/masked on read, require admin for reveal, implement or remove `authSecretRef`.
  - Done when: reads never return secret values; DB shows ciphertext.
  - Status: todo · Verified-in-code: unverified · Source: projects-services.md#1.1, projects-services.md#1.2, projects-services.md#3 (3), deployments.md#1 (env vars)
  - Design-impact (2026-10-26): the API/read side is owned by the design: `secret:list` / `secret:write` / `secret:reveal` split, values returned only by the explicit reveal procedure to a holder of `reveal` with step-up and audit (`SEC-077`); production reveal requires approval (`SEC-072`). Encryption-at-rest part of this item is unchanged.

- [ ] `SEC-022` **Stop replicating edge credentials in plaintext in the roster; rotate on revoke** · FIX · P1 · M · Deps: `IDEA-004`
  - Why/Problem: Cloudflare tunnel token lives in `edge.cloudflare-tunnel` in the roster: gossiped and stored on every node (`roster.json`) and visible in the connector swarm env; revocation does not rotate it, so a revoked/stolen node keeps tunnel and ACME credentials. (Node-scoped envelope secrets I-05 are IDEA; NET owns tunnel logic.)
  - Do: encrypt `edge.*` secrets or keep them off the roster; rotate tunnel token on member revocation; post-revoke cleanup referenced from NET.
  - Done when: roster contains no plaintext tunnel token; revoke triggers rotation.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3 (4), networking.md#4 (10), ideas-security-resilience.md#I-05

- [ ] `SEC-023` **Purge committed credentials and add secret scanning** · FIX · P0 · S · Deps: none
  - Why/Problem: tracked `200` (commit `f9522f7d9`) is a curl cookie jar with a live-format Better Auth `session_token`/`session_data` for `admin@admin.com` superAdmin (domain `.deployer.localhost`, expiry 2026-10-29); `.env.prod` tracked despite `.gitignore` (names a real domain, `ENABLE_SEEDING=true`); tracked `.tmp/local.db*` SQLite files and other junk (hygiene owned by OPS).
  - Do: rotate the session/secret, `git rm` `200`, `git rm --cached .env.prod` and `.tmp/local.db*`, add `.gitignore` entries, run gitleaks in CI and over history.
  - Done when: no secrets tracked; gitleaks job green in CI.
  - Status: todo · Verified-in-code: yes (`200` present at repo root) · Source: ops.md#R-12, ops.md#4 (P1-15)

### Hardening of the HTTP edge
- [ ] `SEC-024` **Rate limiting on sensitive surfaces with a shared store** · NEW · P1 · M · Deps: `AUTH-012`
  - Why/Problem: only two routes use the in-memory limiter (health, `platform.controller.ts:41`), keyed on the first `x-forwarded-for` hop (spoofable); nothing on sign-in, sign-up, reset, passkey, TOTP, webhooks, setup, uploads, deploy triggers, API keys; Better Auth limiter at defaults; no lockout; Traefik rate-limit middleware exists in the library only.
  - Do: Better Auth `rateLimit` with shared store (unlogged Postgres table, not Redis, `DEC-AUTH-19`) and strict rules; limiter on webhook/setup/upload/deploy routes; trusted-proxy handling; replace the in-memory limiter/dedupe with a shared store abstraction.
  - Done when: repeated bad sign-ins return 429; rules covered by test SEC-041.
  - Status: todo · Verified-in-code: unverified · Source: ops.md#R-09, ops.md#4 (P1-9), ops.md#5
  - Effect-impact (2026-10-26): parity gap: monolith `health.check` had `rateLimit(300/min)`; svc-health `check` has none (N-5). Include in the rate-limit surface list.
  - Design-impact (2026-10-26): the shared store decision is `DEC-AUTH-19`/D11, resolved 2026-10-26 with the operator accepting the DIFFERING recommendation: drop Redis for rate limits AND authz quota counters (`SEC-071`) and use an unlogged Postgres table (Better Auth `rateLimit` `secondaryStorage`/DB-backed accordingly); per-IP sign-in/invite/device limits stay here, per-actor/token/project `Limit` verdicts live in the guardrail layer.

- [ ] `SEC-025` **Security headers on web, doc and API; unsafe Next settings** · FIX · P1 · M · Deps: none
  - Why/Problem: no helmet/`headers()`/CSP/HSTS/frame-ancestors/nosniff/Referrer-Policy; `images.dangerouslyAllowSVG: true` (`next.config.ts:193`); `/api/nest/:path*` rewrite forwards arbitrary paths to the API root (`next.config.ts:126-135`); `typescript.ignoreBuildErrors` defaults true unless `CHECK_ON_BUILD=true` (`:105,139`); web middleware debug-logs request headers incl. cookies (`WithHeaders.ts`); Traefik header middleware not applied to platform routes (preset I-13 is IDEA).
  - Do: Next `headers()` + API middleware + Traefik middleware on platform routes; disable `dangerouslyAllowSVG`; restrict rewrite; `CHECK_ON_BUILD` default true for prod; stop logging cookies.
  - Done when: response headers asserted by test SEC-041; prod build fails on type errors.
  - Status: todo · Verified-in-code: unverified · Source: ops.md#R-10, ops.md#4 (P1-8), ops.md#1 (logging)

- [ ] `SEC-026` **Global request body-size limits** · FIX · P2 · S · Deps: none
  - Why/Problem: `bodyParser:false` and no explicit size limit anywhere (`app.config.ts:55`); uploadBundle has none.
  - Do: global and per-route limits.
  - Done when: oversize body returns 413.
  - Status: todo · Verified-in-code: unverified · Source: ops.md#1 (input validation), ops.md#R-09

- [ ] `SEC-027` **Mediate the Docker socket (proxy / capability broker) and verify non-root access** · FIX · P1 · XL · Deps: `DEC-SEC-1`
  - Why/Problem: socket mounted rw into setup, the API service (`api-service-provisioner.service.ts:323`), the BFF and every service-tier task (`services-tier-provisioner.service.ts:428` shared mount list) and the ingress (`:ro` does not restrict a socket), so any RCE/SSRF in the public BFF equals root on the swarm; `USER nestjs` (uid 1001) with the socket bind-mounted and no `user`/`groups` in specs (UNVERIFIED EACCES), `/app/data` not prepared for the named volume; scanner container also mounts the socket (`scanner-container-manager.service.ts:289`); builds run in the API process with the socket.
  - Do: socket proxy with an allow-listed API; remove the socket from BFF and non-runtime services; only `svc-runtime` and supervisors keep it; verify/define the non-root access mechanism; (builder sandbox pool I-19 is IDEA).
  - Done when: BFF container has no docker.sock mount; services start non-root with working access.
  - Status: todo · Verified-in-code: unverified · Source: ops.md#R-07, ops.md#R-17, ops.md#4 (P1-10), ops.md#6 (7), ideas-security-resilience.md#I-19

- [ ] `SEC-028` **Sanitise executor labels in runners (no `traefik.*` / `deployer.managed*` from users)** · FIX · P1 · S · Deps: none
  - Why/Problem: executor labels are copied verbatim into swarm service labels incl. `traefik.*`/`deployer.*` and spread last (`swarm-runtime-runner.service.ts:114,429-441`), so a deployment owner can override `deployer.managed` or inject Traefik routers; plain docker runner `sanitizeExecutorLabels` has the same weakness.
  - Do: allow-list `deployer.placement` and user labels under a reserved prefix; reject `traefik.*`/`deployer.managed*`.
  - Done when: deployment with `traefik.http.routers.x` label is rejected or stripped; test added.
  - Status: todo · Verified-in-code: unverified · Source: docker-cluster.md#3 (3), docker-cluster.md#4 (10)

- [ ] `SEC-029` **Protect platform hosts from domain hijack and confirm public console visibility** · FIX · P1 · M · Deps: none (verification enforcement is NET)
  - Why/Problem: routing never checks `verificationStatus` and `addServiceDomain` neither requires verification nor that the service belongs to the project; a project owner can register the platform public domain with subdomain `api`/`web` and compete for the same `Host()` rule (equal-length precedence undefined); `consoleVisibility` defaults to `public` so API/web/setup become internet-visible once a public lane exists.
  - Do: reserve platform hosts (`api.`,`web.`,`setup.`) so no mapping can claim them; global uniqueness of verified domains; confirmation when turning on `consoleVisibility:"public"`.
  - Done when: mapping a reserved host is rejected; enabling public console prompts a confirm.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3 (2,6), networking.md#4 (2), networking.md#5

### Inter-service authentication
- [ ] `SEC-030` **Replace raw cookie forwarding with a signed actor claim between BFF and services** · NEW · P1 · L · Deps: `DEC-SEC-3`,`IDEA-004`
  - Why/Problem: docs say BFF forwards a signed Actor claim; reality: raw browser `cookie`, `authorization` and `x-mesh-internal-key` are copied onto each fan-out call via AsyncLocalStorage (`service-auth-context.ts:59-66`, `service-registry.ts:23-28`); each service re-validates the session (two `getSession` calls/request); no service identity, token, mTLS or network policy, so anyone reaching `svc-*:310x` with a valid cookie is accepted; background/system calls (supervisors, schedulers, webhooks) have no credentials so cannot call peers.
  - Do: short-lived signed actor claim (sub, role snapshot, session id, approval refs) signed via the member key/agent socket and verified against the roster, doubling as audit actor; plus a service token for background calls.
  - Done when: services authorise the claim, not the cookie; a system call works without a user cookie.
  - Status: todo · Verified-in-code: unverified · Source: architecture.md#2.4, architecture.md#4 (4), ideas-security-resilience.md#3 (8)
  - Effect-impact (2026-10-26): same decision as ARCH-054/D3: signed claim vs forwarded cookie; services verify in an oRPC middleware that provides the `Actor` Effect service. Deps: `EFF-014`.
  - Design-impact (2026-10-26): decision made (`DEC-AUTH-11`/D3, resolves `DEC-SEC-3`, `EFF-016`, `ARCH-054`): signed EdDSA actor claim (30 s, aud-bound, jti replay-checked) for user-originated calls + service tokens (60 s) for background calls, both; permissions are NOT in the claim (services resolve grants from the DB for instant revocation); signer key admitted in the roster as a `service` member with `sign-actor` (interim Docker-secret keypair, same code path). Implemented as `AUTH-057` + `AUTH-060` (services stop accepting cookies); `SEC-032` becomes defence in depth.

- [ ] `SEC-031` **Fix anonymous svc-project -> svc-fleet calls (`DnsProviderGateway`) and unify client stacks** · FIX · P1 · M · Deps: `SEC-030`
  - Why/Problem: `DnsProviderGateway` uses the shared `ServiceClient` (`shared/src/server/service-client.ts:57`, no headers/fetch hook) whereas the BFF registry attaches the cookie; fleet DNS procedures all `requireAuth()`, so every project network/zone/record call is a 401; two parallel client stacks with different auth behaviour.
  - Do: one client stack (`@deployer/nest-service-client`) with auth propagation; fix the gateway; contract test over HTTP.
  - Done when: project network operations succeed against fleet; test SEC-043.
  - Status: todo · Verified-in-code: unverified · Source: architecture.md#4 (6), architecture.md#5 (4)
  - Design-impact (2026-10-26): resolved by service principals with least-privilege grants (`svc-project`: `dns.record:write`; `svc-runtime`: `container:*`, `node:read`) and the deputy rule (callee requires the service's grant AND the carried actor's `onBehalfOf` permission), `SEC-074`; one client stack carries the claim (`AUTH-057`).

- [ ] `SEC-032` **Restrict `svc-*` ports by overlay/network policy** · ENHANCE · P2 · M · Deps: `SEC-030`
  - Why/Problem: services are reachable on the overlay by anything that has a stolen/valid cookie; no network policy.
  - Do: attach services to an isolated overlay reachable only from the BFF (and required peers).
  - Done when: a task outside the tier cannot reach `svc-*:310x`.
  - Status: todo · Verified-in-code: unverified · Source: architecture.md#4 (4), architecture.md#2.4
  - Design-impact (2026-10-26): downgraded to defence in depth: after `AUTH-060` services accept only claims/service tokens/signatures, never cookies, so network policy is no longer the only barrier. Priority P2 → P3 once `AUTH-060` lands.

### Engine wiring (authorization best-in-class)
- [ ] `SEC-033` **Wire PermissionEngine behind SUB-A: shadow mode, then enforce, with project roles in context** · NEW · P1 · L · Deps: `SEC-001`,`AUTH-025`
  - Why/Problem: engine (`permissions/engine/*`, ~1.9k LOC) has no consumer; keyed by platform role only; project roles live in the project service (best-in-class #2, #3).
  - Do: seed rules, run engine next to the legacy check in shadow mode logging disagreements for a release, then flip; TTL cache + event invalidation; pass project membership as pre-resolved vars in `EngineContext` (`permission-engine.ts:86`) so one decision combines platform role, project role and ownership; do not build the org layer unless DEC-AUTH-1.
  - Done when: shadow disagreements are zero and enforcement is on.
  - Status: todo · Verified-in-code: unverified · Source: ideas-security-resilience.md#3 (2,3), auth.md#5
  - Effect-impact (2026-10-26): the unused `PermissionEngine`/`role_rules` sit in identity's untouched Nest permission domain; port it as the Effect policy service behind SUB-A, shadow mode first behind the user domain. Effort L unchanged. Deps: `EFF-104`, `EFF-014`.
  - Design-impact (2026-10-26): re-scoped, NOT "wire the engine as is": the engine is rewritten as a pure `evaluate` core + Effect `Authz` shell, keeping `filter-matcher`, `filter-compiler`, `resource-graph`, `rule-validator`; the `superAdmin` bypass, the cascade stub, `loadRoleRules().catch(() => [])` and the `PermissionBuilder` plugin system (+ compiled `.js` artifacts) are deleted; `role_rules` is DROPPED (not seeded). Implemented by `SEC-053`, `SEC-055`, `SEC-057` with rollout `SEC-082..084`; closes `DEC-AUTH-8` as "wire, as a rewritten shell". Project membership is grants, not pre-resolved vars. Deps now `SEC-053`, `SEC-057`. Effort L unchanged.

- [ ] `SEC-034` **SQL pushdown and stream filters for every list endpoint** · ENHANCE · P1 · L · Deps: `SEC-033`
  - Why/Problem: lists/counts/search fetch rows the caller cannot see; streams are unscoped (best-in-class #4).
  - Do: `compileDFilter` in list/count/search; per-event `matchFilter` on streams.
  - Done when: list/stream results for a non-member exclude other projects with one query.
  - Status: todo · Verified-in-code: unverified · Source: ideas-security-resilience.md#3 (4), deployments.md#3 (10)
  - Design-impact (2026-10-26): engine side delivered by `SEC-058` (`Authz.filter`: deny grants → NOT predicates, real FK-chain cascade replaces the over-granting stub, stream re-validation); this item keeps the rollout over every list/count/search/stream endpoint; verified by P-FILTER (`SEC-096`). Deps +`SEC-058`.

- [ ] `SEC-035` **Permission explain/simulate and table-driven policy tests in CI** · NEW · P2 · M · Deps: `SEC-033`
  - Why/Problem: no explainability (best-in-class #5).
  - Do: `permissions.explain(actor, action, target)` returning matched rules/reasons; UI "effective permissions" and rule-edit diff; table-driven fixtures run in CI.
  - Done when: explain endpoint and UI exist; fixtures run in CI.
  - Status: todo · Verified-in-code: no · Source: ideas-security-resilience.md#3 (5)
  - Design-impact (2026-10-26): engine API is `Authz.explain`/`Authz.simulate` (`SEC-060`; `explain` = `evaluate` with `trace:true`, `simulate` replays logged decisions through changed rules) and UI `SEC-090`; table-driven fixtures are `SEC-092`. Deps +`SEC-060`.

- [ ] `SEC-036` **Signed policy bundle anchored in the roster** · NEW · P3 · L · Deps: `IDEA-004`,`SEC-033`
  - Why/Problem: `role_rules` is a Postgres table a DB intruder can edit; principle fit is to publish the bundle hash in the roster and have services verify, failing closed with an alert (best-in-class #10; I-01/I-02 are IDEA).
  - Do: publish `policy.bundle` hash + version via signed roster setting; services verify before use.
  - Done when: tampered table causes fail-closed + alert.
  - Status: todo · Verified-in-code: no · Source: ideas-security-resilience.md#3 (10)
  - Design-impact (2026-10-26): deferred to Phase 6 with node-local enforcement (`SEC-101`); `DEC-AUTH-12`/D4: Postgres hosts human/API authz now, roster capabilities govern mesh-member authority (`SEC-076`), a signed policy bundle in the roster comes later. Policy tampering protection in the meantime: audited policy changes + decision log.

- [ ] `SEC-037` **Guardrail rule layer (deny/require) for sensitive actions** · NEW · P3 · L · Deps: `SEC-033`,`AUTH-030`
  - Why/Problem: delegation rules (role hierarchy) are scattered across Better Auth hooks and the identity service; best-in-class #6 wants them expressed as guardrail deny rules in one place (I-01 Layer B, owned by IDEA).
  - Do: express hierarchy and require-step-up rules as policy guardrails in the engine.
  - Done when: AUTH-006 hierarchy rules live in the policy layer.
  - Status: todo · Verified-in-code: no · Source: ideas-security-resilience.md#3 (6), ideas-security-resilience.md#I-01
  - Design-impact (2026-10-26): concrete design: typed guardrail layer (`Policy`, Deny > Require > Limit > Pass, shadow-mode policies, presets solo/team/strict) = `SEC-069`, built-in pack = `SEC-070`, quotas = `SEC-071`, approvals = `SEC-072`, break-glass = `SEC-073`; conditions use `DFilter` (`DEC-AUTH-21`). The hierarchy rule from `AUTH-006` is NOT a guardrail but the `Grants.assertGrantable` rank rule (`SEC-054`). Priority P3 → P1 for the pack that ships with enforcement. Deps now `SEC-069`.

### Coverage-pass additions
- [ ] `AUTH-050` **Server-enforced "require 2FA for admins" policy** · NEW · P2 · S · Deps: `AUTH-017`
  - Why/Problem: journeys J6 W6.11 asks for an admin-2FA requirement; only the UI setting is listed (WEB-025), nothing enforces it server side.
  - Do: Better Auth hook refusing admin/superAdmin sessions without a verified second factor once the policy is on; break-glass path via setup recovery.
  - Done when: an admin without 2FA is redirected to enrolment and gets 403 on admin procedures when the policy is enabled.
  - Status: todo · Verified-in-code: no · Source: journeys.md#J6 W6.11, bench-dokploy-dockhand.md#2 (MFA)
  - Design-impact (2026-10-26): concrete design in `AUTH-063` (`requireMfaFor:[roles]` in `security_settings`, enforced at sign-in and as a guardrail on `role:assign`/`user:*`); this item stays the acceptance case.
- [ ] `SEC-045` **Log hygiene: replace raw `console.*`, redaction coverage tests** · ENHANCE · P2 · S · Deps: none
  - Why/Problem: 28 raw `console.*` calls in api-services/setup runtime code bypass the logger redact-path list (`packages/infrastructure/logger/src/index.ts:180-191`); redaction is untested.
  - Do: route through the logger, add a redaction spec (password/token/secret/cookie, wildcard paths).
  - Done when: grep finds no `console.*` in runtime code; redaction spec passes. (Request-id propagation is OBS-005.)
  - Status: todo · Verified-in-code: partial · Source: ops.md#1 (logging)
- [ ] `SEC-046` **Deploy source allow-list policy (registries, git hosts, build egress)** · NEW · P3 · M · Deps: `SEC-013`,`SEC-033`
  - Why/Problem: no policy restricting which git hosts/registries a project may pull from or what a build may reach.
  - Do: operator-configured allow-lists enforced at deployment trigger and in the SSRF guard; builder egress rules later (IDEA-034/037).
  - Done when: a deployment from a non-allow-listed host/registry is rejected with a clear reason.
  - Status: todo · Verified-in-code: no · Source: ops.md#6 (6)
- [ ] `SEC-047` **Do not expose the internal Traefik config endpoint on the public API host** · FIX · P1 · S · Deps: none
  - Why/Problem: `/internal/ingress/traefik-config` is token-protected but reachable through `api.<domain>` (the token is derived from AUTH_SECRET, see SEC-018).
  - Do: serve only on the overlay/internal listener or deny the path at the public router.
  - Done when: request to the path via the public host returns 404.
  - Status: todo · Verified-in-code: unverified · Source: networking.md#3 (6), architecture.md#1

### Authorization & authentication target design (authz-authn-design.md)
> Design pass 2026-10-26 ("Grants + Guardrails": capability RBAC with scoped grants + deny + typed guardrails; Better Auth stays the authN engine; one `Actor`, one `Authz.require`). Design-only, nothing implemented or run. Design effort ≈ 9-12 engineer-weeks to enforced + tokens + step-up, +4-5 weeks admin UI/approvals/elevation/agents. Rollout order per design §9.2: P0 (cheap criticals, independent: `AUTH-001..007`, `SEC-005`, `SEC-012`, `SEC-080`) → P1 foundations (catalog, schema, `evaluate`, resolvers, `Authz`, gate in shadow on 3 pilots) → P2 coverage + shadow → P3 enforce by area → P4 credentials + guardrails → P5 UI → P6 later. IDs `SEC-048..102` = authorization system; `AUTH-051..073` = authentication/session/credential. All items need Template v1 (`EFF-001`, `EFF-014`) except where noted. Decisions: `DEC-AUTH-9..26` (D1..D18).

#### Catalog, roles, schema, migration
- [ ] `SEC-048` **Typed permission catalog with per-action risk tier (`packages/auth/src/authz/catalog.ts`)** · NEW · P0 · M · Deps: `EFF-001`
  - Why/Problem: today permissions are `platformBuilder`/`projectBuilder` statements plus a client `PLATFORM_RANK` table (`permissions/config.ts`, `apps/web/src/lib/access/platform-role.rules.ts`); no risk, no `mutating`, no parent, typos are not compile errors. Design §3.3.
  - Do: `defineCatalog({resource:{parent, actions:{action:{risk low|medium|high|critical, mutating, description, systemOnly?}}}})`; derive `Permission`/`PermissionPattern` types; port every existing statement 1:1 then add `container`, `secret`, `node`, `dns.provider`, `token`, `mesh`, `approval`, `elevation`, `setup`, `system`, `environment`, `domain`, `audit`; `risk` drives default guardrails, token ceilings, UI badge; `mutating` drives the 403 matrix and the agent read-only default; `parent` drives ancestry and the doc matrix; generate Better Auth `ac`/roles from it for the coarse admin plugin only.
  - Done when: `"deployment:creat"` is a compile error in contracts, roles, tests and web; web has no rank table input other than the catalog; catalog snapshot test.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §3.3, §4.3
  - Decision (2026-10-26): `DEC-AUTH-9` accepted: grants + guardrails (not flat RBAC, ReBAC or Cedar/OPA); this catalog is its base.
- [ ] `SEC-049` **System roles (code-owned) and custom roles with the subset rule** · NEW · P0 · M · Deps: `SEC-048`
  - Why/Problem: roles must be named permission bundles with immutable system definitions and safe custom roles. Design §3.4.
  - Do: `systemRoles.ts`: platform `superAdmin` (label Owner, all permissions, NO bypass), `admin`, `operator`, `viewer`, `member` (new baseline, self-service only); project `owner|maintainer|deployer|viewer`; node `node.operator`; upsert into `authz_roles` on boot with a content-hash `version` so a code change is a visible audited migration, not a silent re-seed; custom roles only in the DB with scope kind `platform|project`, creator may only include permissions they hold at that scope, `systemOnly` permissions never allowed, role count capped.
  - Done when: boot upserts roles and logs hash changes; creating a custom role containing a permission the creator lacks is rejected; Appendix A seed matrix is generated from definitions.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §3.4, Appendix A
  - Decision (2026-10-26): `DEC-AUTH-15`: default system role is `member` (no capabilities). `DEC-AUTH-24`: `operator` = observe + node operations only (`node.operator`); deploys require a project role (documented behaviour change, `SEC-085`).
- [ ] `SEC-050` **Core authz schema: `authz_roles`, `authz_grants`, `authz_policies`, `authz_epoch` (+ deferred `authz_groups`/`authz_group_members` stubs)** · NEW · P0 · M · Deps: `SEC-048`
  - Why/Problem: grants/scopes/deny/conditions/guardrails need tables; `role_rules` is unused. Design §4.2.
  - Do: Drizzle in `packages/nest/schema/src/global/identity/authz.ts`: `authz_roles` (kind, scopeKind, permissions[], contentHash), `authz_grants` (subjectType user|group|service, roleId XOR permissions CHECK, effect allow|deny, scopeType platform|project|environment|service|node|node_selector, scopeId/scopeSelector, DFilter condition, source seed|manual|invite|ownership|elevation|scim|migration, notBefore/expiresAt/revokedAt, grantedBy; partial indexes on subject and scope WHERE revoked_at IS NULL), `authz_policies` (mode enforce|shadow|off, effect deny|require|limit, priority, match, condition, requirements, limit, builtin), `authz_epoch` (subject_key, epoch); group tables created in Phase 6 only; migration is additive until enforcement completes.
  - Done when: migration applies on empty and populated DBs; CHECK `role_xor_perms` enforced; partial indexes present.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §4.2
  - Decision (2026-10-26): `DEC-AUTH-21` accepted: policy conditions use the existing `DFilter` (non-Turing, SQL-compilable), extended with `in`/`matches`/time/attribute paths only as needed; no CEL/Cedar. `DEC-AUTH-12`: policy lives in Postgres now.
- [ ] `SEC-051` **Approval and step-up schema: `access_requests`, `access_request_votes`, `step_up_events`** · NEW · P1 · S · Deps: `SEC-050`
  - Why/Problem: approvals, elevations and step-up need durable single-use evidence. Design §4.2.
  - Do: `access_requests` (kind approval|elevation, requesterId, via, permission, roleId, scope, actionHash, reason, requiredApprovals, status pending|approved|denied|expired|consumed|cancelled, ttlSec, expiresAt, consumedAt, grantId); `access_request_votes` (PK requestId+approverId, decision, assertionHash); `step_up_events` (sessionId, userId, method passkey|totp|password, aal, assertionHash, at, expiresAt).
  - Done when: migrations applied; atomic consume query `UPDATE ... WHERE status='approved' AND action_hash=$h RETURNING` has an index and test.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §4.2
- [ ] `SEC-052` **Seed generator and versioned data migration with dry-run report** · NEW · P0 · M · Deps: `SEC-049`,`SEC-050`
  - Why/Problem: existing roles/collaborators/ownership must become grants without locking anyone out. Design §9.1.
  - Do: one-shot generator reading `permissions/config.ts` to emit `authz_roles` rows mechanically, then extend with the new resources per the §9.3 decisions; `user.role` → one platform grant (`source='migration'`; legacy role `user` → `member`); `project_collaborators` → grants at `project:<id>`; `projects.ownerId` → `project.owner` grants (`source='ownership'`); seed default guardrails in `shadow` mode; dry-run report (counts per role, users with no resulting grant, projects without an owner grant); fail if no active human gets `platform.superAdmin`.
  - Done when: dry-run on a copy of prod-like data reports zero orphans; real run is idempotent.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §9.1
- [ ] `SEC-053` **Pure `evaluate(facts) → Decision` core; delete superAdmin bypass, cascade stub, fail-open loaders** · NEW · P0 · M · Deps: `SEC-048`,`SEC-050`
  - Why/Problem: `PermissionEngine` has a `superAdmin → ALLOW` shortcut (step 1), a `cascade` stub that "conservatively allows all rows", `loadRoleRules().catch(() => [])` and an "empty rules = DENY" accident. Design §3.2, §4.3, §5.2.
  - Do: `packages/auth/src/authz/evaluate.ts` with no Effect/IO: (1) credential ceiling ∩ delegation chain, (2) any matching deny grant → deny `explicit-deny`, (3) ≥1 matching allow grant (scope ∈ ancestry, permission matches, condition true) else `no-grant`, (4) each `onBehalfOf` hop passes 2-3, (5) guardrails fold Deny > Require > Limit > Pass, (6) allow; `trace` option; Decision = allow | deny | challenge; keep `filter-matcher`, `filter-compiler`, `resource-graph`, `rule-validator`; delete `PermissionBuilder` plugin system and compiled `.js`/`.js.map` artifacts under `src/permissions/system/builder`.
  - Done when: no bypass or cascade stub remains; table-driven + property tests (SEC-092..098) pass.
  - Status: todo · Verified-in-code: partial (bypass/stub observed by design pass) · Source: authz-authn-design.md §4.3, §5.2
  - Decision (2026-10-26): `DEC-AUTH-10` accepted: delete the `superAdmin` bypass (owner = all permissions, guardrails apply to everyone) BUT only after the host recovery CLI (`SEC-081`) and break-glass (`SEC-073`) exist. Sequencing (Deps): `SEC-081`, `SEC-073` before this deletion lands in enforce mode; keep the bypass (shadow-logged) until then.
- [ ] `SEC-054` **`Grants` service: assign/revoke/`assertGrantable` (no-escalation and rank rule) in one transaction** · NEW · P0 · M · Deps: `SEC-050`,`SEC-053`
  - Why/Problem: one rule must cap every grant, invite, custom role and token: `perms(new) ⊆ perms(grantor) at that scope`. Design §3.7, §6.7, §7.
  - Do: `Grants.assertGrantable(actor, request)`; `Grants.assign/revoke` with strictly-lower-rank rule for platform role assignment, `role:assign` is `critical`, owner grant only by an existing project owner/superAdmin with step-up or the recovery CLI, `superAdmin` never grantable via invite; bump `authz_epoch` and project `user.role` in the same transaction (AUTH-052); refuse changes that remove the last active owner (SEC-081).
  - Done when: property test P-ESC (SEC-093) green; no code path writes grants outside this service.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §3.7, §6.7

#### Resolvers, `Authz` service, gate, annotation
- [ ] `SEC-055` **`PermissionResolver`: grant resolution, per-request memo, process cache with epoch + NOTIFY, fail closed** · NEW · P0 · M · Deps: `SEC-050`,`SEC-053`
  - Why/Problem: decisions must be fast (<2 ms p50 warm) yet demotion must be near-instant. Design §5.7.
  - Do: per-request `Effect.cached`; process cache keyed `(subject, ancestryHash)` valid while `entry.epoch === currentEpoch && age < 30 s`; `LISTEN authz_changed` with the TTL as backstop; every write path bumps `authz_epoch` in-transaction and `NOTIFY`s after commit; `risk >= high` permissions bypass the cache (`fresh: true`); any loader/DB error → `AuthzUnavailable` (503), delete the `catch(() => [])`.
  - Done when: demotion takes effect within seconds for medium and immediately for high/critical; resolver fault injection yields 503, never allow (SEC-098).
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.7
- [ ] `SEC-056` **`ResourceResolver`: ancestry + attributes in one query, environment axis, node selectors** · NEW · P0 · M · Deps: `SEC-050`
  - Why/Problem: ancestry must come from the stored resource, never client-supplied `projectId` (cross-project injection, SEC-009). Design §3.5, §7.
  - Do: `resolve(ref) → {ref, ancestry [platform, project, environment, service], attrs {envKind, ownerId, labels, nodeId}}` via `RESOURCE_GRAPH`; per-request memo; `environment` is an optional second axis (grants at `environment:E` apply to a service only when the request carries that environment; requests without environment context are NOT covered); `node_selector` matched against node labels; claimed-vs-actual parent mismatch → `Forbidden`.
  - Done when: sibling-project and wrong-parent tests deny; env-scoped grant does not leak to env-less requests.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §3.5, §5.1
- [ ] `SEC-057` **`Authz.check` / `Authz.require`, typed errors and central oRPC error mapping** · NEW · P0 · L · Deps: `SEC-053`,`SEC-055`,`SEC-056`,`EFF-012`,`EFF-014`
  - Why/Problem: one decision function with one audit shape and typed failures. Design §5.3.
  - Do: tagged errors `Unauthenticated`, `Forbidden`, `NotFoundConcealed`, `StepUpRequired`, `ApprovalRequired`, `QuotaExceeded`, `AuthzUnavailable`; mapping in `effect/wrap` (401/403/404/401 `STEP_UP_REQUIRED`/403 `APPROVAL_REQUIRED`/429/503; Forbidden body has no grant details); add `STEP_UP_REQUIRED` and `APPROVAL_REQUIRED` to `STANDARD_DOMAIN_ERROR_DEFS`; `require` records the decision, consumes approvals atomically, returns an `Authorized<P>` witness; deny without `:read` → 404 concealment (D6).
  - Done when: error-mapping table test; deny without read yields 404, with read yields 403.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.3
  - Decision (2026-10-26): `DEC-AUTH-14` accepted: concealment: `Authz.require` returns 404 (`NotFound`) when the actor lacks `<resource>:read`, 403 only when read is held but the action is not.
- [ ] `SEC-058` **`Authz.filter`: SQL push-down for lists/counts/streams with real cascade and deny as NOT** · ENHANCE · P1 · L · Deps: `SEC-053`,`SEC-056`
  - Why/Problem: lists must be filtered in SQL, not in memory; the existing compiler is the main reason to reject Cedar/OPA/OpenFGA. Design §3.1, §5.3, §5.7. Implements the engine side of `SEC-034`.
  - Do: `filter(permission, type, {idColumn, resolver}) → {kind: all|none|sql}` using `buildWhereClause`/`filter-compiler.ts`; deny grants become NOT predicates; replace the cascade stub with an FK-chain subquery; streams: authorize on subscribe then re-validate on `authz_changed` or every 60 s and close on loss of access.
  - Done when: P-FILTER (SEC-096) green in real Postgres; one query per list.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.3, §5.7
- [ ] `SEC-059` **`Authz.capabilities` (`authz.capabilities`, `access.self()`)** · NEW · P1 · M · Deps: `SEC-057`,`SEC-069`
  - Why/Problem: web must render from server-computed capabilities, not a client rank table. Design §5.9.
  - Do: `CapabilitySet {actor{id,kind,aal,stepUpValidUntil,epoch}, platform[], projects{id:{permissions, environments}}, challenges{perm: Requirement[]}, generatedAt}` after deny/ceiling, only projects the actor can read; also feeds CLI/MCP manifests.
  - Done when: endpoint returns identical results to `check` for sampled permissions.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.9
- [ ] `SEC-060` **`Authz.explain` / `Authz.simulate` (trace mode and decision replay)** · NEW · P2 · M · Deps: `SEC-053`,`SEC-068`
  - Why/Problem: "why was this denied/allowed" and "what would this change break" must be answerable. Design §3.8. Implements the engine side of `SEC-035`.
  - Do: `explain` = `evaluate` with `trace:true` (ancestry, ceiling, per-grant matched/whyNot, delegation hops, policies with mode+verdict, requirements, `policyVersion`); self-explain always allowed, others need `audit:read`/`role:read`; `simulate(change)` replays the last N logged decisions through the changed grants/policies → `{newlyDenied,newlyAllowed,unchanged}`.
  - Done when: explain matches `require` for fixtures; simulate flags a removed grant.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §3.8
  - Decision (2026-10-26): `DEC-AUTH-20` accepted: decision log is tiered (always deny/challenge/mutating and `risk>=high` allows; 1% sampled low-risk reads), hash-chained; keep 30 d decision summaries so `simulate` can replay.
- [ ] `SEC-061` **Contract access annotation builder: `.access({permission, resource, audit, cli})` + `byInput`/`byParent`/`platform()`/`access.public({reason})`/`access.self()`** · NEW · P0 · M · Deps: `EFF-001`,`SEC-048`
  - Why/Problem: the contract is the single source for web, CLI manifest, MCP tools and the 403 matrix. Design §5.4.
  - Do: extend `@repo/orpc-utils` `standard.zod` builder; list contracts declare `list:{type,parent}`; `audit: none|event|diff`; risk defaults to catalog, may only be raised; `audience: "internal"` + `callers:[{service,onBehalfOf}]` for internal procedures (SEC-074); resource selectors resolved server-side.
  - Done when: a contract without `.access` fails type/CI check; selectors unit-tested.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.4, §5.6
  - Decision (2026-10-26): `DEC-AUTH-26` resolved-pending-spike: mechanism (meta read after validation vs path-keyed map) is settled by spike `SEC-063`; fallback is the path-keyed access map. Do not annotate hundreds of procedures before the spike.
- [ ] `SEC-062` **Global authz gate middleware (default deny) applied once by `createOrpcModule`** · NEW · P0 · L · Deps: `SEC-057`,`SEC-061`,`EFF-014`
  - Why/Problem: `requireAuth()`-only is the root of the P0 cluster; controllers can forget a gate. Design §0 (4), §5.4.
  - Do: `packages/nest/effect/src/authz-gate.ts`: read `meta.access`; missing → 500 + loud log (misconfigured); `public` → pass; `self` → `assertSelf`; list → defer to `Authz.filter`; otherwise `AuthzMode.forProcedure(path)` picks `require` (enforce) or `check` + shadow-disagreement log vs the legacy decision; stores the witness in context; global so it cannot be omitted; `requireAuth()` retires as an authorization mechanism (stays inside `Authn`); works for `.effect()` and classic `.handler` procedures (`orpc-host.ts:137`).
  - Done when: procedure without a gate is impossible to register; shadow and enforce both covered by tests via `call()`/HTTP.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.4
  - Decision (2026-10-26): `DEC-AUTH-26` resolved-pending-spike (`SEC-063`); gate keyed by meta or, as fallback, by procedure path via `implement(contract).use(authzGate(accessMapFromContract))`.
- [ ] `SEC-063` **Spike: oRPC meta/middleware-input mechanics + 3-procedure shadow pilot (one read, one mutation, one admin)** · NEW · P0 · S · Deps: `EFF-001`
  - Why/Problem: the gate reads `procedure["~orpc"].meta` after input validation — unverified [mem]; `callProcedure` in `packages/transport/orpc/src/testing` bypasses middleware and validation. Design §5.4, §9.2 P1, D18.
  - Do: confirm gate-after-validation ordering for `implement()`-style contracts; fall back to `implement(contract).use(authzGate(accessMapFromContract))` keyed by procedure path if needed; pilot the gate in shadow on 3 procedures; write the result into `DEC-AUTH-26` before annotating hundreds of procedures.
  - Done when: spike note recorded; pilot shadow log shows decisions.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §5.4, §9.2, §10 D18
  - Decision (2026-10-26): `DEC-AUTH-26` accepted as "resolve via this spike; fallback path-keyed access map": remains a TODO spike and still blocks/feeds `SEC-061`, `SEC-062`, `SEC-064` and dependants; the DEC is resolved-pending-spike, the spike itself is not done.
- [ ] `SEC-064` **Annotate every ORPC procedure (per area, mechanical, LLM-assisted, human-reviewed)** · ENHANCE · P0 · L · Deps: `SEC-061`,`SEC-063`
  - Why/Problem: fleet 83/4, project 69/0, runtime 85/11, bff 18/0 `requireAuth()` vs role checks. Design §9.2 P2.
  - Do: add `.access(...)` per area (fleet/cluster/docker/secrets/dns, runtime/deployments, project/service, identity/user/roles, bff screens); BFF delegated procedures are generated from the callee contract (excluding `audience: internal`); reviewed per area; unannotated count tracked.
  - Done when: CI check SEC-065 green with zero unannotated procedures; public list reviewed.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §9.2, §9.6
  - Decision (2026-10-26): `DEC-AUTH-26` resolved-pending-spike: annotation form (meta vs path-keyed map) depends on `SEC-063`.
- [ ] `SEC-065` **CI checks: unannotated procedure fails; permission in catalog; mutating-on-read-like; public allowlist snapshot; catalog ↔ role consistency** · NEW · P1 · M · Deps: `SEC-061`,`SEC-048`,`SEC-049`
  - Priority-review (2026-10-26): demoted P0 -> P1: default deny is already enforced by the runtime gate (SEC-062) and the type witness; the CI/snapshot guards harden but do not close an exploitable hole. Land right after SEC-064; SEC-064 Done-when references it, so treat as the exit check not a P0 blocker.
  - Why/Problem: default deny is enforced three times: runtime gate, build/CI check, type witness. Design §0 (4), §5.10, §9.5 (4).
  - Do: CI fails when a procedure lacks `access`, `permission` is not in the catalog, a `mutating` permission is attached to a read-like verb/name, or the public allowlist snapshot changes without review; every system-role permission must exist in the catalog.
  - Done when: each guard has a failing-fixture test.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.10, §9.5
- [ ] `SEC-066` **Generators from contract metadata: permission matrix doc page, 403 test matrix (independent oracle), CLI/MCP manifest, public-allowlist snapshot** · NEW · P1 · M · Deps: `SEC-061`,`SEC-065`,`FEAT-084`
  - Why/Problem: matrices must come from one source and use an oracle independent of `evaluate` so engine bugs cannot hide themselves. Design §5.10, §9.5 (3).
  - Do: script emits `apps/doc/.../authz-matrix.mdx` (procedure × system role → allow/deny/challenge from the role-definition table), generated negative tests for every `mutating` procedure × {anonymous, member, viewer, non-member project owner} + allow for the lowest passing role, the manifest, and the allowlist snapshot.
  - Done when: matrix page and tests generated in CI; deleting a procedure's test fails CI.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.10
- [ ] `SEC-067` **Proof-carrying `Authorized<P>` witness on service mutations** · ENHANCE · P2 · M · Deps: `SEC-057`,`SEC-062`
  - Why/Problem: defence in depth against a second entry point (webhook, SSE, supervisor) that forgets the gate. Design §5.5, D14.
  - Do: mutating service methods take `auth: Authorized<"service:update">` (brand constructor private to the Authz layer); `authorizedFor(permission)` helper hides the cast; required first for `mutating && risk>=high`, extended to all mutations by Phase 3; internal callers obtain a witness via `Authz.require` with their own Actor.
  - Done when: calling a high-risk mutation without a witness is a compile error; all high-risk mutations converted.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.5
  - Decision (2026-10-26): `DEC-AUTH-22` accepted: adopt the `Authorized` witness incrementally, `risk>=high` mutations first.
- [ ] `SEC-068` **`DecisionLog` → AuditLog (tiered volume, hash-chained, bounded queue, 30-day summaries)** · NEW · P1 · M · Deps: `OBS-071`,`SEC-057`
  - Why/Problem: one event per decision with a fixed shape; never fails the request; replay corpus for simulate. Design §5.8, D12.
  - Do: event `ts, requestId, actor{principal, credential, aal, via, ip, nodeId, onBehalfOf}, permission, risk, resource, decision{effect, reason, grantIds, policyIds, requirements}, policyVersion, shadow, approvalId, inputDigest`; always log denies, challenges, every mutating allow and every `risk>=high` allow; sample low-risk reads at 1% (always for `audit:read`, `secret:list`); bounded async queue with drop-counter metric; hash chain per `OBS-071`; keep ≥30 days of decision summaries; satisfies `OBS-085` via the gate.
  - Done when: deny/challenge/mutation always logged; queue overflow increments the metric without failing the request.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.8
  - Decision (2026-10-26): `DEC-AUTH-20` accepted: tiered logging (always denies/challenges/mutating and `risk>=high` allows; 1% sampled low-risk reads), hash-chained, 30 d decision summaries for simulate.
- [ ] `SEC-069` **Guardrail engine (`Policy`, combination law, shadow mode, DFilter conditions, presets)** · NEW · P1 · L · Deps: `SEC-053`,`SEC-050`
  - Why/Problem: restrictive policies over decisions (deny / require step-up / approval / reason / elevation / quota). Design §3.6. Implements `SEC-037`/`IDEA-006` Layer B.
  - Do: `Policy {id, mode enforce|shadow, evaluate(ctx)→Verdict}`; `Policy.all/when/fromRow`; verdict order `Deny > Require (union, strictest per kind) > Limit > Pass`; shadow policies compute and log but do not change the decision; presets `solo` (step-up for critical, cooldown instead of approvals), `team` (adds prod approvals), `strict` (two-person for critical, no standing owner); `authz_policies` CRUD with audited changes; builtin policies can be tuned, never deleted; D13: conditions use `DFilter` extended with `in`/`matches`/time/attribute paths only as needed.
  - Done when: combination law property-tested; shadow policy never alters a decision.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §3.6, §4.2
  - Decision (2026-10-26): `DEC-AUTH-21` accepted: guardrail conditions are `DFilter` expressions (extend minimally with `in`/`matches`/time/attribute paths). `DEC-AUTH-16`: preset `solo` degrades approvals to step-up + reason + cooldown; auto-suggest `team` at >= 2 humans.
- [ ] `SEC-070` **Built-in guardrail pack: step-up for critical, tokens never critical, prod-deploy approval, admin network allowlist, freeze windows, protected environments** · NEW · P1 · M · Deps: `SEC-069`,`SEC-072`,`AUTH-062`
  - Why/Problem: ship safe defaults, rolled out in shadow. Design §3.6, §6.12, §9.1.
  - Do: `requireStepUpForCritical` (AAL3 within 300 s for user principals), `tokensNeverDoCritical` (non-session credential + critical + no approval → Deny), `prodDeployNeedsMaintainerOrApproval` (`deployment:create` on `envKind=production` without maintainer → Approval{1, maintainer, excludeRequester, 900 s}), `adminsFromAllowedNetworks` (CIDR list in settings; gated on trusted-proxy fix AUTH-064), freeze-window deny (e.g. Fri 16:00-Mon 08:00 unless elevation), per-environment protected flag defaulting production environments to the prod policy, `secret:reveal` on production requires approval.
  - Done when: each policy has table tests; all seeded in `shadow` first.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §3.6, §6.1, §6.12
- [ ] `SEC-071` **`QuotaStore` and `Limit` verdicts (unlogged Postgres table; Redis dropped per `DEC-AUTH-19`)** · NEW · P2 · M · Deps: `SEC-069`,`SEC-024`
  - Why/Problem: stops a compromised CI token spamming deploys (counters live in an unlogged Postgres table; Redis is not given a purpose here, `DEC-AUTH-19`). Design §6.9, D11.
  - Do: `hit(key, windowSec) → count`; keys `actor|token|project|ip`; defaults e.g. `deployment:create` ≤ 30/h per token, `container:exec` ≤ 5 open sessions per actor, `token:mint` ≤ 10/day; per-IP limits for sign-in/invite/device endpoints reuse `SEC-024`.
  - Done when: exceeding a limit returns 429 `QuotaExceeded{retryAfterSec}`; quota counters work with Redis absent (unlogged Postgres table; periodic prune of expired windows).
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.9
  - Decision (2026-10-26): `DEC-AUTH-19` accepted the DIFFERING recommendation: no Redis for quotas/rate limiting; unlogged Postgres table. Consequence for `ARCH-070`/`DEC-ARCH-3`: Redis now has no consumer in auth either (leaning drop; removal still to confirm).
- [ ] `SEC-072` **Approvals / two-person rule with action-hash binding and solo-mode degradation** · NEW · P1 · L · Deps: `SEC-051`,`SEC-069`,`AUTH-062`
  - Why/Problem: an approval for "deploy v1.2 to prod" must not be reusable for "deploy v9 to prod". Design §6.1, D8. Concrete design for `IDEA-023`/`IDEA-042`/I-18.
  - Do: `Require Approval{count, approverRole, excludeRequester, ttl}`; gate returns `ApprovalRequired{requestId}` and creates `access_requests(kind='approval', actionHash=sha256(procedure,resource,inputDigest))`; approvers hold `approval:decide` for the scope, never the requester, approve with a passkey assertion (`assertionHash` stored); requester retries (web retries automatically); `evaluate` finds a matching approval and consumes it atomically, single use, TTL 15 min; solo mode degrades to StepUp(passkey) + Reason + Cooldown(60 s); preset auto-suggests `team` at ≥2 humans; applied to prod deploy, prod exec, `secret:reveal`, `node:revoke`, `project:delete`.
  - Done when: P-APPROVAL (SEC-097) green; a replayed approval is rejected.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.1
  - Decision (2026-10-26): `DEC-AUTH-16` accepted: one-person installs use preset `solo` (step-up + reason + cooldown instead of a second approver); suggest `team` at >= 2 humans.
- [ ] `SEC-073` **Break-glass / just-in-time elevation** · NEW · P2 · L · Deps: `SEC-072`,`SEC-054`
  - Why/Problem: standing powerful roles should be minimal; elevation is a recorded, expiring grant. Design §6.2. Concrete design for `IDEA-025`/I-06.
  - Do: `elevation:request` for a role at a scope for ≤ `maxTtl(role)` (default 30 min, owner 15 min) with mandatory reason; approval per policy (solo: step-up + cooldown); materialises as a grant `source='elevation'` with `expires_at` enforced by the same query (sweeper only cleans up); `actor.elevations` carried into every audit row; notify all owners (web push); emergency path = owner self-elevation with step-up + reason + loud notification (disabled by `strict`); exec sessions under elevation recorded by the executing node (`OBS-075`).
  - Done when: elevation expires without a cron; every decision under it carries the elevation id.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.2
  - Decision (2026-10-26): `DEC-AUTH-10` sequencing: break-glass is a prerequisite (with `SEC-081`) for deleting the `superAdmin` bypass in `SEC-053`.
- [ ] `SEC-074` **Service principals with least-privilege grants and the deputy rule** · NEW · P1 · M · Deps: `AUTH-057`,`SEC-054`
  - Why/Problem: services call each other anonymously or with forwarded cookies; confused-deputy risk. Design §5.6. Resolves `SEC-031`.
  - Do: `subjectType='service'` grants (e.g. `svc-project`: `dns.record:write`; `svc-runtime`: `container:*`, `node:read`); internal procedures declare `audience:"internal"` + `callers:[{service, onBehalfOf}]` and require BOTH the calling service's grant and the carried original actor's `onBehalfOf` permission on the same resource; internal procedures are excluded from the BFF public surface.
  - Done when: svc-project → svc-fleet DNS calls succeed with a service principal; a service cannot do for user A what A could not do directly.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.6
- [ ] `SEC-075` **System actors for background jobs (`Actor.system(job)`)** · NEW · P1 · S · Deps: `EFF-014`,`SEC-054`
  - Why/Problem: scheduler, supervisors, cleanup, migrations have no identity (`SEC-030`). Design §5.6 (5).
  - Do: provide `CurrentActor` via `Effect.provideService`; small fixed grants per job; audit shows `system:scheduler`; webhooks use the `Webhook` principal instead.
  - Done when: a supervisor call is authorized as a named system actor and audited.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.6, §2.1
- [ ] `SEC-076` **Mesh-member actors: roster capabilities → catalog `mesh:*` permissions; 2-signer revoke of admit-capable members** · NEW · P2 · M · Deps: `AUTH-058`,`IDEA-004`,`NET-069`
  - Why/Problem: any roster member can revoke any member / write any setting (I-02). Design §7, §10 D4.
  - Do: mesh-member Actor gets `mesh:*` permissions from roster capabilities (admission record), delegation can only narrow; `mesh:roster.revoke` of an admit-capable member needs 2 signers; humans' authz stays in Postgres (API tier is a coordinator for human actions).
  - Done when: a member without the capability is denied roster writes; 2-signer rule tested.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §7, §10 D4
  - Decision (2026-10-26): `DEC-AUTH-12` accepted: policy for human/API authz lives in Postgres now; roster capabilities govern mesh-member authority; a signed policy bundle in the roster comes later (`SEC-036`) for node-local enforcement. State in the architecture note that the API tier is a coordinator for human actions.
- [ ] `SEC-077` **Secrets scoping: split `secret:list` / `secret:write` / `secret:reveal`; scope to project/env/service; reveal only via the explicit reveal procedure** · ENHANCE · P1 · M · Deps: `SEC-048`,`SEC-062`
  - Why/Problem: secrets leak in reads and lists (`SEC-021`). Design §6.10.
  - Do: `secret:reveal` is `critical`, step-up, always audited with the secret id (never the value); API responses never contain values unless the caller holds reveal AND uses the reveal procedure; secrets scoped `(project, environment, service)` and, platform tier, to nodes via `node_selector` grants; node-side envelope scoping (I-05) is the independent second lock; production reveal requires approval.
  - Done when: list/read never return values; reveal is step-up + audit; tests.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.10
- [ ] `SEC-078` **Node-scoped grants: `node.operator` role and `node_selector` scopes** · NEW · P2 · M · Deps: `SEC-049`,`SEC-056`
  - Why/Problem: "Bob runs the edge nodes, not the whole fleet". Design §3.4, §3.5.
  - Do: scope types `node` and `node_selector {labels}` resolved against node labels; `node.operator` (label/drain/read on matching nodes); `node:join-token.reveal` platform-scope only.
  - Done when: a label-scoped operator can drain edge nodes only.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §3.4, §3.5
- [ ] `SEC-079` **`Webhook` principal with exactly one grant (deploy hook)** · NEW · P2 · S · Deps: `AUTH-059`,`SEC-054`
  - Why/Problem: inbound webhooks must be able to do exactly "deploy service X". Design §1.1, §11 (`FEAT-081`).
  - Do: webhook principal carries `{webhookId, projectId}`; created with one grant `deployment:create` on the service/environment; HMAC verification stays (constant-time).
  - Done when: a deploy hook can deploy its service and nothing else.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §1.1, §11
- [ ] `SEC-080` **Interim coarse gates (P0 phase) tracked for deletion in P3** · FIX · P0 · S · Deps: none
  - Why/Problem: the cheap criticals must not wait for the full design. Design §9.2 P0.
  - Do: temporary `requirePlatformRole` on the join-token endpoint (`SEC-005`) and other P0 holes; monolith user controller removed from `AppModule`; each temporary gate carries a `// TODO(SEC-083)` and is listed so it is deleted when its area flips to enforce.
  - Done when: list of temporary gates exists; none remain after `SEC-083`.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §9.2 P0
- [ ] `SEC-081` **Lock-out protection, boot invariant and `deployer authz recover` host CLI** · NEW · P0 · M · Deps: `SEC-054`
  - Why/Problem: with the bypass deleted, recovery must be a host-level action, and nobody may remove the last owner. Design §0 (5), §5.7, §6.12, §9.4.
  - Do: invariant in the same transaction: cannot delete/demote/ban/expire the last active human `platform.superAdmin`; deny grants cannot target the sole owner; boot invariant check (≥1 active human owner, system roles exist) else health reports not-ready instead of silently denying everyone; `deployer authz recover --grant-owner <email>` runs on a node (host root + DB access), writes to audit, is the only lock-out escape.
  - Done when: last-owner removal is rejected; recovery CLI restores access in a drill.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §3.5, §5.7, §6.12, §9.4
  - Decision (2026-10-26): `DEC-AUTH-10` sequencing: this CLI (and break-glass `SEC-073`) MUST exist before the `superAdmin` bypass is removed (`SEC-053`, `AUTH-025`) and before any area is flipped to enforce (`SEC-083`).
- [ ] `SEC-082` **Shadow-mode tooling and disagreement report** · NEW · P0 · M · Deps: `SEC-062`,`SEC-068`
  - Why/Problem: empty rules deny everyone today; naive wiring locks the operator out. Design §0 (8), §9.2 P2.
  - Do: `AuthzMode.forProcedure(path)` from settings rows `authz.mode.<area>` (not env); `logShadowDisagreement(path, legacyDecision)`; legacy oracle = existing inline checks and, for `requireAuth()`-only procedures, "allow" so the report is exactly "what would newly be denied"; one full release in shadow; report empty or every entry explained before the flip.
  - Done when: report available per area; exit criteria recorded.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §9.2 P2
- [ ] `SEC-083` **Enforce by area in the designed order (`authz.mode.<area>` flips)** · NEW · P0 · M · Deps: `SEC-082`,`SEC-064`,`SEC-044`
  - Why/Problem: blast-radius-ordered rollout. Design §9.2 P3.
  - Do: flip order fleet/cluster/docker/secrets/dns (`SEC-002..005`) → runtime/deployments (`SEC-010`) → project/service + `Authz.filter` on all lists/streams (`SEC-006`, `SEC-034`) → identity/user/roles → bff screens; each flip is an audited settings row; delete the temporary coarse gates (`SEC-080`) as each area flips; soak with no unexplained 403.
  - Done when: `SEC-044` negative tests green per area; all areas enforced.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §9.2 P3
  - Decision (2026-10-26): `DEC-AUTH-10` sequencing: no area flips to enforce (and the bypass is not removed) until `SEC-081` (recovery CLI) and `SEC-073` (break-glass) exist. Add both to Deps.
- [ ] `SEC-084` **Kill switch: fall back to shadow (never off), audited, auto-expiring, notified** · NEW · P1 · S · Deps: `SEC-082`
  - Why/Problem: rollback must not leave the platform open silently. Design §9.4.
  - Do: `authz.mode.<area> = shadow` (shadow still logs); flip needs `system:configure` + step-up; treated as break-glass with notification and auto-expiry back to enforce after N hours.
  - Done when: flipping back works, is logged, and re-enforces automatically.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §9.4
- [ ] `SEC-085` **Behaviour-change notice: `operator` loses platform-wide deploy/exec without a project role** · NEW · P1 · S · Deps: `SEC-052`
  - Why/Problem: biggest behaviour change for existing operators (D16). Design §9.3.
  - Do: release notes + in-app banner + migration dry-run listing affected users; `operator` keeps runtime observation and node ops (`node:read/label/drain`); deploy/exec in a project needs a project role; `container:exec`, `secret:reveal`, `dns.provider:write`, `mesh:roster.*`, `role:assign` are owner-only by default.
  - Done when: notes published before the flip; affected users listed.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §9.3, §10 D16
  - Decision (2026-10-26): `DEC-AUTH-24` accepted: `operator` = observe + node operations only; deploys require a project role (documented behaviour change; this notice is required). `DEC-AUTH-10`: the notice ships alongside the bypass removal, after `SEC-081`/`SEC-073`.
- [ ] `SEC-086` **Post-enforce cleanup migrations: drop `role_rules`, `project_collaborators`, dead flags; delete PermissionBuilder and web rank table** · ENHANCE · P1 · M · Deps: `SEC-083`
  - Why/Problem: v3 rule: no compatibility layers. Design §4.3, §9.4.
  - Do: drop `role_rules` (no consumer, empty) in the same change set as the engine rewrite; keep `project_collaborators` and `user.role` read-only for one release after the flip, then drop collaborators and dead `permissions` jsonb (`invitedBy/acceptedAt` move to `invitations`); `user.role` stays permanently as the write-protected projection; delete `apps/web` `platform-role.rules.ts`, `RequirePermission`/`RequireOrganizationRole`/`RequirePlatformRole`, `agentAuth.ts`, legacy `api_keys` table + `ApiKeyService`, `platform_invite` plugin; `projects.ownerId` kept as an attribute only.
  - Done when: no references remain; migrations applied.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §4.3, §9.4
- [ ] `SEC-087` **Hardening-hole closure checklist (design §7 table → roadmap IDs)** · NEW · P2 · S · Deps: `SEC-083`
  - Why/Problem: every audit hole must be shown closed by a design mechanism. Design §7.
  - Do: tracker table (hole → mechanism → ID → verifying test) covering sign-up/role injection, invite escalation, master token/loginAs, default admin, admin self-promotion, `requireAuth()`-only mutations, join tokens, unscoped reads/streams, collaborator escalation, cross-project injection, monolith user CRUD, cookie forwarding, `fallback-auth-secret`, cookie-cache staleness, engine fail-open, half-wired 2FA/passkey/API-key/device, roster flat authority, exec/terminal for viewers, missing auth audit; tick each when its verifying test is green.
  - Done when: all rows ticked.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §7

#### Web, UI
- [ ] `SEC-088` **Web `useCan` / `<Can>` / `useCanExplain` over the capabilities endpoint; STEP_UP and approval UX** · NEW · P1 · M · Deps: `SEC-059`,`WEB-016`
  - Why/Problem: replace `RequirePermission`/`RequireOrganizationRole`/`RequirePlatformRole` and the client rank table. Design §5.9.
  - Do: one TanStack query `["authz","capabilities"]` invalidated on 403/`STEP_UP_REQUIRED`/epoch change; `can(permission, {project, environment})`; `<Can fallback={<DisabledWithTooltip/>}>`; global passkey prompt on 401 `STEP_UP_REQUIRED` then retry the mutation once; `APPROVAL_REQUIRED` opens the "Request approval" sheet and shows the pending request in the inbox; server stays the boundary.
  - Done when: no `PLATFORM_RANK` on the client; disabled buttons show the reason.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §5.9
- [ ] `SEC-089` **Roles & grants admin UI** · NEW · P2 · L · Deps: `SEC-054`,`SEC-088`
  - Why/Problem: operators must manage roles, grants, deny grants, guardrail presets, session policy. Design §9.2 P5. Re-scopes `AUTH-026`.
  - Do: system/custom roles (subset rule feedback), grants per scope incl. expiry/reason/condition, deny grants highlighted, guardrail presets and policy tuning, grant review report ("who has what, stale grants, never-used tokens").
  - Done when: an admin edits a grant and the next request reflects it.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §9.2 P5, §6.12
- [ ] `SEC-090` **Access explorer UI and shadow-disagreement view** · NEW · P2 · M · Deps: `SEC-060`,`SEC-082`
  - Why/Problem: explain/simulate must be usable by operators. Design §3.8.
  - Do: "why denied/allowed" explorer, hypothetical grant/policy change preview (simulate), shadow disagreement report page.
  - Done when: explorer shows matched/unmatched grants with `whyNot`.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §3.8, §9.2 P5
- [ ] `SEC-091` **Approvals inbox and elevation UI** · NEW · P2 · M · Deps: `SEC-072`,`SEC-073`
  - Why/Problem: approvers need a place to see exact plans and approve with a passkey. Design §6.1, §6.2, §6.11.
  - Do: inbox of pending requests with human-readable plan (procedure, resource, input diff); approve/deny with passkey; elevation request form with reason/TTL; owner notifications.
  - Done when: two-person prod deploy works end to end in the UI.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.1, §9.2 P5

#### Test suites
- [ ] `SEC-092` **Table-driven `evaluate` tests (system role × permission × scope relation × ceiling variants)** · NEW · P0 · M · Deps: `SEC-053`,`SEC-049`
  - Why/Problem: the table doubles as the doc matrix. Design §9.5 (1).
  - Do: every system role × every catalog permission × {in-scope, sibling project, descendant, ancestor} × {token ceiling variants}.
  - Done when: table committed; matrix page diff-checked.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §9.5
- [ ] `SEC-093` **Property test P-ESC: no escalation (grants, invites, roles, tokens)** · NEW · P0 · M · Deps: `SEC-054`
  - Why/Problem: fast-check on every PR. Design §9.5 (2).
  - Do: for any actor A and any request G accepted by `assertGrantable`, `perms(G, scope) ⊆ perms(A, scope)`; for any accepted sequence the reachable set never exceeds the root's.
  - Done when: green in CI; mutation (weakening the rule) fails it.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §9.5
- [ ] `SEC-094` **Property test P-TOK: token ⊆ owner at every point in time (incl. after owner demotion)** · NEW · P1 · M · Deps: `AUTH-061`,`SEC-053`
  - Priority-review (2026-10-26): demoted P0 -> P1: tokens are not part of the P0 hole set; depends on AUTH-061 (P1). Proves the P1 token lifecycle, not a P0 fix.
  - Do: effective(token) = owner grants ∩ ceiling evaluated live; demote owner mid-sequence and assert the token loses the permission immediately.
  - Done when: green in CI.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §3.7, §9.5
- [ ] `SEC-095` **Property tests P-DENY (deny monotonicity) and P-INH (inheritance)** · NEW · P1 · S · Deps: `SEC-053`
  - Do: adding a deny never adds an allowed (permission, resource); adding an allow never removes one unless a deny exists; project-scope grant ⇒ allowed on every descendant, none on siblings or ancestors.
  - Done when: green in CI.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §9.5
- [ ] `SEC-096` **Property test P-FILTER: `filter()` SQL result set == `{r | evaluate(r)=allow}` in real Postgres** · NEW · P1 · M · Deps: `SEC-058`
  - Do: generated data in PGlite or the test container; includes deny (NOT) and cascade cases.
  - Done when: push-down and checker agree on all generated cases.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §9.5
- [ ] `SEC-097` **Property test P-APPROVAL: single-use, identical action hash only, under concurrent consumption** · NEW · P1 · M · Deps: `SEC-072`
  - Do: concurrent `consume` of one approval succeeds exactly once; a different action hash never matches; expired/consumed requests are rejected.
  - Done when: green in CI.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §6.1, §9.5
- [ ] `SEC-098` **Property tests P-DELEG (intersection over `onBehalfOf` chains) and P-FAILCLOSED (resolver exception ⇒ 503/deny)** · NEW · P1 · S · Deps: `SEC-053`,`SEC-055`
  - Do: delegated result equals the intersection of hops; injected resolver/DB failure never allows.
  - Done when: green in CI.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §9.5
- [ ] `SEC-099` **Shadow-diff harness: replay recorded traffic against old vs new decisions** · NEW · P1 · M · Deps: `SEC-082`
  - Do: record production-like traffic and replay through legacy checks vs `evaluate`; output the newly-denied list.
  - Done when: harness runs in CI nightly against fixtures.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §9.5 (6)
- [ ] `SEC-100` **Mutation test of the gate: removing the gate from one controller must fail the matrix** · NEW · P1 · S · Deps: `SEC-066`
  - Do: test build strips the gate from one controller and asserts the generated matrix fails; run through full `call()`/HTTP, never `callProcedure`.
  - Done when: the mutation is caught.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §9.5 (3, 7)

#### Deferrals, documentation
- [ ] `SEC-101` **Phase 6 deferrals: groups, org extension point, signed policy bundle, node-local enforcement, catastrophic-op quorum (trigger-based)** · NEW · P3 · L · Deps: `SEC-083`,`IDEA-004`
  - Why/Problem: design recommends NO org layer (one mesh = one tenant, D15), groups when ≥3 humans, rest later. Design §8, §9.2 P6.
  - Do: groups = `authz_groups` + membership with grants targeting a group (1-hop subject set so SQL stays an `IN`); leave `org` as a future ancestor scope type (+ nullable `projects.org_id`, resolver change only); signed policy bundle in the roster (`SEC-036`); node-local enforcement of exec/secret unwrap; quorum for catastrophic mesh ops (`IDEA-004`); close `DEC-AUTH-1` as "platform + project".
  - Done when: each sub-feature triggered or explicitly parked with the trigger recorded.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §8, §9.2 P6
  - Decision (2026-10-26): `DEC-AUTH-23` accepted: no org layer now; keep only the `org` ancestor extension point (nullable `projects.org_id`); groups later. `DEC-AUTH-12`: policy in Postgres now.
- [ ] `SEC-102` **Authorization architecture docs and ADR (D1..D18, mesh-first trade-off for Postgres-hosted human authz)** · NEW · P2 · S · Deps: `SEC-063`
  - Why/Problem: the architecture doc must state that the API tier IS a coordinator for human actions while mesh-member authority lives in the roster (D4); root `AGENTS.md`/`docs/qa/permissions` drift (`DOC-008`).
  - Do: add an authz architecture page, ADRs for the decisions, permission-matrix page link, fix org/Owner-Admin-Developer-Viewer promises; record in `docs/qa/permissions/`.
  - Done when: docs published with the same change set as each phase.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §10 D4, §8
  - Decision (2026-10-26): `DEC-AUTH-12` accepted: policy in Postgres now (this item states it in the architecture doc: API tier = coordinator for human actions; mesh-member authority via roster capabilities). `DEC-AUTH-23` closes `DEC-AUTH-1` as platform + project.

#### Authentication, sessions, credentials
- [ ] `AUTH-051` **Schema: service-account columns on `user`, `token_constraints`, `invitations`** · NEW · P1 · S · Deps: `SEC-050`
  - Why/Problem: service accounts are Better Auth user rows; token constraints and invitations need their own tables. Design §4.2.
  - Do: `user.kind ('human'|'service_account')`, `owner_id`, `disabled_at`; `token_constraints` (apikey_id PK, kind pat|ci|agent|deploy_hook|cli, scopes ScopeRef[], maxRisk default medium, readOnly, ipAllow cidr[], rotatedFromId, lastUsedIp/At, createdVia); `invitations` (email, tokenHash unique, grantTemplate GrantDraft[], invitedBy, expiresAt, acceptedAt, revokedAt); user lists filter by `kind`; sign-in rejects `kind != 'human'` in a session `before` hook.
  - Done when: migrations applied; service accounts cannot sign in.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §2.1, §4.2
  - Decision (2026-10-26): `DEC-AUTH-13` accepted: service accounts are `user` rows with a `kind` column (no separate table); `DEC-AUTH-17`: own `invitations` table.
- [ ] `AUTH-052` **`user.role` becomes a write-protected projection (`input:false`, set only by `Grants.assign/revoke`)** · FIX · P0 · S · Deps: `AUTH-001`
  - Why/Problem: `auth.ts:135` has `input:true`; BA's admin plugin and old readers must still see a coarse platform role. Design §4.1.
  - Do: `input:false`; written only in the `Grants` transaction; coarse BA `ac` generated from the catalog.
  - Done when: client-supplied role is ignored; the column always equals the platform grant.
  - Status: todo · Verified-in-code: yes (`input: true` at `auth.ts:135`) · Source: authz-authn-design.md §4.1
- [ ] `AUTH-053` **Front the Better Auth admin plugin: `before` hook delegating to `Authz.require`; remove raw `set-role`** · FIX · P1 · M · Deps: `SEC-054`,`SEC-057`
  - Priority-review (2026-10-26): demoted P0 -> P1: AUTH-006 (P0) closes the admin->superAdmin hole interim; this is the final design route via Authz.require. Do it after SEC-054/057 land; AUTH-044 tests AUTH-006 meanwhile.
  - Why/Problem: BA `set-role` has no hierarchy; admin can self-promote or act on superAdmin. Design §4.1, §7. Closes `AUTH-006` by consequence.
  - Do: restrict BA admin endpoints (`create-user`, `ban`, `remove`, `update`, `impersonate`) through the hook; delete `set-role` from the surface; replacement is `Grants.assign` with subset + strictly-lower-rank rule; `role:assign` critical (step-up).
  - Done when: admin gets 403 granting or acting on an equal/higher role; `AUTH-044` passes.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §4.1, §7
- [ ] `AUTH-054` **`Actor` model, `CurrentActor` and the `Authn` service (exactly one credential per request)** · NEW · P0 · M · Deps: `EFF-014`
  - Why/Problem: today `ORPCAuthContext` + role string; every caller kind must normalise into one value. Design §2.1-§2.3. Implements `EFF-014`.
  - Do: `packages/auth/src/authz/actor.ts` with `Principal` (user, service_account, agent, service, mesh_member, webhook, system, setup_claim, anonymous), `CredentialKind`, `Assurance` (AAL 0-3, authTime, stepUpAt), `Ceiling` (all | scoped{permissions, scopes, maxRisk, readOnly, expiresAt}), `Origin`, `Delegation`, `onBehalfOf`, `elevations`; `CurrentActor` always provided by `effect/wrap` (anonymous if no credential); `Authn` tries each verifier whose `matches` is Some; two different kinds → 400 `AMBIGUOUS_CREDENTIALS`.
  - Done when: every entry point yields an Actor; ambiguity test.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §2
- [ ] `AUTH-055` **`SessionVerifier`: DB-read grants, cookie cache bypassed for gate decisions, device bearer sessions** · NEW · P1 · M · Deps: `AUTH-054`
  - Priority-review (2026-10-26): demoted P0 -> P1: gate decisions in P0 can use the existing session; cookie-cache bypass and device bearer sessions are hardening (stale role/ban window <=5 min). Promote cookie-cache bypass for risk>=high if the gate flips admin areas first.
  - Why/Problem: cookie cache serves stale role/ban for 5 minutes. Design §2.2, §6.4.
  - Do: authz never reads role or ban from the cookie cache (cache stays for UX reads); AAL from method (password 1, +TOTP 2, passkey UV 3); CLI device sessions as bearer tokens bound to a device row, AAL inherited at approval capped at 2.
  - Done when: a banned/demoted user is rejected on the next request.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §2.2
- [ ] `AUTH-056` **`ApiTokenVerifier`: `Authorization: Bearer dk_…` via `customAPIKeyGetter`, constraints, IP allowlist before grant lookup** · NEW · P1 · M · Deps: `AUTH-054`,`AUTH-051`,`AUTH-019`
  - Why/Problem: API key plugin reads only `x-api-key`; tokens authenticate nowhere. Design §2.2, §6.5.
  - Do: BA verifies hash/expiry/rate limit; we load `token_constraints`; AAL0 (no step-up); reject disallowed IPs before any grant lookup; tokens fail authentication when the owner is banned/disabled.
  - Done when: a minted token authenticates through BFF with both header forms; AUTH-072 covers it.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §2.2, §6.6
- [ ] `AUTH-057` **Signed actor claim (BFF → services) and service tokens (EdDSA, aud-bound, replay-checked)** · NEW · P1 · L · Deps: `AUTH-054`,`SEC-074`,`IDEA-004`
  - Why/Problem: raw cookie/ALS forwarding and anonymous svc→svc calls. Design §2.2, §5.6. Resolves `DEC-SEC-3`, `EFF-016`, `ARCH-054`, `ARCH-056`.
  - Do: `x-actor-claim` compact JWT with `aud` = target service, `exp ≤ 30 s`, `jti` replay-checked per service, claims `{sub, cred, aal, authTime, stepUpAt, ceiling, obo, ip, via, req}` and NO permissions (services resolve grants from the shared DB); service token 60 s TTL signed by the service's own key; BFF Ed25519 key admitted in the roster as `kind: service` with capability `sign-actor`; interim Docker-secret keypair on the same code path; rotation = roster admission.
  - Done when: a service authorizes the claim, not the cookie; a background call works without a user cookie.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §2.2, §5.6, §10 D3
- [ ] `AUTH-058` **`MeshVerifier`: Ed25519 signature by an active roster member replaces shared-secret HMAC and bare-secret `===`** · FIX · P1 · M · Deps: `AUTH-054`,`AUTH-008`
  - Why/Problem: HMAC `v1./v2.` tokens from a shared secret; `requireMesh()` accepts the bare secret with `===`. Design §1.1, §2.2.
  - Do: signature over `(method, path, body-digest, ts, nonce)`; member signing key from the roster; nonce/ts replay window.
  - Done when: bare-secret path removed; revoked members rejected.
  - Status: todo · Verified-in-code: partial (design pass read `packages/auth/src/mesh`) · Source: authz-authn-design.md §2.2
- [ ] `AUTH-059` **`WebhookVerifier`, `SetupClaimVerifier`, `AnonymousVerifier`** · NEW · P1 · S · Deps: `AUTH-054`,`AUTH-016`
  - Why/Problem: remaining credential kinds must map to principals. Design §2.2.
  - Do: webhook HMAC (constant-time) → `Webhook` principal; one-time setup claim token bound to passkey enrolment → `SetupClaim` principal (AAL3 after enrolment); anonymous only on procedures declaring `access.public({reason})`.
  - Done when: each verifier has tests; public list snapshot (SEC-065) covers anonymous.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §2.2
- [ ] `AUTH-060` **Services stop accepting cookies and user tokens; delete ALS cookie forwarding** · ENHANCE · P1 · M · Deps: `AUTH-057`
  - Why/Problem: after cutover services accept only `actor-claim`, `service-token`, `mesh-signature`, `webhook-signature`; `SEC-032` becomes defence in depth. Design §2.2 rule 2.
  - Do: remove `service-auth-context.ts` cookie/authorization/`x-mesh-internal-key` forwarding and services' session re-resolution.
  - Done when: a request with a browser cookie to `svc-*` is rejected.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §2.2
- [ ] `AUTH-061` **Scoped API token lifecycle (mint no-escalation, constraints, rotation overlap, revoke)** · NEW · P1 · L · Deps: `AUTH-056`,`SEC-054`,`AUTH-062`
  - Why/Problem: tokens are credentials, not principals; effective permission is evaluated live as owner grants ∩ token scopes. Design §3.7, §6.6. Concrete design for `AUTH-022`/`FEAT-080`.
  - Do: at mint every `(pattern, scope)` ⊆ minter's grants (`assertGrantable`); token creation is session-only (a token cannot mint tokens) with AAL≥2 + step-up for scopes containing a mutating permission, `risk>=high`, or any mutating `agent` token; mandatory expiry (default 90 d, `ci` up to 365 d); kinds pat|ci|agent|deploy_hook|cli; optional resource scope; `maxRisk` default medium; `readOnly`; IP allowlist; BA rate limit + quota; overlap rotation via `rotatedFromId`; `last_used_at/ip`; instant revoke (owner, project owner, `token:any.revoke`); revoke on owner ban/disable/demotion; `dk_` prefix for scanners; shown once.
  - Done when: P-TOK (SEC-094) green; a deploy-only CI token deploys one project and gets 403 elsewhere.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §3.7, §6.6
- [ ] `AUTH-062` **Step-up authentication (`POST /authz/step-up`, `step_up_events`, StepUp requirement)** · NEW · P1 · M · Deps: `AUTH-018`,`SEC-051`
  - Why/Problem: `freshAge` measures session creation, not re-assertion. Design §6.3. Concrete design for `AUTH-030`/`IDEA-023`.
  - Do: endpoint wraps BA passkey `verify-authentication` (after-hook or server-side verify API) and writes `step_up_events` with the assertion hash; TOTP accepted for AAL2-only requirements; `Require StepUp` satisfied by a row for the CURRENT session with `expiresAt > now`; tokens cannot step up (critical → Deny via `tokensNeverDoCritical`, others → approval challenge); `session.freshAge` (5-10 min) only for BA's own sensitive endpoints.
  - Done when: a critical action without a fresh passkey assertion returns 401 `STEP_UP_REQUIRED` and succeeds after it.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.3
- [ ] `AUTH-063` **Session policies in `security_settings`** · NEW · P1 · M · Deps: `AUTH-012`,`AUTH-017`
  - Why/Problem: no session lifetime/limits/MFA enforcement. Design §6.4. Concrete design for `AUTH-012`/`AUTH-050`.
  - Do: absolute age (30 d), idle timeout (7 d), max concurrent sessions per user (10, oldest revoked), `requireMfaFor:[roles]` (admins/owners must have TOTP or passkey, enforced at sign-in and as a guardrail on `role:assign`/`user:*`), device trust (30 d skips TOTP but never step-up), new-device notification (web push), revoke-all on password change, ban and role change; changes audited.
  - Done when: each policy has an integration test.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.4
- [ ] `AUTH-064` **IP allowlists per token and per role class, gated on trusted-proxy handling** · NEW · P2 · M · Deps: `AUTH-012`,`AUTH-056`
  - Why/Problem: an IP rule on a spoofable header is worse than none. Design §6.5.
  - Do: first fix `advanced.ipAddress.ipAddressHeaders` for Traefik; per-token `ip_allow` enforced in `ApiTokenVerifier`; `adminsFromAllowedNetworks` CIDR list in settings (mesh/operator-laptop ranges).
  - Done when: spoofed `x-forwarded-for` cannot bypass; tests.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.5
- [ ] `AUTH-065` **Invitations rewrite: own table, grant templates capped by inviter, hashed single-use token** · NEW · P1 · M · Deps: `AUTH-051`,`SEC-054`
  - Why/Problem: replaces the `platform_invite` plugin; resolves `DEC-AUTH-2`. Design §6.7. Concrete design for `AUTH-002`/`AUTH-009`/`AUTH-010`.
  - Do: `grant_template` validated by `Grants.assertGrantable`; inviter needs `user:invite` (platform) or `project:member.manage` (project); `superAdmin`/owner never grantable via invite; token shown once, stored hashed, bound to email, 72 h expiry, atomic single-use consume, revoke/resend, never in list endpoints; accepting requires setting a passkey or password; interim before P4: admin-created users via our service, no email invites.
  - Done when: AUTH-042 cases pass against the new service; plugin deleted.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.7
  - Decision (2026-10-26): `DEC-AUTH-17` accepted: own `invitations` table (grant templates capped by the inviter); not Better Auth org invitations. Interim before P4: admin-created users via our service, no email invites.
- [ ] `AUTH-066` **Service accounts (user rows `kind='service_account'`) owning tokens** · NEW · P2 · M · Deps: `AUTH-051`,`AUTH-061`
  - Why/Problem: non-human identities for CI/automation. Design §2.1, D5. Concrete design for `AUTH-034`.
  - Do: created/disabled by `user:*`-capable principals; never sign in; own tokens; grants like users; owner recorded; user lists filter by kind.
  - Done when: a CI service account deploys with a scoped token.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §2.1
  - Decision (2026-10-26): `DEC-AUTH-13` accepted: service accounts are `user` rows with `kind='service_account'` (native to Better Auth API keys), never sign in.
- [ ] `AUTH-067` **Impersonation with audit (read-only by default, intersection semantics)** · NEW · P2 · M · Deps: `AUTH-062`,`AUTH-054`,`SEC-068`
  - Why/Problem: replaces `loginAs`/master token. Design §6.8, D17. Concrete design for `AUTH-031`.
  - Do: `superAdmin` (or custom `user:impersonate`) with step-up + reason, never to an equal-or-higher principal, TTL 1 h, read-only by default (writes need a further step-up), persistent banner, session carries `onBehalfOf=[admin]`, effective = target ∩ admin, audit records both; BA `impersonate` wrapped not exposed raw.
  - Done when: impersonated writes are denied unless toggled; banner visible.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.8
  - Decision (2026-10-26): `DEC-AUTH-25` accepted: impersonation is read-only by default; step-up (and reason) to enable writes; effective permissions = target ∩ admin.
- [ ] `AUTH-068` **Device-code login yielding a scoped, expiring CLI credential with scope shown on the approval page** · ENHANCE · P1 · M · Deps: `AUTH-055`,`AUTH-023`
  - Why/Problem: CLI uses master token/default creds today. Design §1.1, §2.2.
  - Do: RFC 8628 bearer session bound to a CLI device row; approval page lists client, exact scopes, maxRisk and expiry, passkey tap for sensitive scopes; `deployer login`.
  - Done when: CLI authenticates with no master token.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §1.1, §2.2
- [ ] `AUTH-069` **Agent tokens: read-only default, propose/dispose approval, auto-approval for low risk, MCP from manifest** · NEW · P2 · M · Deps: `AUTH-061`,`SEC-072`,`FEAT-095`
  - Why/Problem: agents are principals only to make policy/audit expressive; never hold grants of their own. Design §6.11, D10. Concrete design for `FEAT-095`/`IDEA-062`/`IDEA-094`.
  - Do: `agent` token kind minted via device flow; default scope = all non-mutating permissions with `risk <= medium` minus `secret:*`, `container:*`, `audit:export`, `token:*`; mutating call not granted → `APPROVAL_REQUIRED` with a human-readable plan, passkey approval, retry, hash-bound; auto-approval per token for low risk, never `high+`; default TTL 8 h, `maxRisk=medium`, quota-limited, audited `via=mcp`; tool outputs (logs, env) flagged untrusted; MCP tool list generated from the manifest so an agent cannot see tools its token cannot call; delete `agentAuth.ts`.
  - Done when: an agent with a default token cannot mutate; an approved action runs exactly once.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.11
  - Decision (2026-10-26): `DEC-AUTH-18` accepted: the Agent Auth plugin is deleted (`AUTH-035`); agent tokens + device flow are the replacement and this item owns them.
- [ ] `AUTH-070` **Sign-up `before` hook: only a valid invitation or the setup claim** · FIX · P1 · S · Deps: `AUTH-001`
  - Priority-review (2026-10-26): demoted P0 -> P1: AUTH-001 (P0) already disables sign-up; the invitation/setup-claim hook depends on the invitations rewrite (AUTH-065, P1).
  - Why/Problem: sign-up stays disabled everywhere else; new accounts get baseline `member` with no capabilities. Design §6.7, §7.
  - Do: `disableSignUp: true` plus hook allowing (a) valid invitation, (b) setup claim; new accounts → `member`.
  - Done when: AUTH-041 passes; no path creates an account without one of the two.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.7, §7
  - Decision (2026-10-26): `DEC-AUTH-15` accepted: accounts created via a valid invitation or the setup claim get the baseline role `member` (no capabilities).
- [ ] `AUTH-071` **Token and session management UI (list, revoke, last used, rotation nudges)** · NEW · P2 · M · Deps: `AUTH-061`,`AUTH-063`
  - Why/Problem: operators need visibility. Design §6.4, §6.6, §9.2 P5. Related `WEB-120`.
  - Do: sessions and tokens per user with last used ip/at; instant revoke; nudge at T-14 d before token expiry; "remember device" management.
  - Done when: user revokes a token and it fails immediately.
  - Status: todo · Verified-in-code: no (design) · Source: authz-authn-design.md §6.6
- [ ] `AUTH-072` **Auth integration tests on in-memory Better Auth (design cases)** · NEW · P1 · M · Deps: `AUTH-046`
  - Why/Problem: sign-up closed, invite caps, set-role hierarchy, token transport, ban revokes sessions/tokens, step-up expiry, device-code scopes. Design §9.5 (5).
  - Do: extend the in-memory BA harness with each case.
  - Done when: all cases green in CI.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §9.5
- [ ] `AUTH-073` **Phase 6: OIDC SSO via `@better-auth/sso` (GitHub/GitLab/generic); SAML, SCIM, LDAP explicitly not built** · NEW · P3 · M · Deps: `AUTH-018`,`SEC-101`
  - Why/Problem: free OIDC is a differentiator, not a blocker. Design §8. Replaces `AUTH-037` scope.
  - Do: JIT provisioning creates baseline `member`; optional `idp_group_mappings(group claim → role@scope)` creating grants `source='sso'`; allowed email domains; sign-up closed except through the IdP provisioning hook; passkeys remain the step-up factor; SAML no (BA support maturing), SCIM only on customer demand (`@better-auth/scim` → groups), LDAP no.
  - Done when: login via an OIDC IdP provisions a member; mappings create grants.
  - Status: todo · Verified-in-code: no · Source: authz-authn-design.md §8

### Cross-file duplicates (See also)
- AUTH-001 ~ `JRN-014`,`WEB-024` · AUTH-002 ~ `JRN-014` · AUTH-005 ~ `SETUP-001`,`JRN-013` · AUTH-010 ~ `WEB-022` · AUTH-011 ~ `PROJ-110` · AUTH-014 ~ `WEB-023` · AUTH-015 ~ `WEB-021`,`OBS-016` · AUTH-016 ~ `SETUP-003`,`IDEA-013` · AUTH-017 ~ `WEB-025` · AUTH-022 ~ `FEAT-080`,`IDEA-012` · AUTH-023 ~ `SETUP-029`,`FEAT-083` · AUTH-027 ~ `FEAT-113`,`DOC-008` · AUTH-029 ~ `OBS-071`,`FEAT-110`,`IDEA-014` · AUTH-030 ~ `IDEA-023` · AUTH-035 ~ `IDEA-094` · AUTH-036/037 ~ `FEAT-111` · AUTH-039 ~ `ARCH-055` · AUTH-045 ~ `ARCH-036`
- SEC-001 ~ `IDEA-001` · SEC-002 ~ `NET-001`,`NET-003`,`CLUSTER-001` · SEC-003 ~ `CLUSTER-001`,`CLUSTER-004`,`CLUSTER-005`,`CLUSTER-006`,`WEB-017` · SEC-004 ~ `CLUSTER-008` · SEC-005 ~ `CLUSTER-002`,`CLUSTER-003`,`JRN-015` · SEC-006 ~ `PROJ-001`,`PROJ-002`,`PROJ-003` · SEC-007 ~ `PROJ-006`,`PROJ-007`,`PROJ-011` · SEC-008 ~ `PROJ-004`,`NET-005` · SEC-009 ~ `PROJ-005`,`PROJ-008` · SEC-010 ~ `DEPLOY-089`,`DEPLOY-023`,`OBS-052` · SEC-011 ~ `ARCH-084`,`ARCH-085` · SEC-012 ~ `SETUP-002` · SEC-013 ~ `NET-004`,`DEPLOY-030`,`OBS-019` · SEC-014 ~ `DEPLOY-031`,`DEPLOY-032` · SEC-015 ~ `ARCH-079` · SEC-016 ~ `IDEA-027`,`PROJ-020` · SEC-017 ~ `OPS-029`,`SETUP-005` · SEC-019 ~ `IDEA-027` · SEC-020 ~ `CLUSTER-055`,`CLUSTER-056` · SEC-021 ~ `PROJ-009`,`PROJ-022`,`IDEA-024` · SEC-022 ~ `NET-007`,`NET-077` · SEC-023 ~ `OPS-001` · SEC-024 ~ `ARCH-076` · SEC-025 ~ `IDEA-035`,`OPS-028` · SEC-027 ~ `IDEA-037`,`ARCH-060`,`OPS-010` · SEC-028 ~ `CLUSTER-007` · SEC-029 ~ `NET-006`,`NET-008`,`NET-013` · SEC-030 ~ `IDEA-011`,`ARCH-054`,`ARCH-056` · SEC-031 ~ `ARCH-057`,`ARCH-058` · SEC-032 ~ `ARCH-059` · SEC-033 ~ `IDEA-085` · SEC-034 ~ `IDEA-008` · SEC-035 ~ `IDEA-009` · SEC-036 ~ `IDEA-007` · SEC-037 ~ `IDEA-006`,`IDEA-010` · SEC-038 ~ `IDEA-103`,`CLUSTER-081`,`NET-098`,`PROJ-150`,`OBS-083` · SEC-039 ~ `IDEA-110` · SEC-040 ~ `DEPLOY-119` · SEC-042 ~ `SETUP-036` · SEC-043 ~ `ARCH-102`,`ARCH-104` · SEC-044 ~ `PROJ-150`
- Substrate aliases: SUB-A = `SEC-001`/`IDEA-001`, SUB-B = `DEPLOY-003`, SUB-C = `OBS-001`, SUB-D = `IDEA-004`. Webhook raw-body/idempotency/GitLab verification are owned by `DEPLOY-091`..`DEPLOY-093`,`DEPLOY-035`.

## Test coverage to add
- [ ] `AUTH-041` **E2E: sign-up disabled and role injection blocked** · NEW · P0 · S · Deps: `AUTH-001`
  - Why/Problem: no test for open sign-up. Do: e2e posting sign-up with/without `role`. Done when: 403/ignored asserted.
  - Status: todo · Verified-in-code: no · Source: auth.md#1 (tests)
  - Design-impact (2026-10-26): add the case "no path creates an account without a valid invitation or the setup claim; new accounts are baseline `member`" (`AUTH-070`).
- [ ] `AUTH-042` **Tests: invite escalation and invite behaviour** · NEW · P0 · M · Deps: `AUTH-002`,`AUTH-009`
  - Why/Problem: `invite.spec.ts` checks shape only. Do: endpoint behaviour/authz tests (non-admin 403, role cap, atomic validate, filters). Done when: all pass.
  - Status: todo · Verified-in-code: no · Source: auth.md#1 (tests)
- [ ] `AUTH-043` **Tests: master-token and loginAs off in production** · NEW · P0 · S · Deps: `AUTH-003`,`AUTH-004`
  - Do: prod-mode instance rejects `Bearer <DEV_AUTH_KEY>`; `ENABLE_MASTER_TOKEN=false` parses false. Done when: pass.
  - Status: todo · Verified-in-code: no · Source: auth.md#1 (tests)
- [ ] `AUTH-044` **Tests: admin role hierarchy (set-role/ban/remove/update)** · NEW · P0 · S · Deps: `AUTH-006`
  - Do: admin cannot grant/act on superAdmin. Done when: pass.
  - Status: todo · Verified-in-code: no · Source: auth.md#1 (tests)
  - Effect-impact (2026-10-26): pure `userRules` make the hierarchy matrix a cheap unit test now (no Nest, no DB); the Better Auth side still needs the integration test. See AUTH-045.
  - Design-impact (2026-10-26): the hierarchy matrix targets `Grants.assign`/`assertGrantable` (`SEC-054`) and the rank rule; property test P-ESC (`SEC-093`) is the stronger form.
- [ ] `AUTH-045` **Unit specs for identity-service `userRules` privilege matrix** · NEW · P1 · M · Deps: none
  - Why/Problem: no `user.*.spec.ts`; only an e2e happy path. Do: tests for admin-only list/create/delete, self-or-admin read, self-service whitelist, no self-ban/delete, superAdmin minting, email normalisation, audit field guard. Done when: matrix covered.
  - Status: todo · Verified-in-code: no · Source: auth.md#1 (identity), auth.md#3 (15)
  - Effect-impact (2026-10-26): re-scoped and cheaper: rules are extracted and pure in `apps/api-services/services/identity/src/modules/user/domain/user.rules.ts` (file moved from the entity-based `userRules`); no `user.*.spec.ts` exists (verified). Write rules matrix (include admin-on-superAdmin negatives), service specs with `Effect.provideService` fakes, controller specs with `effectContext` + `callProcedure`. Effort M -> S/M. Deps: `EFF-030`, `EFF-038`.
- [ ] `AUTH-046` **Replace `server/auth.spec.ts` plugin mocks with an in-memory Better Auth integration test** · ENHANCE · P1 · M · Deps: none
  - Why/Problem: the spec mocks all plugins and tests nothing real. Do: real in-memory instance covering sign-up, invite, admin hierarchy, apikey. Done when: replaces mocks.
  - Status: todo · Verified-in-code: no · Source: auth.md#1 (tests), auth.md#5, ideas-security-resilience.md#3 (13)
  - Design-impact (2026-10-26): becomes the harness for the design's integration cases (sign-up closed, invite caps, token transport, ban revokes sessions/tokens, step-up expiry, device-code scopes), tracked in `AUTH-072`.
- [ ] `AUTH-047` **E2E: passkey enrol + sign-in and TOTP enrol + challenge** · NEW · P1 · M · Deps: `AUTH-017`,`AUTH-018`
  - Do: enrol, sign out, sign in with passkey; enrol TOTP, sign in with code and backup code. Done when: pass.
  - Status: todo · Verified-in-code: no · Source: auth.md#4 (8,9)
- [ ] `AUTH-048` **E2E: API key mint and authenticated call via BFF** · NEW · P1 · S · Deps: `AUTH-019`
  - Do: mint key, call through BFF with both header forms. Done when: pass.
  - Status: todo · Verified-in-code: no · Source: auth.md#4 (10)
- [ ] `AUTH-049` **Authorization tests for monolith user controller (or confirm module removed)** · NEW · P1 · S · Deps: `AUTH-007`
  - Do: non-admin 403 on all user procedures. Done when: pass or module deleted.
  - Status: todo · Verified-in-code: no · Source: auth.md#1 (monolith user)
- [ ] `SEC-038` **Generated controller authorization matrix: 403 for viewer/user on every non-read procedure** · NEW · P0 · M · Deps: `SEC-001`
  - Do: per-controller negative tests from `SUB-A` metadata; docker/cluster/fleet/DNS/project controllers first. Done when: CI fails for any procedure lacking a test/metadata.
  - Status: todo · Verified-in-code: no · Source: auth.md#4 (4), docker-cluster.md#5, networking.md#4 (11), ideas-security-resilience.md#3 (1,13)
  - Effect-impact (2026-10-26): generate the matrix from contract metadata and assert the `_tag -> code` mapping; run it through middleware/HTTP, not `callProcedure` (skips middleware, `packages/transport/orpc/src/testing/index.ts:29-35`). Effect services make the privilege matrix itself trivial for identity. Deps: `EFF-030`, `EFF-038`.
  - Design-impact (2026-10-26): the generated matrix is built by `SEC-066` from `.access()` metadata with an oracle INDEPENDENT of `evaluate` (the role-definition table), runs through full `call()`/HTTP (never `callProcedure`), and is protected by a gate mutation test (`SEC-100`); the 403 matrix covers {anonymous, member, viewer, non-member project owner} per mutating procedure. Deps +`SEC-066`.
- [ ] `SEC-039` **Codec tests: non-hex/short key rejected, AAD swap fails, key-id rotation** · NEW · P0 · S · Deps: `SEC-016`,`SEC-019`
  - Do: unit tests in `codec-registry` for all three. Done when: pass.
  - Status: partial -> mostly done: new primitives and the codec have tests for weak/short/placeholder roots, AAD binding, tamper, rotation + retirement, sync/async interop and legacy known-answer vectors (infra 123, nest-schema 60, shared 13 codec specs); remaining: none of the codec-registry specs assert the production boot refusal through `registerSchemaCodecs` end-to-end beyond `schema-codecs.spec.ts` (covered there) — updated 2026-10-26 · Verified-in-code: no · Source: ops.md#R-02
- [ ] `SEC-040` **Tests: archive traversal/injection and git URL/branch validation** · NEW · P0 · S · Deps: `SEC-013`,`SEC-014`
  - Do: zip/tar with `../` and shell metacharacters; leading-`-` branch; private-IP URL. Done when: all rejected.
  - Status: partial (archive traversal/injection tests exist at package level (56) and at the `GitService` level (8, incl. the unzip filename injection and zip-slip for zip and tar); git URL/branch validation tests not written) — updated 2026-10-26 · Verified-in-code: no · Source: ops.md#R-06
- [ ] `SEC-041` **Tests: rate limiting and security headers** · NEW · P1 · S · Deps: `SEC-024`,`SEC-025`
  - Do: 429 after N sign-ins; header assertions on web/api. Done when: pass.
  - Status: todo · Verified-in-code: no · Source: ops.md#4 (P1-8,9)
- [ ] `SEC-042` **Tests: setup surface locked after setup** · NEW · P0 · S · Deps: `SEC-012`
  - Do: every `setup.*` call after `setup_done` returns 403/404; no promotion of existing user. Done when: pass.
  - Status: todo · Verified-in-code: no · Source: architecture.md#4 (2)
- [ ] `SEC-043` **BFF -> service contract test over HTTP incl. authenticated svc-project -> svc-fleet** · NEW · P1 · M · Deps: `SEC-031`
  - Do: test delegated procedures over HTTP (would have caught the anonymous 401). Done when: pass in CI.
  - Status: todo · Verified-in-code: no · Source: architecture.md#4 (6), architecture.md#5 (12)
  - Design-impact (2026-10-26): add the claim-verification cases (expired, wrong `aud`, replayed `jti`, cookie-only request rejected) per `AUTH-057`/`AUTH-060`.
- [ ] `SEC-044` **Negative authz tests: non-member read/write of every project/service/deployment procedure** · NEW · P1 · M · Deps: `SEC-006`,`SEC-010`
  - Do: non-member and viewer calls across project/service/deployment procedures. Done when: pass.
  - Status: todo · Verified-in-code: no · Source: projects-services.md#4 (12), docker-cluster.md#5
  - Decision (2026-10-26): `DEC-AUTH-14` accepted: assertion for a non-member read is 404 (concealment), not 403; 403 only when the actor holds `:read` but lacks the action.
  - Design-impact (2026-10-26): non-member read expected result is 404 (concealment, `DEC-AUTH-14`), not 403; run per area before its flip (`SEC-083`).

## Decisions needed
- [ ] DEC-AUTH-1 Org/team layer vs platform+project roles — options: build org layer; adopt platform+project roles and publish matrix — recommendation: adopt 2-layer and fix docs (affects AUTH-027, DOC) — Design-impact (2026-10-26): closed by `DEC-AUTH-23` (no org layer; `org` kept as a future ancestor scope type)
- [ ] DEC-AUTH-2 Invite plugin vs `admin.createUser` — options: fix plugin + UI; delete plugin and use admin-created users — recommendation: fix plugin only if email invites are wanted, else admin.createUser first — Design-impact (2026-10-26): resolved by `DEC-AUTH-17`: own `invitations` table; interim admin-created users via our service
- [ ] DEC-AUTH-3 Surviving auth module (`apps/api` vs `api-services/shared`) — recommendation: services/shared, delete the other with monolith retirement
- [ ] DEC-AUTH-4 Default role for new accounts — options: define `user`; default `viewer` — recommendation: `viewer` — Design-impact (2026-10-26): superseded by `DEC-AUTH-15`: baseline `member` with no capabilities
- [ ] DEC-AUTH-5 What may `viewer`/`user` read (all projects vs member-only vs none)? — recommendation: member-only reads, platform viewer sees fleet read views (feeds SEC-006) — Design-impact (2026-10-26): confirmed by the design seed rules (design §9.3); non-members get 404 (`DEC-AUTH-14`)
- [ ] DEC-AUTH-6 Keep or remove Agent Auth — recommendation: remove until a concrete agent use case exists — Design-impact (2026-10-26): confirmed as `DEC-AUTH-18` (delete; agent tokens + device flow)
- [ ] DEC-AUTH-7 Mail transport (SMTP/Resend/none) and operator fallback — recommendation: pluggable SMTP with admin temporary-password fallback
- [ ] DEC-AUTH-8 Keep PermissionEngine/`role_rules` or remove — options: wire (SEC-033); delete engine and `role_rules` — recommendation: wire in shadow mode — Design-impact (2026-10-26): closed by `DEC-AUTH-9`: wire as a rewritten shell (pure `evaluate` + Effect `Authz`) over the kept filter machinery; `role_rules` dropped
- [ ] DEC-SEC-1 Docker socket mediation — options: socket proxy; restrict socket to svc-runtime only; remote builder nodes — recommendation: restrict to svc-runtime + supervisors first, proxy later
- [ ] DEC-SEC-2 Encryption key management — options: env `ENCRYPTION_KEY` key ring; external KMS/Vault/sops — recommendation: env key ring with key ids now, KMS pluggable later
- [ ] DEC-SEC-3 Inter-service auth — options: signed actor claim only; plus service token for background calls — recommendation: both — Design-impact (2026-10-26): confirmed by `DEC-AUTH-11` (signed claim + service tokens)
- [ ] DEC-SEC-4 Rate-limit/shared store — options: Redis (currently a phantom dependency); Postgres; per-node local — recommendation: Redis, giving it a real purpose — Design-impact (2026-10-26): overridden by `DEC-AUTH-19` (2026-10-26, operator accepted the differing recommendation): rate limits and authz quota counters use an unlogged Postgres table, NOT Redis; Redis removal itself is still to be confirmed (`DEC-ARCH-3`, leaning drop)
- [ ] DEC-SEC-5 Fix in both monolith and services or only services — recommendation: services only; freeze monolith and retire it (ARCH owns cutover)
- [ ] DEC-SEC-6 Project/service read scoping model — options: member-only; all authenticated can see names but not config; platform admins see all — recommendation: member-only with platform admin override — Design-impact (2026-10-26): confirmed; non-member reads are 404 (`DEC-AUTH-14`); implemented via `Authz.filter` (`SEC-058`)

### Decisions from authz-authn-design.md §10 (D1..D18 → DEC-AUTH-9..26)
- [x] DEC-AUTH-9 (D1) Authorization model — options: flat RBAC; grants + guardrails; ReBAC (OpenFGA/Zanzibar); ABAC policy-as-code (Cedar/OPA) — recommendation: grants + guardrails; closes `DEC-AUTH-8` ("wire the engine": yes, as a rewritten shell over the kept filter machinery) (affects SEC-048..SEC-069) Resolved: 2026-10-26 accepted: grants + guardrails; closes `DEC-AUTH-8`.
- [x] DEC-AUTH-10 (D2) Keep the `superAdmin → ALLOW` bypass? — options: keep; remove — recommendation: remove; owner = all permissions, guardrails apply, host recovery CLI for lock-out (affects SEC-053, SEC-081, AUTH-025) Resolved: 2026-10-26 accepted: remove the bypass BUT only after the host recovery CLI (`SEC-081`) and break-glass (`SEC-073`) exist; sequencing noted on SEC-053/SEC-081/SEC-073/SEC-083/AUTH-025.
- [x] DEC-AUTH-11 (D3) BFF → service identity — options: cookie forward; signed claim; mTLS — recommendation: signed EdDSA claim (30 s) + service tokens, signer key anchored in the roster; mTLS only if the mesh later provides it for free; resolves `DEC-SEC-3`, `EFF-016`, `DEC-EFF-3` (affects AUTH-057, SEC-030) Resolved: 2026-10-26 accepted: signed EdDSA claim (30 s) + service tokens, signer key anchored in the roster; reconciled with `DEC-EFF-28` (BFF serves `/.well-known/keys`, trust pinned in the mesh roster at setup).
- [x] DEC-AUTH-12 (D4) Where policy lives — options: Postgres; roster; both — recommendation: Postgres for human/API authz now; roster capabilities for mesh-member authority; signed policy bundle in the roster later (`SEC-036`) for node-local enforcement; state in the architecture doc that the API tier is a coordinator for human actions (affects SEC-076, SEC-101, SEC-102) Resolved: 2026-10-26 accepted: Postgres now for human/API authz; roster capabilities for mesh-member authority; signed roster bundle later (`SEC-036`).
- [x] DEC-AUTH-13 (D5) Service accounts — options: user rows with `kind`; separate table — recommendation: user rows with `kind` (native to Better Auth API keys) (affects AUTH-051, AUTH-066) Resolved: 2026-10-26 accepted: user rows with `kind`.
- [x] DEC-AUTH-14 (D6) Non-member reads — options: 403; 404 — recommendation: 404 (concealment) when the actor lacks `:read`, 403 only when read is held but the action is not (affects SEC-057, SEC-044) Resolved: 2026-10-26 accepted: 404 concealment.
- [x] DEC-AUTH-15 (D7) Default role for new accounts — options: `viewer`; none — recommendation: `member` with no capabilities; supersedes `DEC-AUTH-4` "viewer" (affects AUTH-024, SEC-049, AUTH-070) Resolved: 2026-10-26 accepted: `member`, no capabilities.
- [x] DEC-AUTH-16 (D8) Approvals in a one-person install — options: require a second person; degrade — recommendation: preset `solo` degrades to step-up + reason + cooldown, auto-suggest `team` at ≥2 humans (affects SEC-069, SEC-072) Resolved: 2026-10-26 accepted: solo preset degrades to step-up + reason + cooldown.
- [x] DEC-AUTH-17 (D9) Invites — options: Better Auth org invitations; own table; drop and use `admin.createUser` — recommendation: own `invitations` table (`DEC-AUTH-2`: grant templates and caps); interim before P4: admin-created users via our service, no email invites (affects AUTH-065, AUTH-002) Resolved: 2026-10-26 accepted: own `invitations` table.
- [x] DEC-AUTH-18 (D10) Agent Auth plugin — options: register; delete — recommendation: delete (`DEC-AUTH-6`), agent tokens + device flow instead; revisit if the Agent Auth spec stabilises (affects AUTH-035, AUTH-069) Resolved: 2026-10-26 accepted: delete the plugin.
- [x] DEC-AUTH-19 (D11) Quotas store — options: Redis; Postgres — recommendation: Redis per `DEC-SEC-4`, Postgres unlogged-table fallback for single node (affects SEC-071, SEC-024) Resolved: 2026-10-26 operator accepted the DIFFERING recommendation: drop Redis for quotas/rate limiting; use an unlogged Postgres table (not Redis). Supersedes `DEC-SEC-4` for this purpose; Redis keep/drop (`DEC-ARCH-3`) still to confirm (leaning drop).
- [x] DEC-AUTH-20 (D12) Decision-log volume — options: log everything; tiered — recommendation: tiered (always denies/challenges/mutating and `risk>=high` allows, 1% sampled low-risk reads), hash-chained, 30 d decision summaries for simulate (affects SEC-068, SEC-060) Resolved: 2026-10-26 accepted: tiered.
- [x] DEC-AUTH-21 (D13) Condition language — options: CEL/Cedar; existing `DFilter` — recommendation: `DFilter` (non-Turing, tested, SQL-compilable), extend with `in`/`matches`/time/attribute paths only as needed (I-01) (affects SEC-050, SEC-069) Resolved: 2026-10-26 accepted: `DFilter` conditions.
- [x] DEC-AUTH-22 (D14) Proof-carrying `Authorized` witness — options: adopt; skip — recommendation: adopt incrementally, `risk>=high` mutations first (affects SEC-067) Resolved: 2026-10-26 accepted: adopt incrementally.
- [x] DEC-AUTH-23 (D15) Org layer — options: build; not — recommendation: not now; leave the `org` ancestor extension point; closes `DEC-AUTH-1` as "platform + project" (affects AUTH-027, SEC-101, FEAT-113) Resolved: 2026-10-26 accepted: no org layer now; extension point only.
- [x] DEC-AUTH-24 (D16) `operator` scope — options: platform-wide deploy; observe + node ops only — recommendation: observe + node ops only, deploys require a project role (documented behaviour change) (affects SEC-049, SEC-085) Resolved: 2026-10-26 accepted: observe + node ops only.
- [x] DEC-AUTH-25 (D17) Impersonation default — options: read-write; read-only — recommendation: read-only by default, step-up to enable writes, intersection semantics (affects AUTH-067) Resolved: 2026-10-26 accepted: read-only by default.
- [x] DEC-AUTH-26 (D18, UNVERIFIED [mem] — resolve via spike `SEC-063`) oRPC gate/meta mechanics — options: middleware reading `procedure["~orpc"].meta` after validation; `implement(contract).use(authzGate(accessMapFromContract))` keyed by procedure path — recommendation: confirm in the Template v1 spike before annotating hundreds of procedures; fallback is the path-keyed map (affects SEC-061, SEC-062, SEC-063, SEC-064) Resolved: 2026-10-26 accepted as "resolve via spike `SEC-063`; fallback path-keyed access map" (resolved-pending-spike: `SEC-063` and dependants stay todo).

Counts: AUTH 73 (AUTH-001..040 + AUTH-041..049 tests + AUTH-050 + AUTH-051..073 authz design) + SEC 102 (SEC-001..037 + SEC-038..044 tests + SEC-045..047 + SEC-048..102 authz design) = 175 items. By priority: P0 50, P1 76, P2 33, P3 16. By type: FIX 51, ENHANCE 20, NEW 104. Decisions: 32 (DEC-AUTH-1..26 + DEC-SEC-1..6); DEC-AUTH-9..26 resolved 2026-10-26 (DEC-AUTH-26 resolved-pending-spike `SEC-063`).

> Effect-impact pass: 2026-10-26 — 17 items annotated

> Decisions pass: 2026-10-26 — 18 decisions resolved, 0 items unblocked
