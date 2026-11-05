# PERMISSIONS ROADMAP — low-level, editable, Effect-native

Date: 2026-11-01. Status: **design, ready to implement**. Supersedes the *plan* in `authz-authn-design.md` §9–§10 (the
model there stands; this file turns it into phased, checkable work) and absorbs `SEC-048..SEC-064` from
`roadmap/auth-security.md` — those items keep their IDs and are referenced, not duplicated.

> **Update 2026-11-05 — the declaration moves out of the contract.** The review of 2026-11-05 replaced the contract-level
> `.access()` / `.meta(access(...))` with a typed `accessRequired(...)` middleware written in the controller, resources as
> plugins over ordinary Effect services, a grants model where roles are data and the code names only permissions, and a
> topology with one policy writer (identity) and in-process decisions everywhere. The canonical design is
> [`docs/architecture/access-requirements.md`](../architecture/access-requirements.md); the decisions are recorded in
> [`docs/qa/permissions/access-requirements-2026-11-05.md`](../qa/permissions/access-requirements-2026-11-05.md). Wherever
> this file still says `.access()` on a contract, read "a requirement in the controller" (see the rewritten §5, §6 and
> Phase B).

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
`Authz` service that every procedure goes through by declaration (`accessRequired(...)` in the controller, typed after `requireAuth()`), an explain/simulate
story in API + CLI + UI, and a role editor with clone-from-template, subset rule, diff preview and audit. No sidecar, no
policy language, no daemon: evaluation is in-process over Postgres rows, and lists compile to SQL.

| Dimension | Now | Target |
|---|---|---|
| Enforcement | `requireAuth()` (default allow) | default deny; the controller declares its requirement and the build and the boot fail if a procedure has no access middleware (`accessRequired`, `accessSelf`, `accessPublic` or `accessDeferred`) |
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
L3  Enforcement         Effect `Authz` service + typed `accessRequired` middleware (in the controller) + resource plugins + SQL filter compiler
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

- `Permission` union → used by `GrantInput`, `Service.can(...)` / `accessRequired`, the web's `Can`/`useCan`, the CLI.
- Scope kind per resource (and a per-action override such as `service:create` checked on the parent project) → the controller supplies only the scope *id*.
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
  access/               `accessRequired`, `accessSelf/Public/Deferred`, `defineResource`, plugin interfaces (lives in `@deployer/nest-effect`)
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

// usage: declared in the controller, never on the contract
procedure(contract.service.deploy)
  .use(requireAuth())
  .use(accessRequired(Service.can("deploy")))          // `.on` inferred from the resource's id key
  .effect(function* ({ context }) {
    context.access.service.row;                        // loaded once for the check, reused here
  });
// inside a handler, same vocabulary: const proof = yield* Service.require("update").on(svc.id)
```

Design rules:
1. **`evaluate` is pure** and is the only place the decision order lives: explicit `deny` → `allow` → default deny.
   No `superAdmin` branch, ever. Table-driven tests (`SEC-092`) and a property test "no escalation" (`SEC-093`).
2. **`PermissionResolver` is request-scoped**: one load of grants + roles + conditions per request, memoized in a
   `FiberRef`, cached across requests by `(actor, epoch)` where `authz_epoch.value` invalidates everything on change
   (`NOTIFY authz_epoch` → in-process bus → drop cache).
3. **The requirement is declared where the handler is written**, and cannot be forgotten: the terminal `.effect()` of
   `procedure(...)` requires `context.access`, which only `accessRequired` / `accessSelf` / `accessPublic` /
   `accessDeferred` produce (`SEC-062`), and a boot audit refuses a mounted procedure without one. `accessPublic(reason)`
   is the only anonymous form and appears in a generated public-surface list reviewed in PRs. See
   `docs/architecture/access-requirements.md`.
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
| New procedure | `.use(accessRequired(Service.can("deploy")))` in the controller | build and boot fail if missing; generated 403 test; the permission manifest gains the entry |
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
| `AUTHZ-010` | **First slice done 2026-11-05** (builder, self/public/deferred, typing, tests, identity user controller; `onEach`/`anyOf`/`notAbove`/`requiring`/`loaded` pending): `accessRequired` typed builder (after `requireAuth()`), `accessSelf` / `accessPublic` / `accessDeferred`, `context.access` typing (`SEC-061`) | M | a procedure without one of the four does not compile; placing it before `requireAuth()` does not compile |
| `AUTHZ-011` | Remove the `Proxy` auto-append in `procedure()`; boot audit over mounted procedures; boundary check for `accessDeferred` (`SEC-062`) | M | a controller that bypasses `procedure()` fails the boot; a deferred procedure with no decision fails (enforce) or logs (shadow) |
| `AUTHZ-012` | Write the requirement on every controller, area by area; migrate the ~160 interim contract annotations (identity ~50, fleet ~42, project ~70) and delete them (`SEC-064`) | L | 100 % of procedures declare access in the controller; no `access(` in `packages/contracts`; generated public list reviewed |
| `AUTHZ-013` | **Shadow mode** (`AUTHZ_MODE=shadow`) + disagreement report (`SEC-082`) | M | compares legacy middleware vs new gate per request; daily report; zero false denies on the e2e journeys |
| `AUTHZ-014` | `Authorized<…>` witness for mutating service methods (`SEC-057`) | M | a service method call without a decision does not compile |
| `AUTHZ-016` | **Done 2026-11-05** (results in `access-requirements.md` §12; the BFF union-context case and scope inheritance in the store are still unverified). **Spike**: `defineResource` + `Service`/`User` + `accessRequired` with `.on` inference, one real controller (identity user update), the BFF's union contexts, three-requirement `.as` records, scope inheritance in the store | M | the unverified claims in `access-requirements.md` §11 are each confirmed or replaced by the stated fallback |
| `AUTHZ-017` | Resource and scope plugins: `ScopeResolver<K>` tags with `live` (owner) and `remote` (others) Layers, condition plugins (`environment`, `owner`, `time`), per-action scope kind in the catalog | L | a service that forgets a plugin fails the boot naming it; `ServiceScope.remote` resolves through the project client with a cache |
| `AUTHZ-019` | Identity as the single policy writer: authz tables claimed in `table-ownership.ts`, snapshot + epoch behind the `PermissionStore` port, `RoleCatalogueRefresher` stops reading `roles` directly | M | no service but identity writes an authz table (spec); a decision costs no database call; staleness rule implemented |
| `AUTHZ-015` | Generated 403 matrix test (`SEC-038`) | M | every controller × role asserted; CI fails on a new procedure without a row |

### Phase C — Enforcement (≈1 week, per area)
| ID | Item | Effort | Done when |
|---|---|---|---|
| `AUTHZ-020` | Per-area enforcement flags (`authz.mode.<area>`) + kill switch to shadow | S | flipping one area enforces it; flipping back never disables the gate |
| `AUTHZ-021` | Enforce identity → project → fleet/runtime → cluster → nodes (in that order) | M | each flip has a rollback note and a green journey run |
| `AUTHZ-022` | Filter-to-SQL for lists/streams/counts (reuse `filter-compiler`) | L | no post-filter; a viewer's list is filtered in SQL (asserted by EXPLAIN in a test) |
| `AUTHZ-024` | The subset rule replaces ranks: `.notAbove()`, grant/role-change limited to held permissions; `refuseAdminAction`, `platformRoleRank`, `requirePlatformRole` removed | M | `rg "platformRoleRank\|requirePlatformRole" apps packages` is empty; a custom role orders correctly with no rank |
| `AUTHZ-025` | Role names banned in code: lint rule for role literals outside the seed and recovery; web uses the generated manifest | S | the lint rule fails on a role literal in a controller, service or component |
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
| type check | a procedure has no access middleware; `accessRequired` precedes `requireAuth()`; `.on` is missing though the input lacks the resource's id key; duplicate `.as` name |
| boot audit | a mounted procedure has no access descriptor in its middleware chain; an `accessPublic` has no reason |
| `check:authz-ownership` | a service imports a table it does not own; an authz table has a writer other than identity |
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
| Typing does not hold (`.on` inference, authenticated-first in the BFF's union contexts) | spike `AUTHZ-016` first; fallback is an always-explicit `.on("key")`, with the boot audit as the guarantee |
| Identity unreachable | services keep deciding from the cached snapshot up to a maximum staleness, then deny all but public (rule is an open decision) |
| Foreign-scope lookups add latency and coupling | `remote` resolvers cache with TTL and epoch; coarse scopes are checked first |
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
| `AUTHZ-016`, `AUTHZ-017` | `SEC-056` (resource resolver), `SEC-063` (spike) |
| `AUTHZ-019` | `SEC-055` (resolver, fail-closed), `ARCH` table ownership |
| `AUTHZ-024`, `AUTHZ-025` | `AUTH-006` (hierarchy), `AUTH-052` (role projection) |

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
6. **Snapshot source** (2026-11-05): fetch from identity, or read-only access to the authz tables with identity as the single writer. Recommendation: read-only tables first, behind the `PermissionStore` port.
7. **Maximum staleness** of the policy snapshot when identity is unreachable, and what stays open (public routes only).
8. **Epoch signal**: poll (recommended first) or push.
9. **Admin and deploy**: the platform `admin` role holds no `deploy` bundle today; confirm that is intended.

## 15. What landed first (2026-11-01)

The DX half of Phase A/B is in, behind `AUTHZ_MODE` (default `off`, so nothing changes until an operator opts in):

| Piece | Where | State |
|---|---|---|
| Catalog: 60 permissions, 8 bundles, 8 system roles, risk tiers, `capabilitiesOfRole` | `packages/auth/src/authz/catalog.ts` → `@deployer/auth/authz` | done; used by API **and** web |
| Types + pure decision (`decide`, `can`, conditions `ownerOnly` / `notEnvironment`) | `packages/auth/src/authz/{types,evaluate}.ts` | done; 11 table tests |
| Effect service (`Authz.check/require/explain`) over a `PermissionStore` port, request-scoped memo | `packages/nest/effect/src/authz.ts` → `@deployer/nest-effect/authz` | done |
| `.access()` metadata plugin + `accessOf` | `@deployer/nest-effect/authz` | done, **interim**: superseded 2026-11-05 by `accessRequired` in the controller; removed at `AUTHZ-011`/`012` |
| Gate appended by `procedure()` after the controller's middlewares; `off`/`shadow`/`enforce` | `procedure()` in `packages/nest/effect/src/requirements.ts` | done, **interim**: the `Proxy` auto-append goes away; the modes move into `accessRequired` (`AUTHZ-011`) |
| Host configuration from `AUTHZ_MODE` | `apps/api/shared/src/server/orpc-host.ts` | done |
| Web capability check from the same catalog | `apps/web/src/lib/access/permissions.ts` (`useCan`, `useCapabilities`) | done; settings nav migrated |

Interim usage (contract metadata), kept for the record. The target form is in `docs/architecture/access-requirements.md`:

```ts
// contract
export const deployService = os
  .input(input)
  .meta(access({ permission: "service:deploy", scope: { by: "input", path: "serviceId" } }));

// controller — the gate is appended by `procedure()`, the handler asks when it needs the decision itself
procedure(deployService)
  .use(requireAuth())
  .effect(function* ({ input }) {
    const authz = yield* Authz;
    yield* authz.require({ actor, permission: "service:deploy", scope: { kind: "service", id: input.serviceId } });
    …
  });

// web — one import, no role logic
const canDeploy = useCan("service:deploy");
```

**Annotations made 2026-11-05** (project contracts, commit `de0a1e609` on `claude/zealous-haibt-23b527`, merged; identity and fleet were annotated earlier): about 70 + 50 + 42 procedures carry `.meta(access(...))`. Their permission names are the valid part; the declaration site moves to the controllers (`AUTHZ-012`). `packages/contracts/project/modules/access.spec.ts` is the interim completeness guard and is replaced by the boot audit.

Not yet: a database-backed `PermissionStore` (grants, deny, expiry — Phase A `AUTHZ-003/004/005`), the completeness check
(`AUTHZ-010`), annotating every procedure (`AUTHZ-012`), and the editor UI (`AUTHZ-040`). Until the store lands, the
platform-role store above is what the gate reads, and a project-scoped check resolves to a deny by design.

