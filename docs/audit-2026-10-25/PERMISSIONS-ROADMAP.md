# PERMISSIONS ROADMAP — low-level, editable, Effect-native

Date: 2026-11-01. Status: **design, ready to implement**. Supersedes the *plan* in `authz-authn-design.md` §9–§10 (the
model there stands; this file turns it into phased, checkable work) and absorbs `SEC-048..SEC-064` from
`roadmap/auth-security.md` — those items keep their IDs and are referenced, not duplicated.

Read first: [`permissions/model-research.md`](./permissions/model-research.md) (why this model),
`authz-authn-design.md` (the long-form design), `docs/qa/permissions/requirements-2026-11-01.md` (the operator's brief).

---

## 0. One screen

**Today.** Authorization is `requireAuth()` on most procedures, `requirePlatformRole(["superAdmin","admin","operator"])`
on the mutations added on 2026-11-01, a `role_rules` JSONB table, and an in-memory engine whose first step is
`platformRole === "superAdmin" → ALLOW` `[code] packages/auth/src/permissions/engine/permission-engine.ts:1-8`. Roles are
`superAdmin|admin|operator|viewer` for the platform and `owner|maintainer|deployer|viewer` per project
`[code] packages/auth/src/permissions/config.ts`. A super admin cannot create a role, cannot see why a call was refused,
and cannot grant one person "deploy staging of project X" without making them a platform `operator`.

**Target.** A typed permission catalog (code), roles that are bundles of permissions (system ones in code, custom ones in
Postgres and editable by a super admin), scoped grants with deny/expiry/conditions, a pure `evaluate()` core, an Effect
`Authz` service that every procedure goes through by declaration (`.access(...)` on the contract), an explain/simulate
story in API + CLI + UI, and a role editor with clone-from-template, subset rule, diff preview and audit. No sidecar, no
policy language, no daemon: evaluation is in-process over Postgres rows, and lists compile to SQL.

| Dimension | Now | Target |
|---|---|---|
| Enforcement | `requireAuth()` (default allow) | default deny, annotated at the contract, build fails if a procedure has neither `.access` nor `.public` |
| Roles | 4 platform + 4 project, code only | system roles (code) + **custom roles (DB, editable)** |
| Granting | change the user's single `user.role` | grants at `platform / project / environment / service / node`, additive, with deny/expiry |
| Granularity | role | permission slug + condition (`resource.ownerId == actor.id`, `environment.kind == "production"`) |
| Explain | none | decision log + `authz.explain` + UI drawer + CLI |
| Bypass | `superAdmin → ALLOW` | none; lock-out recovery is a host CLI |
| Effect | `EffectRuntime` per service, no authz | `Authz`/`PermissionResolver` services, checks are Effects in the same trace |

---

## 1. Vocabulary (fixed; do not invent synonyms)

| Term | Meaning | Owned by |
|---|---|---|
| **Permission** | immutable slug `resource:action`, with a risk tier (`read < write < destructive < reveal < admin`) | code (`catalog.ts`) |
| **Bundle** | a product concept grouping permissions ("deploy a service", "manage DNS"). The UI's default editing unit | code |
| **Role** | named set of bundles/permissions. `system` roles are code-owned and immutable; `custom` roles are rows | code + DB |
| **Grant** | `(subject, role \| permission, scope, effect, condition?, expiresAt?)` | DB |
| **Scope** | typed node: `platform`, `project:<id>`, `environment:<id>`, `service:<id>`, `node:<id>` | DB via FKs |
| **Condition** | typed predicate over resolved facts (`ownerId`, `ip`, `now`, `kind`) | code (DSL) |
| **Guardrail** | a non-identity requirement on a permission: step-up, second approver, quota, time window, IP | code + DB |
| **Principal** | `user \| service \| agent \| system \| anonymous`, normalized to `Actor` | `packages/effect/core/src/actor.ts` |

---

## 2. Architecture — four layers

```
L0  Authentication      Better Auth (session, passkey, TOTP) + service/token/system verifiers
L1  Catalog             one code file: permissions, bundles, system roles, risk tiers, guardrails
L2  Grants              Postgres rows: custom roles, grants, conditions, epochs  (editable by super admins)
L3  Enforcement         Effect `Authz` service + oRPC gate middleware + contract `.access()` + SQL filter compiler
```

The rule that keeps it honest: **L1 is code, L2 is data, and a custom role may only contain permissions that exist in L1
and are a subset of its base role.** An admin can rewrite *who* may do *what*; they cannot invent a capability the product
does not implement.

---

## 3. Data model

New schema file `packages/nest/schema/src/global/identity/authz.ts` (Drizzle, `pgTable`), migration `0041_authz_core`:

```ts
authz_roles          (id, slug unique, name, description, kind: 'system'|'custom', scope_kind, base_role_slug,
                      permissions jsonb /* string[] */, created_by, created_at, updated_at)
authz_grants         (id, subject_kind: 'user'|'service'|'agent'|'system'|'token', subject_id,
                      role_id null, permission_slug null, scope_kind, scope_id null,
                      effect: 'allow'|'deny', condition jsonb null, expires_at null,
                      granted_by, created_at, revoked_at null)
authz_role_versions  (id, role_id, snapshot jsonb, actor_id, created_at)          -- audit of every role edit
authz_decisions      (id, at, actor_kind, actor_id, permission, scope_kind, scope_id, decision,
                      reason, rule_ids jsonb, latency_ms, correlation_id)          -- sampled; the explain source
authz_epoch          (id single row, value bigint, updated_at)                    -- cache invalidation + NOTIFY
```

Rules baked into the schema, not into application code:
- `unique(subject_kind, subject_id, coalesce(role_id,''), coalesce(permission_slug,''), scope_kind, coalesce(scope_id,''))`
  where `revoked_at is null` → no duplicate live grant.
- `check (role_id is not null) <> (permission_slug is not null)` → a grant is either a role or a permission, never both.
- `check (effect = 'allow' or condition is not null)` → a deny must say *why* it applies.
- `authz_role_versions` is written by a trigger on `authz_roles` update, so no code path can edit a role without an audit row.

`role_rules` (JSONB per platform role) is **retired** after the backfill: its `ResourceRule[]` becomes
`authz_grants.condition` rows seeded by the migration, then the table and the engine's loader are deleted in the same
change (`AUTHZ-018`). Until then the engine reads grants first and `role_rules` only as a fallback, flipped by a flag.

### Scope resolution
`authz_grants.scope_id` is a UUID for `project|environment|service|node`, null for `platform`. Descendant checks use the
already-existing ancestor walk `[code] packages/auth/src/permissions/engine/resource-graph.ts` — one recursive CTE, no
graph store:

```sql
with recursive chain as (
  select :scopeKind as kind, :scopeId as id
  union all
  select parent.kind, parent.id from authz_scope_parent(:scopeKind, :scopeId) parent join chain c on true
)
select g.* from authz_grants g join chain c on g.scope_kind = c.kind and coalesce(g.scope_id::text,'') = coalesce(c.id::text,'')
where g.revoked_at is null and (g.expires_at is null or g.expires_at > now())
```

The same expression, compiled with `compileDFilter` `[code] packages/auth/src/permissions/engine/filter-compiler.ts`,
produces the `WHERE` for list endpoints so a page of services is filtered in SQL.

---

## 4. The catalog (L1) — the only place a permission exists

`packages/auth/src/authz/catalog.ts`:

```ts
export const permissions = definePermissions({
  "project:read":        { resource: "project", action: "read",        risk: "read" },
  "project:delete":      { resource: "project", action: "delete",      risk: "destructive" },
  "service:deploy":      { resource: "service", action: "deploy",      risk: "write",
                           condition: "environment.kind != 'production' || actor.role != 'deployer'" },
  "container:exec":      { resource: "container", action: "exec",      risk: "reveal", guardrails: ["step-up", "audit"] },
  "secret:reveal":       { resource: "secret",  action: "reveal",      risk: "reveal", guardrails: ["step-up"] },
  "role:assign":         { resource: "role",    action: "assign",      risk: "admin" },
  /* … */
} as const);

export const bundles = defineBundles({
  "deploy":        ["service:read", "service:deploy", "deployment:read", "deployment:rollback"],
  "dns":           ["dns.record:read", "dns.record:write"],
  "members":       ["member:read", "member:invite", "member:role:write"],
  /* … */
});

export const systemRoles = defineRoles({
  owner:    { scope: "project", bundles: ["*"] },
  maintainer:{ scope: "project", bundles: ["deploy", "dns", "members"] },
  deployer: { scope: "project", bundles: ["deploy"] },
  viewer:   { scope: "project", bundles: ["read"] },
  platform: { scope: "platform", /* superAdmin, admin, operator, viewer … */ },
} as const);
```

Everything downstream is **generated** from this file at type level (no codegen step, no drift):

- `Permission` union → used by `GrantInput`, `.access()`, the web's `Can`/`useCan`, the CLI.
- `Risk` per permission → drives the UI warning, the approval guardrail default, and the audit level.
- `BUNDLES × ROLES` matrix → the permission matrix snapshot test.
- A `Permission` that exists in code but is granted to nobody → warning in `check:authz-catalog`.

**Why code**: a permission is a product contract. Allowing slugs from a UI produces the role sprawl WorkOS documents.
Adding one is a one-line change that TypeScript then forces through every consumer.

---

## 5. Effect architecture

New package `packages/auth/src/authz/` (pure + Effect, no Nest):

```
authz/
  catalog.ts            L1: permissions, bundles, system roles, risk, guardrails
  model.ts              types: Scope, Grant, Role, Decision, Facts, AuthzError
  evaluate.ts           PURE: evaluate(facts) -> Decision          (no I/O, table-tested)
  conditions.ts         typed condition DSL -> predicate + SQL compiler
  resolver.ts           PermissionResolver: load grants+roles, memo per request, epoch cache
  authz.service.ts      Authz: check/require/explain/listScoped — the Effect service
  layers.ts             AuthzLive (needs PermissionResolver, AuthzStore ports)
  gate.ts               oRPC middleware: reads `.access` metadata, calls Authz.require
  witness.ts            Authorized<"service:deploy", ServiceId> proof type for service methods
```

```ts
// authz.service.ts
export class Authz extends Context.Service<Authz, {
  readonly check:   (q: AuthzQuery) => Effect.Effect<Decision, never>;
  readonly require: (q: AuthzQuery) => Effect.Effect<void, AuthzDenied>;
  readonly explain: (q: AuthzQuery) => Effect.Effect<Explanation, never>;
  readonly listScoped: <R>(q: ListQuery<R>) => Effect.Effect<SQL, never>;   // filter-to-SQL
}>()("authz/Authz") {}

// usage inside a handler (no `require*` middleware needed for the permission itself)
procedure(contract.service.deploy)
  .access({ permission: "service:deploy", resource: "service", by: "input.serviceId" })
  .effect(function* ({ input, context }) {
    const authz = yield* Authz;
    yield* authz.require({ permission: "service:deploy", scope: { kind: "service", id: input.serviceId }, context });
    // …
  });
```

Design rules:
1. **`evaluate` is pure** and is the only place the decision order lives: explicit `deny` → `allow` → default deny.
   No `superAdmin` branch, ever. Table-driven tests (`SEC-092`) and a property test "no escalation" (`SEC-093`).
2. **`PermissionResolver` is request-scoped**: one load of grants + roles + conditions per request, memoized in a
   `FiberRef`, cached across requests by `(actor, epoch)` where `authz_epoch.value` invalidates everything on change
   (`NOTIFY authz_epoch` → in-process bus → drop cache).
3. **The gate is declared once**, in `createOrpcModule`/`createMeshOrpcModule` (`AUTHZ-012`), so no service can forget it.
   `procedure(...)` without `.access()` fails the build (`SEC-062`); `publicAccess()` is the only explicit opt-out and
   appears in a generated public-surface list reviewed in PRs.
4. **Service layer proof**: mutating service methods take `Authorized<Permission, Id>`, produced only by `authz.require`
   (`witness.ts`). A caller cannot reach the repository without a decision (`SEC-057`).
5. **Guardrails** are Effects evaluated after identity: step-up (`AUTHZ-031`), second approver (`AUTHZ-032`), quota,
   IP/time window. They return `Decision.require_action(...)`, never a silent deny, so the UI can ask for the TOTP.
6. **Decision log** is an Effect forked from the check, sampled by risk tier (all `reveal`/`admin`, 1 % of reads), with
   `correlation_id` from `provideRequest`. It feeds `authz_decisions` and the audit log.
7. **Errors**: one tagged `AuthzDenied { permission, scope, reason, missingGrantHint }` → mapped to `FORBIDDEN` (404
   concealment per `DEC-AUTH`), and *never* leaking which rule denied to an unauthenticated caller.

---

## 6. DX

| Surface | What a developer writes | What the system guarantees |
|---|---|---|
| New procedure | `.access({ permission, resource, by })` next to the contract | build fails if missing; generated 403 test; OpenAPI/ORPC docs gain the permission |
| New permission | one line in `catalog.ts` | typed everywhere; a `check:authz-catalog` warns until a bundle claims it |
| New system role | one entry in `systemRoles` | matrix snapshot + docs update required |
| Handler check | `yield* Authz` → `require` / `listScoped` | memoized; no N+1; same trace as the handler |
| Web | `useCan("service:deploy", { serviceId })`, `<Can …>` | one capability map from the server, no duplicate role logic |
| Tests | `authzTestMatrix()` generated | every controller × every role → 403 table (`SEC-038`) |
| Debug | `deployer authz explain --user u --permission p --scope service:s` | prints: grants considered, conditions evaluated, rule that decided, guardrails |
| Local | `AUTHZ_PRESET=solo` | a single-operator install gets the owner role with no UI work |

`deployer authz` subcommands: `explain`, `simulate --as`, `diff role-a role-b`, `grant`, `revoke`, `roles list`,
`recover` (host-only lock-out recovery: writes a grant through the DB with the platform secret).

---

## 7. Editable roles and permissions (super admin)

**Who may edit what**: a platform `superAdmin` (and `admin` once a grant says so) edits custom roles and grants. A project
`owner` edits grants *inside their project*, but only for permissions the platform has delegated to projects
(`bundles` tagged `delegable`).

**Editor rules** (all enforced server-side, mirrored in the UI):
1. Create a custom role by **cloning a system role** (Stripe model). `base_role` is stored; only removals are allowed.
2. The permission picker shows **bundles** first; expanding shows atomic permissions with their risk tier.
3. A change is **previewed as a diff** against the base and against the affected users' current effective permissions
   (`+2 / −1`), with a "simulate as" switcher.
4. Save writes the role, a `authz_role_versions` snapshot, bumps `authz_epoch`, and emits an audit event.
5. Deleting a role with live grants is refused; it must be reassigned first (`409`, with the count).
6. Risky permissions (`reveal`, `admin`) carry a warning and, if the operator configured it, a second-approver guardrail.
7. **No lock-out**: removing the last `role:assign` grant on the platform is refused; recovery remains possible with
   `deployer authz recover` on the host.

Procedures (`packages/contracts/api/modules/authz/**`):

```
authz.roles.list | get | create (clone) | update (permissions) | delete
authz.grants.list | create | revoke | extend
authz.explain  (actor, permission, scope)      admin-only, or self for own permissions
authz.simulate (as, permission, scope)
authz.catalog  (permissions, bundles, system roles, risk tiers)   read-only, drives the UI
authz.effective (user, scope) → the resolved permission set, for the "what can this person do" screen
```

---

## 8. Web UI

| Screen | Content |
|---|---|
| `/dashboard/settings/roles` | role list (system / custom), clone button, "used by N users" |
| role editor | bundle grid → atomic permissions, risk badges, diff preview, simulate-as panel |
| `/dashboard/settings/grants` | grant table (subject, role/permission, scope, effect, expiry), bulk revoke, filter by scope |
| user detail → Access | effective permissions grouped by scope, "why?" drawer, expiry countdown |
| project settings → Members | project-scoped grants only, delegable bundles only, no platform vocabulary |
| any 403 | `AuthzDenied` renders the permission, the scope, and the missing grant (for admins) or a plain refusal (others) |

`useCan(permission, scope)` and `<Can>` come from the generated capability map; no component hardcodes a role name —
`rg "superAdmin|isAdmin" apps/web` must be zero outside the access module (CI check `AUTHZ-040`).

---

## 9. Phases and items

Effort: **S** < 1 day · **M** 1–3 days · **L** 1–2 weeks · **XL** > 2 weeks. Phase totals assume one engineer.

### Phase A — Foundations (≈2 weeks, no behaviour change)
| ID | Item | Effort | Done when |
|---|---|---|---|
| `AUTHZ-001` | Catalog: permissions, bundles, system roles, risk tiers; `Permission` union generated | M | `check:authz-catalog` passes; adding a permission without a bundle warns |
| `AUTHZ-002` | `model.ts` + pure `evaluate()` with deny-first, conditions, expiry; table tests | M | 100 % branch coverage on `evaluate`; no I/O in the module |
| `AUTHZ-003` | Schema + migration `0041_authz_core` (roles, grants, versions, decisions, epoch) | M | migration applies and rolls back; constraints proven by tests |
| `AUTHZ-004` | Backfill `role_rules` → grants; legacy fallback flag; `role_rules` marked deprecated | M | a seeded install yields identical decisions to the old engine on a captured matrix |
| `AUTHZ-005` | `PermissionResolver` (ports, epoch cache, NOTIFY) | M | cold/warm latency recorded; stale cache impossible between epoch bumps |
| `AUTHZ-006` | `Authz` service + `AuthzLive` layer + tagged `AuthzDenied` | M | service tested through a fake resolver; no Nest import in the package |
| `AUTHZ-007` | `EFF-014` request-scoped `CurrentActor`/`Correlation` (prerequisite) | M | handler sees the caller; process-global context untouched |

### Phase B — The gate (≈1.5 weeks, shadow only)
| ID | Item | Effort | Done when |
|---|---|---|---|
| `AUTHZ-010` | `.access()` builder + contract metadata (`SEC-061`) | M | a contract without `.access`/`.public` fails `check:authz-contracts` |
| `AUTHZ-011` | `gate.ts` middleware + wiring in both oRPC hosts (`SEC-062`) | M | every procedure passes through it; `publicAccess()` requires an explicit `.public()` |
| `AUTHZ-012` | Annotate all procedures, area by area (`SEC-064`) | L | 100 % of procedures annotated; generated public list reviewed |
| `AUTHZ-013` | **Shadow mode** (`AUTHZ_MODE=shadow`) + disagreement report (`SEC-082`) | M | compares legacy middleware vs new gate per request; daily report; zero false denies on the e2e journeys |
| `AUTHZ-014` | `Authorized<…>` witness for mutating service methods (`SEC-057`) | M | a service method call without a decision does not compile |
| `AUTHZ-015` | Generated 403 matrix test (`SEC-038`) | M | every controller × role asserted; CI fails on a new procedure without a row |

### Phase C — Enforcement (≈1 week, per area)
| ID | Item | Effort | Done when |
|---|---|---|---|
| `AUTHZ-020` | Per-area enforcement flags (`authz.mode.<area>`) + kill switch to shadow | S | flipping one area enforces it; flipping back never disables the gate |
| `AUTHZ-021` | Enforce identity → project → fleet/runtime → cluster → nodes (in that order) | M | each flip has a rollback note and a green journey run |
| `AUTHZ-022` | Filter-to-SQL for lists/streams/counts (reuse `filter-compiler`) | L | no post-filter; a viewer's list is filtered in SQL (asserted by EXPLAIN in a test) |
| `AUTHZ-023` | Remove the `superAdmin → ALLOW` branch and `role_rules` fallback | S | `rg "superAdmin.*ALLOW" packages/auth` is empty; matrix unchanged for the owner role |

### Phase D — Explain, log, CLI (≈1 week)
| ID | Item | Effort | Done when |
|---|---|---|---|
| `AUTHZ-030` | Decision log + audit events (`authz_decisions`, sampled by risk) | M | a denied request has a row with `rule_ids` and correlation id |
| `AUTHZ-031` | `authz.explain` + `authz.effective` procedures | M | the UI drawer and CLI print the same tree for the same request |
| `AUTHZ-032` | `deployer authz` CLI (explain, simulate, diff, grant, revoke, recover) | M | lock-out recoverable from the host in one command |

### Phase E — Editing (≈2 weeks)
| ID | Item | Effort | Done when |
|---|---|---|---|
| `AUTHZ-040` | `authz.roles.*` + `authz.grants.*` contracts, subset rule, versioning, audit | L | a clone-and-remove role works; an addition beyond the base is refused; a delete with live grants is refused |
| `AUTHZ-041` | Role editor UI (bundles → permissions, risk badges, diff, simulate-as) | L | an operator can create "deployer (staging only)" from the UI, see the diff, and assign it |
| `AUTHZ-042` | Grants UI + project-scoped delegation (delegable bundles only) | M | a project owner cannot grant a platform permission |
| `AUTHZ-043` | Effective-permission screen + "why?" drawer + 403 rendering | M | a user can see their own access and the reason for a refusal |
| `AUTHZ-044` | Lock-out protection, boot invariant, recovery runbook (`SEC-081`) | S | removing the last `role:assign` is refused; recovery tested |

### Phase F — Guardrails and scale (≈1.5 weeks)
| ID | Item | Effort | Done when |
|---|---|---|---|
| `AUTHZ-050` | Step-up TOTP guardrail for `reveal`/`admin` | M | `container:exec` asks for a fresh factor; decision recorded |
| `AUTHZ-051` | Second-approver guardrail (two-person rule) | M | a production deploy can require an approval; the approval is a first-class grant |
| `AUTHZ-052` | Scoped API tokens (`owner grants ∩ token scopes`) | M | a token can never exceed its owner, proven by a property test |
| `AUTHZ-053` | ReBAC closure for `node`/`cluster` scopes and project→environment inheritance | M | an environment grant is inherited by its services; a sibling is not |
| `AUTHZ-054` | Performance budget: p50 warm < 0.2 ms, p95 cold < 8 ms with 1k grants | S | a benchmark in CI fails on regression |

**Sequencing.** A → B → C → D → E → F. `AUTHZ-007` (`EFF-014`) blocks B. E does not block C: enforcement works with the
seeded system roles before any custom role exists — that is the point of starting with a code catalog.

**Total**: ≈9–10 engineer-weeks to enforced + explainable + editable, matching the 9–12 week estimate in
`authz-authn-design.md`.

---

## 10. CI gates

| Gate | Fails when |
|---|---|
| `check:authz-catalog` | a permission has no bundle; a system role references an unknown permission; a risk tier is missing |
| `check:authz-contracts` | a procedure has neither `.access()` nor `.public()`; a `.public()` was added without a reason string |
| `check:authz-matrix` | the generated 403 matrix is stale (a procedure or role changed without the snapshot) |
| `check:authz-roles` | `apps/web` mentions a role name outside `src/lib/access`; a role slug is duplicated |
| `check:authz-perf` | the resolver benchmark exceeds the budget |
| existing | `bun run type-check` (116/116), `check:di-graph`, `check:global-modules` |

---

## 11. Rollout and rollback

1. Phase A/B ship dark: the gate runs, evaluates, logs, and never denies (`AUTHZ_MODE=shadow`).
2. Shadow report compares it with today's middleware, per area, for one release cycle; any disagreement is investigated
   before the flip.
3. Flip per area (`identity → project → fleet/runtime → cluster/nodes`), each behind `authz.mode.<area>`.
4. The kill switch returns an area to **shadow**, never to "off" — an unenforced request is still logged as would-deny.
5. Rollback of a role edit is a `authz_role_versions` restore (one command), which bumps the epoch.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Lock-out after enforcement | boot invariant + last-`role:assign` refusal + host `authz recover` + shadow first |
| Role sprawl once custom roles exist | clone-from-template, bundles by default, `diff role-a role-b` in the UI, "used by N" to make orphans visible |
| List endpoints leak rows | filter-to-SQL is a phase-C gate with EXPLAIN assertions, not an afterthought |
| Cache serves a revoked grant | every write bumps `authz_epoch`; the resolver keys its cache on it; a test asserts a bump is visible to the next request |
| Two permission vocabularies (platform vs project) | one catalog with `scopeKind` on the role; a test refuses a project role that names a platform-only permission |
| Platform vs project role confusion in the UI | two screens, never one mixed list; delegable bundles only in the project screen |

## 13. Mapping to existing items (do not double-track)

| This roadmap | Existing |
|---|---|
| `AUTHZ-001` | `SEC-048` (catalog), `SEC-052` (seed) |
| `AUTHZ-002` | `SEC-053` (pure evaluate), `SEC-092`, `SEC-093` |
| `AUTHZ-003` | `SEC-050` (tables) |
| `AUTHZ-005` | `SEC-055` (resolver), `SEC-056` (resource resolver) |
| `AUTHZ-006` | `SEC-054` (grants), `SEC-057` (Authz.check) |
| `AUTHZ-010`/`011` | `SEC-061`, `SEC-062`, `SEC-063` (spike) |
| `AUTHZ-012`-`015` | `SEC-064`, `SEC-082`, `SEC-038`, `SEC-080` |
| `AUTHZ-020`-`023` | `SEC-083` (enforce by area), `SEC-080` (interim gates, deleted at `AUTHZ-023`) |
| `AUTHZ-040`-`044` | `SEC-049` (system/custom roles), `SEC-081` (lock-out) |
| `AUTHZ-050`-`052` | `AUTH-054` (actor), `AUTH-052` (role projection), `SEC-055` |
| `AUTHZ-007` | `EFF-014` |

When an `AUTHZ-*` item is done, tick the mapped `SEC-*`/`AUTH-*`/`EFF-*` item in the same commit.

## 14. Decisions still needed from the operator

1. **Custom-role scope**: platform-wide only at first (simplest, matches "one team, a few nodes"), or per project later?
   Recommendation: platform now, `scope_kind = 'project'` reserved in the schema.
2. **Delegable bundles**: may a project owner grant `deploy`/`dns` themselves, or is every grant a platform action?
   Recommendation: yes for `deploy` and `dns`, no for `secret:reveal`/`role:assign`.
3. **Second-approver default**: off, opt-in per permission, or mandatory for `environment.kind = 'production'`?
   Recommendation: opt-in per permission, with the production preset one click away.
4. **Step-up window**: 5 minutes for `reveal`, 15 for `admin`?
5. **Public surface**: health, setup claim, invite accept, sign-in — confirm the list before `AUTHZ-012` freezes it.
