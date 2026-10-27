# AuthN + AuthZ target design (SUB-A): "Grants + Guardrails"

> Design doc, 2026-10-26. Read-only design pass: nothing was run, no source was changed. It turns `SEC-001` / `IDEA-001` (policy-gated authorization on every procedure) and the surrounding `AUTH-*` / `SEC-*` items into one coherent system, designed once and applied uniformly across BFF, services, web, CLI, CI, agents and mesh.
> Evidence tags: **[code]** read in this repo today (path given) · **[doc]** vendor docs fetched this session · **[search]** web search this session · **[mem]** from memory, verify before relying on it · **[audit]** an existing audit file under `docs/audit-2026-10-25/`.
> Inputs read: `auth.md`, `ROADMAP.md`, `roadmap/auth-security.md`, `roadmap/ideas.md` (IDEA-001), `ideas-security-resilience.md` (I-01, I-02, I-05, I-06, I-18), `effect-health-identity.md`, `effect-architecture.md`, `effect-ecosystem-research.md`, `bench-*` (RBAC/SSO/audit rows), plus `packages/auth/**`, `packages/nest/schema/**`, `apps/api-services/shared/**/auth/**`, `packages/infrastructure/mesh-network/**`, `apps/web/src/lib/access/**`.

---

## 0. Decision summary (one screen)

| # | Decision | Why in one line |
|---|---|---|
| 1 | **Authorization model = capability RBAC with scoped grants (platform > project > environment > service, plus node scopes), deny grants, and a small typed *guardrail* layer (deny / require step-up / require approval / quota).** Not Zanzibar, not Cedar/OPA. | The hierarchy is fixed and 4 levels deep, attributes are few (env kind, risk, time, IP, assurance). Anything richer is cost we cannot afford at one operator, and we already own a tested filter-to-SQL compiler. |
| 2 | **Better Auth stays the authentication engine** (sessions, passkeys, TOTP, device flow, API-key storage, OIDC later). **Authorization is ours** and is *not* stored in Better Auth's `user.role` any more; `user.role` becomes a write-protected projection. | BA has no per-resource roles, no deny, no conditions [doc]. Its org plugin cannot express per-project roles without our own tables [doc]. |
| 3 | **Everything that authenticates normalises into one `Actor`** (principal + credential + assurance + token ceiling + on-behalf-of chain + origin). Exactly one `Authz.require(permission, resource)` decides, always `grants(actor) ∩ tokenCeiling ∩ delegationChain`. | One value, one function, one audit shape. |
| 4 | **Default deny, enforced three times:** oRPC gate middleware reading `meta.access` (runtime), a build/CI check that every contract procedure is annotated or explicitly `public` (build), and an `Authorized<…>` witness required by mutating service methods (types). | `requireAuth()`-only is the root cause of the audit's P0 cluster [audit auth.md §0.3]. |
| 5 | **No hidden bypass.** The engine's `superAdmin → ALLOW` shortcut [code `permission-engine.ts` step 1] is deleted. The owner role holds all capabilities; guardrails apply to everyone. Lock-out recovery is a host-level CLI (`deployer authz recover`). | An unaudited bypass is a backdoor with a nicer name. |
| 6 | **Service-to-service: signed actor claim** (EdDSA, 30 s TTL, audience-bound) replaces cookie/AsyncLocalStorage forwarding; services have their own least-privilege principals; deputy calls require both. | Closes `SEC-030/031`, resolves `DEC-SEC-3` and `EFF-016`. |
| 7 | **Tokens are credentials, not principals.** Effective permission of a token is evaluated *live* as `owner grants ∩ token scopes`, so a token can never exceed its owner, even after the owner is demoted. Agent tokens default read-only. | No escalation by construction. |
| 8 | **Rollout: shadow mode first, per-area enforce flips, kill switch that falls back to shadow (never to "off").** | Empty rules deny everyone today [audit IDEA-001]; naive wiring locks the operator out. |
| 9 | **Orgs: no. Groups: later. OIDC SSO: Phase 6. SCIM/SAML: not until a customer-shaped need.** | Matches `DEC-AUTH-1` recommendation; the data model leaves one clean extension point (a new ancestor scope type). |

Total effort to "every procedure gated, shadow then enforced, scoped tokens, step-up": **~9-12 engineer-weeks** (table in §9). Admin UI, approvals, elevation and agents add ~4-5 more.

---

## 1. Requirements derived from the product

### 1.1 Who and what calls the platform

Self-hosted VPS/mesh deployment platform; today one operator, soon a small team (2-10), maybe orgs later [audit ROADMAP §5 decision 3]. Callers:

| Caller | Today | Requirement |
|---|---|---|
| Human in browser | Better Auth cookie, role string in session | passkey/password+TOTP, step-up for destructive actions, per-project roles, session policy |
| CLI (`deployer ...`) | master token / default creds / seed user [audit auth.md §1 Device auth] | device-code login yielding a *scoped, expiring* credential |
| CI / deploy hooks | nothing usable (API key header mismatch) | deploy-only token for one project/service/environment, IP-restrictable, rotatable |
| AI agent / MCP | `agentAuth.ts` dead code | read-only by default; mutations by human approval; scopes visible at approval time |
| Service tier (`svc-project`, `svc-fleet`, `svc-runtime`, `svc-identity`, BFF) | cookie forwarded by AsyncLocalStorage, some calls anonymous [code `service-auth-context.ts`] | verified service identity + verified end-user identity, least privilege |
| Mesh node / member | HMAC `v1.`/`v2.` tokens from a shared secret, bare secret accepted with `===` [code `packages/auth/src/mesh`, `requireMesh()`] | key-based identity from the signed roster, capability-limited |
| Webhook ingress (GitHub/GitLab/deploy hook) | HMAC secret per webhook | a principal that can do exactly "deploy service X" |
| Background jobs (scheduler, supervisors, cleanup) | no identity [audit SEC-030] | named system actors with fixed small capability sets |
| Anonymous | many accidental | explicit, enumerated, reasoned `public` list (health, setup claim, invite accept, sign-in) |

### 1.2 Resources and the actions that matter

Hierarchy (already encoded in `RESOURCE_GRAPH`: project > service > deployment > logs, project > webhook/apiKey [code `resource-graph.ts`]):

```
platform
 ├─ node (and node label sets), cluster, registry, dns-provider, edge/ingress, domain(platform),
 │   secret(platform), mesh roster, user, group, role, token, audit, settings, setup
 └─ project
     ├─ member (collaborator), webhook, template, secret(project)
     ├─ environment (kind: production | staging | preview | dev)
     └─ service
         ├─ deployment, logs, container (exec, files), domain mapping, env var, secret(service)
```

Sensitive verbs the model must be able to single out (these drive risk tiers, §3.3): `container:exec`, `secret:reveal`, `cluster.join-token:reveal`, `node:revoke`, `project:delete`, `role:assign`, `token:create`, `deployment:create` on production, `dns.record:write`, `domain:attach`, `setup:*`.

### 1.3 Non-functional requirements

1. **Granularity without ceremony.** A solo operator must not feel the system; a team must be able to say "Alice deploys to staging of project X, only maintainers deploy to prod, nobody execs in prod without a second person".
2. **Explainable.** "Why was this denied / allowed?" answerable from the UI and from a log row.
3. **List correctness.** Lists, counts and streams must be filtered by access in SQL (`SEC-034`), not post-filtered in memory.
4. **No escalation.** A principal can never create, grant, invite, mint a token, or delegate more than it holds (`AUTH-002/006/007`, `SEC-007`).
5. **Mesh-first compatibility.** Node-facing authority is cryptographic and lives in the roster [memory: mesh-first]; human-facing authorization lives in Postgres, because the API tier needs a database anyway. We do **not** build a central policy server nodes must dial.
6. **Effect-native.** Actor is an Effect service (`EFF-014`), checks are Effects in the same trace as repository reads, tests use `Layer`s.
7. **Cheap to run.** No new daemon (no OpenFGA/SpiceDB/OPA sidecar). Permission decisions add <2 ms p50 warm (cache) and one indexed query cold.
8. **Safe rollout.** Shadow mode, per-area flips, tested rollback.

---

## 2. Principal model and authentication

### 2.1 Principals

```
Principal =
  | User            { id }                            human; BA user row, kind='human'
  | ServiceAccount  { id, ownerId }                   non-human; BA user row, kind='service_account'; never signs in; owns tokens
  | Agent           { id, tokenId, ownerId }          an AI/MCP session; always acts on behalf of an owner (credential kind 'agent-token')
  | Service         { name }                          workload identity: bff | svc-project | svc-fleet | svc-runtime | svc-identity | mesh-agent
  | MeshMember      { memberId }                      roster-admitted member (node, operator laptop)
  | Webhook         { webhookId, projectId }          inbound webhook ingress principal
  | System          { job }                           scheduler | supervisor | cleanup | migration
  | SetupClaim      { claimId }                       the one-time first-run principal (replaces default-admin bootstrap)
  | Anonymous
```

Design choices, each with its reason:

- **Service accounts are Better Auth `user` rows with `kind='service_account'`.** BA's API-key plugin owns `referenceId -> user` natively [doc: ownership by `references`], so tokens, expiry, rate limit and revocation work with zero custom code. Cost: user lists must filter by `kind`; sign-in paths reject `kind != 'human'` in a session `before` hook. Alternative (separate table + polymorphic `referenceId`) rejected: breaks the plugin's FK assumptions.
- **A token is not a principal.** It is a *credential* of a `User`, `ServiceAccount` or `Agent`. The Actor records both (`principal`, `credential`), so audit shows "alice via token `ci-prod-deploy`".
- **`Agent` is a principal kind only to make policy and audit expressive** (`actor.principal.kind == 'agent'` in guardrails). It can never hold grants of its own; its permissions are always `owner ∩ token scopes`.

### 2.2 Credentials and verifiers

| Credential kind | Used by | How it authenticates | Verifier layer | Assurance |
|---|---|---|---|---|
| `session` (cookie) | human, browser | BA `getSession`, **cookie cache disabled for gate decisions** (we read grants from DB, never from the cached role) | `SessionVerifier` | password = AAL1; +TOTP = AAL2; passkey UV = AAL3 |
| `session` via device code | CLI | RFC 8628 device flow (BA `deviceAuthorization` [code `securityPlugins.ts`]) mints a **bearer session token bound to a CLI device row**, with `scope` string shown on the approval page | `SessionVerifier` (bearer) | inherits approver's AAL at approval time, capped AAL2 |
| `api-token` (`dk_…`) | CI, scripts, ServiceAccounts, agents | `Authorization: Bearer dk_…` via BA `customAPIKeyGetter` (fixes the `x-api-key`-only gap [audit AUTH-019]); BA verifies hash/expiry/rate-limit [doc: expiry, rate limit, `permissions`]; we then load `token_constraints` (IP allowlist, risk ceiling, project scope, kind) | `ApiTokenVerifier` | AAL0 (no step-up possible; step-up-required actions are refused to tokens unless approval path) |
| `actor-claim` | BFF -> services | EdDSA compact JWT in `x-actor-claim`, `aud` = target service, `exp` <= 30 s, `jti` replay-checked per service, signer key admitted in the roster as a `service` member with capability `sign-actor` | `ActorClaimVerifier` | carried from the original credential |
| `service-token` | service -> service (no user), jobs | EdDSA JWT signed by the service's own key (Docker secret now; mesh member key later), `aud`-bound, 60 s TTL | `ServiceTokenVerifier` | n/a |
| `mesh-signature` | mesh agents -> API | Ed25519 signature over `(method, path, body-digest, ts, nonce)` by an **active roster member's signing key**; replaces the shared-secret HMAC and the bare-secret `===` path | `MeshVerifier` | n/a |
| `webhook-signature` | GitHub/GitLab/deploy hook | existing HMAC per webhook (constant-time) -> `Webhook` principal | `WebhookVerifier` | n/a |
| `setup-claim` | first-run wizard | one-time claim token bound to a passkey enrolment (`AUTH-016`) | `SetupClaimVerifier` | AAL3 after enrolment |
| none | public routes | only on procedures that declare `access: public({reason})` | `AnonymousVerifier` | none |

Rules shared by all verifiers:

1. **Exactly one credential kind per request**; two different kinds present -> 400 `AMBIGUOUS_CREDENTIALS` (kills confused-credential tricks).
2. **No credential material is ever forwarded to services.** After cutover services accept only `actor-claim`, `service-token`, `mesh-signature`, `webhook-signature`. They never see browser cookies or user tokens. This deletes the ALS cookie forwarding and the "services re-resolve the session with the same secret" coupling [code `service-auth-context.ts`], and makes `SEC-032` (network policy) defence-in-depth rather than the only barrier.
3. **Revocation is immediate for permissions, bounded for authentication**: grants are read from DB (cache TTL <= 30 s, epoch invalidation), so demoting a user takes effect within seconds even though their cookie lives on. Bans/disable additionally revoke sessions and tokens (`AUTH-013`).

### 2.3 The normalised `Actor`

```ts
// packages/auth/src/authz/actor.ts  (new; replaces ORPCAuthContext for authorization purposes)
import { Context, Data } from "effect"

export type PrincipalKind =
  | "user" | "service_account" | "agent" | "service" | "mesh_member"
  | "webhook" | "system" | "setup_claim" | "anonymous"

export type Principal =
  | { readonly kind: "user"; readonly id: string }
  | { readonly kind: "service_account"; readonly id: string; readonly ownerId: string }
  | { readonly kind: "agent"; readonly id: string; readonly ownerId: string; readonly tokenId: string }
  | { readonly kind: "service"; readonly name: ServiceName }
  | { readonly kind: "mesh_member"; readonly memberId: string }
  | { readonly kind: "webhook"; readonly webhookId: string; readonly projectId: string }
  | { readonly kind: "system"; readonly job: string }
  | { readonly kind: "setup_claim"; readonly claimId: string }
  | { readonly kind: "anonymous" }

export type CredentialKind =
  | "session" | "device_session" | "api_token" | "agent_token" | "actor_claim"
  | "service_token" | "mesh_signature" | "webhook_signature" | "setup_claim" | "none"

/** Authentication Assurance: 0 none/token, 1 password, 2 MFA, 3 phishing-resistant (passkey, user-verified). */
export type Aal = 0 | 1 | 2 | 3

export interface Assurance {
  readonly aal: Aal
  readonly authTime: number              // epoch s of primary auth
  readonly stepUpAt?: number             // epoch s of last accepted step-up assertion on THIS session
  readonly stepUpLevel?: Aal
}

/** Strict upper bound a credential places on its principal. `all` = no ceiling (interactive session). */
export type Ceiling =
  | { readonly kind: "all" }
  | {
      readonly kind: "scoped"
      readonly permissions: ReadonlyArray<PermissionPattern>   // "deployment:create", "logs:*"
      readonly scopes?: ReadonlyArray<ScopeRef>                // optional resource restriction: project:abc, service:xyz
      readonly maxRisk: Risk                                   // e.g. "medium": can never do high/critical
      readonly readOnly: boolean
      readonly expiresAt: number
    }

export interface Origin {
  readonly via: "web" | "cli" | "ci" | "mcp" | "service" | "mesh" | "webhook" | "system"
  readonly ip?: string
  readonly userAgent?: string
  readonly nodeId?: string              // mesh member / node the call came through
  readonly requestId: string
}

/** One hop of delegation, outermost (originator) first. */
export interface Delegation {
  readonly principal: Principal
  readonly credential: CredentialKind
  readonly ceiling: Ceiling
}

export interface Actor {
  readonly principal: Principal
  readonly credential: { readonly kind: CredentialKind; readonly id?: string }   // tokenId, sessionId, claim jti
  readonly session?: { readonly id: string; readonly deviceId?: string; readonly createdAt: number }
  readonly assurance: Assurance
  readonly ceiling: Ceiling
  /** Non-empty when a service or agent acts for someone, or an admin impersonates. Evaluated as an intersection. */
  readonly onBehalfOf: ReadonlyArray<Delegation>
  readonly elevations: ReadonlyArray<{ readonly grantId: string; readonly expiresAt: number }>
  readonly origin: Origin
}

export class CurrentActor extends Context.Service<CurrentActor, Actor>()("auth/CurrentActor") {}

export const Actor = {
  anonymous: (origin: Origin): Actor => ({ /* kind:"anonymous", aal 0, ceiling: scoped with no permissions */ }) as Actor,
  system: (job: string, requestId: string): Actor => ({ /* kind:"system" … */ }) as Actor,
  /** Effective subject for grant lookup: the originator when delegated, otherwise the principal. */
  subjects: (a: Actor): ReadonlyArray<Principal> => [a.principal, ...a.onBehalfOf.map((d) => d.principal)],
}
```

Notes:
- `CurrentActor` is **always provided** by the `effect/wrap` installer (`EFF-014`), anonymous when there is no credential. Types do not give default-deny; the gate (§5.4) and the `Authorized` witness (§5.5) do.
- **Effective permissions** of an Actor for `(permission, resource)`:
  `grants(principal) ∩ ceiling(credential) ∩ ⋂ over onBehalfOf hops of (grants(hop.principal) ∩ hop.ceiling)`.
  Impersonation and agent delegation use the same rule, so they can only narrow.
- Deputy calls (service acts for a user) are the one place the intersection is relaxed, deliberately and explicitly (§5.6).

---

## 3. Authorization model

### 3.1 Options compared

Criteria weighted for *this* product (small self-hosted tool, one-to-few operators, fixed shallow hierarchy, strong need for list filtering and explainability).

| Criterion | A. Flat RBAC (today: platform role + project role) | **B. RBAC + scoped grants + guardrails (recommended)** | C. ReBAC / Zanzibar (OpenFGA, SpiceDB, or tuples in Postgres) | D. ABAC policy-as-code (Cedar, OPA/Rego, CEL, Casbin) |
|---|---|---|---|---|
| Per-project / environment / service / node grants | no (project role only via collaborators table; nothing for env/service/node) | **yes: grant = (subject, role or perms, scope node)** | yes (relations on any object) | yes (attributes) |
| Deny rules | no | **yes (explicit deny grants, deny > allow)** | awkward (exclusion operators, "but not") | yes (forbid in Cedar/Rego) |
| Conditions (env kind, time, IP, assurance) | no | **yes via guardrails + optional per-grant condition (DFilter)** | contextual tuples/caveats, limited | **best** |
| Inheritance platform > project > env > service | manual | **native (ancestry walk; scope ancestor-or-equal)** | native (parent relations) | via attributes, manual |
| Custom roles | no | **yes (role = named permission bundle; subset-of-creator rule)** | model change, not runtime roles | policy edit |
| **List filtering in SQL** | no | **yes: grants -> `IN`/`NOT` predicate; compiler exists (`buildWhereClause`, `filter-compiler.ts`) [code]** | `ListObjects` is expensive; hand-built needs closure tables/recursive CTE | **hard**: Cedar partial eval is experimental [mem]; OPA partial-eval -> SQL needs extra tooling [mem]; Casbin none |
| Explain / simulate | trivial but shallow | **good: finite grants + finite policies -> full trace** | good (check-expand) | good (Cedar analysis/`explain` [mem]) |
| Escalation safety ("cannot grant what you lack") | ad hoc | **one rule: `perms(newGrant) ⊆ perms(grantor) at that scope`, property-testable** | hard to state over arbitrary relations | hard in general |
| Extra moving parts for a self-hoster | none | **none (tables + a library)** | OpenFGA/SpiceDB = another server+DB, or a big hand-rolled engine | OPA sidecar or WASM runtime; Cedar via WASM binding |
| Reuse of existing code | the status quo | **~1.9k LOC engine: DFilter matcher + SQL compiler + resource graph + validator [code `packages/auth/src/permissions/engine`]** | none | none |
| Learning/maintenance cost for the operator | low, but doesn't solve the problem | **low-medium; UI = roles + grants + a few guardrails** | high | high (new language to review) |
| Fit with "orgs/teams later" | poor | **good: groups = subject sets (1 hop); orgs = new ancestor scope type** | excellent | good |
| Verdict | insufficient (cannot express env/service/node scopes, no deny/conditions) | **choose** | over-built; revisit only if sharing graphs appear (they will not: hierarchy is a tree) | right tool for multi-tenant SaaS with arbitrary attribute logic; wrong weight class |

The decisive facts: the resource space is a **tree**, so Zanzibar's strength (arbitrary relation graphs) buys nothing; the attribute space is **tiny and known** (env kind, risk, assurance, time, IP, token kind), so a bespoke non-Turing guardrail layer is enough; and the one thing that is expensive to retrofit — **SQL push-down for list endpoints** (`SEC-034`) — is exactly what the existing engine already half-does and what Cedar/OPA/OpenFGA do worst.

### 3.2 The model in one paragraph

*A permission is `resource:action`. A role is a named bundle of permissions. A **grant** gives a subject (user, service account, group, service) a role or an explicit permission list at a **scope** (`platform`, `project:<id>`, `env:<id>`, `service:<id>`, `node:<id>`, `nodes[label…]`), optionally with an expiry and a condition; it is **allow** or **deny**. A grant at a scope applies to that scope and all its descendants. A decision is: authenticated -> token ceiling ∩ delegation chain -> deny grants (deny wins) -> at least one allow grant -> **guardrails** (deny / require step-up / require approval / quota) -> allow, or a typed challenge.*

### 3.3 Permission catalog and risk tiers

Single source of truth in code, replacing `platformBuilder` + `projectBuilder` statements and the web's `PLATFORM_RANK` table [code `permissions/config.ts`, `apps/web/src/lib/access/platform-role.rules.ts`].

```ts
// packages/auth/src/authz/catalog.ts
export type Risk = "low" | "medium" | "high" | "critical"
export const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 } as const

type ActionDef = { readonly risk: Risk; readonly description: string; readonly systemOnly?: true; readonly mutating: boolean }
type ResourceDef<A extends Record<string, ActionDef>> = {
  readonly parent: ResourceType | "platform"          // drives ancestry + inheritance
  readonly actions: A
}

export const catalog = defineCatalog({
  project: {
    parent: "platform",
    actions: {
      read:    a("low",      false, "View project"),
      create:  a("medium",   true,  "Create project"),
      update:  a("medium",   true,  "Edit settings"),
      delete:  a("critical", true,  "Delete project"),
      "member.read":   a("low",  false, "List members"),
      "member.manage": a("high", true,  "Invite/change/remove members"),
    },
  },
  environment: { parent: "project", actions: { read: a("low", false, "…"), create: …, update: …, delete: a("high", true, "…"),
                 "variable.read": a("medium", false, "Variable names + non-secret values"),
                 "variable.write": a("medium", true, "…") } },
  service: { parent: "project", actions: { read, create, update, delete: a("high",…), restart: a("medium",…) } },
  deployment: { parent: "service", actions: { read, create: a("medium", true, "Trigger deploy"), cancel, rollback: a("high",…), delete } },
  logs: { parent: "service", actions: { read: a("low",…), export: a("medium",…) } },
  container: { parent: "service", actions: { read, exec: a("critical", true, "Open a shell"), "file.read": a("high",…), "file.write": a("critical",…) } },
  secret: { parent: "service", actions: { list: a("low",…), write: a("high",…), reveal: a("critical", false, "Read a secret value") } },
  node: { parent: "platform", actions: { read, label: a("high",…), drain: a("high",…), revoke: a("critical",…), "join-token.reveal": a("critical", false, "…") } },
  domain: { parent: "project", actions: { read, attach: a("high",…), verify, detach: a("high",…) } },
  "dns.provider": { parent: "platform", actions: { read, write: a("critical",…) } },
  user: { parent: "platform", actions: { read, invite: a("high",…), update, ban: a("high",…), delete: a("critical",…) } },
  role: { parent: "platform", actions: { read, write: a("critical",…), assign: a("critical",…) } },
  token: { parent: "platform", actions: { "self.manage": a("medium",…), "any.read": a("high", false,…), "any.revoke": a("high",…), mint: a("high",…) } },
  audit: { parent: "platform", actions: { read: a("medium", false,…), export: a("high", false,…) } },
  approval: { parent: "platform", actions: { request: a("low",…), decide: a("high",…) } },
  elevation: { parent: "platform", actions: { request: a("low",…), approve: a("high",…) } },
  mesh: { parent: "platform", actions: { read, "roster.admit": a("critical",…), "roster.revoke": a("critical",…), "settings.write": a("critical",…) } },
  setup: { parent: "platform", actions: { initialize: a("critical", true, "…", /*systemOnly*/ ) } },
  system: { parent: "platform", actions: { view, configure: a("high",…), backup: a("high",…), maintenance: a("high",…) } },
  // … fleet/registry/edge/traefik/analytics/notification/webhook/template, ported 1:1 from today's statements
} as const)

export type Permission = {
  [R in keyof typeof catalog]: `${R & string}:${keyof (typeof catalog)[R]["actions"] & string}`
}[keyof typeof catalog]

export type PermissionPattern = Permission | `${keyof typeof catalog & string}:*` | "*"
```

Properties: (a) the catalog is typed, so `"deployment:creat"` is a compile error everywhere (contracts, roles, tests, web); (b) `risk` is **per action, defined once** and drives default guardrails, token ceilings and the UI badge; (c) `mutating` drives the shadow/403 test matrix and the agent read-only default; (d) `parent` drives ancestry resolution and the generated docs matrix.

### 3.4 Roles (named bundles)

| Layer | System roles (code-owned, immutable) | Notes |
|---|---|---|
| Platform | `superAdmin` (label "Owner", all permissions, **no bypass**), `admin`, `operator`, `viewer`, `member` (new baseline: self-service only, the default for new accounts; supersedes `DEC-AUTH-4` "default viewer") | Keys unchanged so the migration is mechanical. |
| Project | `owner`, `maintainer`, `deployer`, `viewer` | Same keys as `project_collaborators.role`. Environment-limited use = grant the project role at `env:<id>` scope. |
| Node | `node.operator` (label/drain/read on matching nodes) | Enables "Bob runs the edge nodes, not the whole fleet". |
| Custom | Any named bundle of catalog permissions with a scope kind (`platform` or `project`) | **Subset rule:** a creator can only include permissions they hold at that scope; `systemOnly` permissions can never be in a custom role; role count capped. |

System roles are defined in TS (`systemRoles.ts`), upserted into `authz_roles` on boot with a content hash (`version`) so a code change is a visible, audited migration — not a silent re-seed. Custom roles live only in the DB.

### 3.5 Grants, scopes, inheritance, ownership

```ts
type ScopeRef =
  | { type: "platform" }
  | { type: "project"; id: string }
  | { type: "environment"; id: string }        // environment ids are project-unique; kind attr (production/…) resolved
  | { type: "service"; id: string }
  | { type: "node"; id: string }
  | { type: "node_selector"; labels: Record<string, string> }   // e.g. {tier:"edge"}; resolved against node labels
// future, when needed: | { type: "org"; id: string } as a new ancestor of project
```

- **Inheritance** = the resource's *ancestry list* (e.g. `[platform, project:P, environment:E, service:S]`) is computed once per check by `ResourceResolver`; a grant matches if its scope is *in* the ancestry. Service-in-multiple-environments (`service_environments`, `environment_services` tables [code]) is handled by `environment` being an optional second axis: a grant at `environment:E` applies to a service resource only when the request carries that environment (deploys, env vars, logs-by-env). Requests without an environment context are *not* covered by environment-scoped grants (safe default).
- **Ownership** is a grant, not a special case: creating a project inserts `grant(user, role=project.owner, scope=project:<id>, source='ownership')`. The `projects.ownerId` shortcut in `ProjectAccessService.assertProjectAccess` [code] is deleted. Conditions may still reference `resource.ownerId == actor.id` (self-service rules, e.g. "users manage their own tokens").
- **Deny grants** (`effect='deny'`) are for narrowing, e.g. "contractor Carol: deny `secret:reveal` on `project:P`" or "freeze: deny `deployment:create` at `environment:prod` for role deployer". They win over allows, are shown prominently in the explainer, and cannot target the sole remaining platform owner (lock-out invariant, §9).
- **Expiry/not-before** on every grant (`expires_at`); elevations (§6.2) are just grants with `source='elevation'`.
- **Conditions on grants** use the existing `DFilter` DSL evaluated against `{actor, resource, env, request, now}` — non-Turing, already implemented and tested [code `filter-matcher.ts`]. Use sparingly; most conditions belong in guardrails.

### 3.6 Guardrails (Layer B)

Guardrails are *policies over decisions*, evaluated **after** a grant allows. They can only restrict: `deny`, `require` (step-up / approval / reason / elevation), or `limit` (quota).

```ts
// packages/auth/src/authz/policy.ts
export type Requirement =
  | { _tag: "StepUp"; maxAgeSec: number; minAal: Aal }
  | { _tag: "Approval"; count: number; approverRole: string; excludeRequester: true; ttlSec: number }
  | { _tag: "Reason" }
  | { _tag: "Elevation"; role: string }          // must hold an active elevation covering this permission
  | { _tag: "Cooldown"; sec: number }            // solo-mode degradation of Approval

export type Verdict =
  | { _tag: "Pass" }
  | { _tag: "Deny"; policyId: string; message: string }
  | { _tag: "Require"; policyId: string; requirements: ReadonlyArray<Requirement> }
  | { _tag: "Limit"; policyId: string; key: string; count: number; windowSec: number }

export interface PolicyCtx {
  readonly actor: Actor
  readonly permission: Permission
  readonly risk: Risk
  readonly resource: ResourceCtx            // ref + ancestry + attrs { envKind, ownerId, labels, nodeId, … }
  readonly now: Date
  readonly action: { readonly hash: string }  // sha256(canonicalJson(procedure, input, resourceRef)) – binds approvals
}

export interface Policy {
  readonly id: string
  readonly mode: "enforce" | "shadow"
  readonly evaluate: (c: PolicyCtx) => Verdict          // pure, synchronous, total; no IO (facts are pre-resolved)
}

export const Policy = {
  all: (...ps: Policy[]): Policy => …,
  when: (pred: (c: PolicyCtx) => boolean, then: Verdict | ((c: PolicyCtx) => Verdict)): Policy => …,
  fromRow: (row: AuthzPolicyRow): Policy => …,           // compiles data-driven JSON conditions (DFilter) to the same value
}

// Built-in defaults (seeded, can be tuned but not silently removed):
export const requireStepUpForCritical = Policy.when(
  (c) => c.risk === "critical" && c.actor.principal.kind === "user",
  { _tag: "Require", policyId: "builtin.stepup-critical",
    requirements: [{ _tag: "StepUp", maxAgeSec: 300, minAal: 3 }] },
)

export const prodDeployNeedsMaintainerOrApproval = Policy.when(
  (c) => c.permission === "deployment:create" && c.resource.attrs.envKind === "production"
      && !c.actor.heldRoles.includes("project.maintainer"),
  { _tag: "Require", policyId: "tpl.prod-deploy-approval",
    requirements: [{ _tag: "Approval", count: 1, approverRole: "project.maintainer", excludeRequester: true, ttlSec: 900 }] },
)

export const tokensNeverDoCritical = Policy.when(
  (c) => c.actor.credential.kind !== "session" && c.risk === "critical" && !c.actor.hasApproval,
  { _tag: "Deny", policyId: "builtin.token-no-critical",
    message: "Critical actions need an interactive, step-up-verified session or an approved request" },
)

export const adminsFromAllowedNetworks = Policy.when(
  (c) => c.actor.holdsAny(["platform.admin", "platform.superAdmin"]) && !c.actor.ipIn(c.settings.adminCidrs),
  { _tag: "Deny", policyId: "tpl.admin-ip", message: "Admin actions are restricted to configured networks" },
)
```

Combination law (deterministic, order-independent): `Deny` > `Require` (requirements unioned, strictest wins per kind) > `Limit` > `Pass`. A policy in `shadow` mode computes its verdict and logs the would-be effect but does not alter the decision (this is how new guardrails are rolled out). Presets: `solo` (step-up for critical, no approvals, cooldown instead), `team` (adds prod approvals), `strict` (two-person for critical, no standing owner).

### 3.7 Token scopes are strict subsets (no escalation)

Two checks, both mandatory:

1. **At mint:** every `(permission pattern, scope)` requested must be covered by the minter's *own* effective grants at that scope (`Grants.assertGrantable(actor, request)`); `token:mint` is never usable by a token credential (a token cannot mint tokens), only by a session with AAL>=2 + step-up for scopes containing a `mutating` permission, `risk >= high`, or any `kind: agent` token with mutations.
2. **At use:** effective = `owner grants ∩ token ceiling`, evaluated live. If the owner loses a grant, the token loses it the same second; if the owner is banned/disabled, tokens fail authentication.

### 3.8 Explain and simulate

```ts
Authz.explain(req: { subject: SubjectRef | "me"; permission: Permission; resource: ResourceRef; hypothetical?: Partial<ActorFacts> }): Effect<Explanation>
// Explanation = {
//   decision: "allow"|"deny"|"challenge", ancestry: ScopeRef[],
//   ceiling: {matched: boolean, via?: string},
//   grants: Array<{ id, role, scope, effect, matched: boolean, whyNot?: "scope"|"expired"|"condition"|"permission" }>,
//   delegation: Array<{ hop: Principal, allowed: boolean }>,
//   policies: Array<{ id, mode, verdict }>, requirements: Requirement[], policyVersion: string }

Authz.simulate(change: { addGrants?: GrantDraft[]; removeGrants?: string[]; policyChanges?: PolicyDraft[]; replay: { since: Date; limit: number } }):
  Effect<{ newlyDenied: DecisionDiff[]; newlyAllowed: DecisionDiff[]; unchanged: number }>
```
`explain` is the same pure `evaluate` function run with `trace: true`; `simulate` replays the last N logged decisions (decision log, §5.8) through the changed rule set. Self-explain is always allowed; explaining others needs `audit:read` or `role:read`. Both back the "Access explorer" UI and the shadow-mode disagreement report.

---

## 4. Data model

### 4.1 What stays Better Auth's job, what becomes ours

| Concern | Owner | Notes |
|---|---|---|
| Sign-in (email+password, passkey, TOTP, backup codes, social/OIDC later), sessions, cookies, multi-session, device authorization, password reset, email verification | **Better Auth** | Fix config per `AUTH-001/012/017/018`. |
| API-key *storage*: hashing, lookup, expiry, rate limit/refill, `permissions` JSON, `metadata` | **Better Auth `apikey` plugin** | `permissions` (record `resource -> actions[]`) is exactly our `resource:action` shape [doc]; used as the token's declared ceiling. |
| User lifecycle primitives: create/ban/remove/set-password/impersonate endpoints | **Better Auth `admin` plugin, but fronted** | Public BA admin endpoints are restricted by a `before` hook that delegates the decision to `Authz.require(...)`; `set-role` is removed from the surface and replaced by our `Grants.assign` (closes `AUTH-006`). |
| Roles, grants, scopes, custom roles, deny, conditions | **Ours** (`authz_*`) | BA's `ac`/roles are generated from the catalog for the coarse admin plugin only. |
| Guardrails, approvals, elevations, step-up evidence, quotas | **Ours** | |
| Token constraints beyond `permissions` (IP allowlist, risk ceiling, scopes, kind, readOnly, rotation lineage) | **Ours**, side table keyed by `apikey.id` | BA `metadata` is an untyped text blob and not indexable. |
| Invitations | **Ours** (`DEC-AUTH-2`: own table; BA org invitation rejected because the invite must carry a grant template and be capped by the inviter's own grants) | Replaces `platform_invite` plugin logic. |
| Decision/audit log | **Ours** (`OBS-071` owns the table; this design fixes the event shape) | |
| `user.role` column | **Projection**: set only by `Grants.assign`/`revoke` in the same transaction, `input: false`, so BA's admin plugin and any old reader still see a coarse platform role | `auth.ts:135` has `input: true` today [code]; this is the one-line AUTH-001 fix and is not negotiable. |
| Better Auth `organization` plugin | **Not used** | [doc] per-org roles, no per-project role assignment; we would still need our own project membership tables. |

### 4.2 Tables (Drizzle sketches; `packages/nest/schema/src/global/identity/authz.ts`)

```ts
export const authzRoles = pgTable("authz_roles", {
  id: text("id").primaryKey(),                       // "platform.admin", "project.maintainer", "custom_01H…"
  kind: text("kind", { enum: ["system", "custom"] }).notNull(),
  scopeKind: text("scope_kind", { enum: ["platform", "project", "node"] }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  permissions: text("permissions").array().notNull(),          // PermissionPattern[]; validated against catalog on write
  contentHash: text("content_hash").notNull(),                  // system roles: hash of code definition
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().$onUpdate(() => new Date()),
})

export const authzGrants = pgTable("authz_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  subjectType: text("subject_type", { enum: ["user", "group", "service"] }).notNull(),   // service accounts are users
  subjectId: text("subject_id").notNull(),
  roleId: text("role_id").references(() => authzRoles.id),        // XOR with permissions
  permissions: text("permissions").array(),                        // ad-hoc grant (rare)
  effect: text("effect", { enum: ["allow", "deny"] }).notNull().default("allow"),
  scopeType: text("scope_type", { enum: ["platform", "project", "environment", "service", "node", "node_selector"] }).notNull(),
  scopeId: text("scope_id"),                                       // null for platform; JSON labels hash for node_selector
  scopeSelector: jsonb("scope_selector"),
  condition: jsonb("condition").$type<DFilter>(),                  // optional, non-Turing
  source: text("source", { enum: ["seed", "manual", "invite", "ownership", "elevation", "scim", "migration"] }).notNull(),
  reason: text("reason"),
  notBefore: timestamp("not_before"),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  grantedBy: text("granted_by").notNull(),                         // principal ref, or "system:migration"
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("authz_grants_subject_idx").on(t.subjectType, t.subjectId).where(sql`revoked_at IS NULL`),
  index("authz_grants_scope_idx").on(t.scopeType, t.scopeId).where(sql`revoked_at IS NULL`),
  check("role_xor_perms", sql`(role_id IS NULL) <> (permissions IS NULL)`),
])

export const authzGroups = pgTable("authz_groups", { id, name, description, createdAt })            // Phase 6
export const authzGroupMembers = pgTable("authz_group_members", { groupId, userId, addedBy, addedAt })

export const authzPolicies = pgTable("authz_policies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mode: text("mode", { enum: ["enforce", "shadow", "off"] }).notNull().default("shadow"),
  effect: text("effect", { enum: ["deny", "require", "limit"] }).notNull(),
  priority: integer("priority").notNull().default(0),
  match: jsonb("match").$type<{ permissions: PermissionPattern[]; scopes?: ScopeRef[]; minRisk?: Risk }>().notNull(),
  condition: jsonb("condition").$type<DFilter>(),                  // over {actor, resource, env, request, now}
  requirements: jsonb("requirements").$type<Requirement[]>(),
  limit: jsonb("limit").$type<{ key: "actor" | "token" | "project" | "ip"; count: number; windowSec: number }>(),
  message: text("message"),
  builtin: boolean("builtin").notNull().default(false),            // builtin: can be tuned, not deleted
  updatedBy: text("updated_by"), updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const tokenConstraints = pgTable("token_constraints", {
  apikeyId: text("apikey_id").primaryKey().references(() => apikey.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["pat", "ci", "agent", "deploy_hook", "cli"] }).notNull(),
  scopes: jsonb("scopes").$type<ScopeRef[]>(),                      // resource restriction (null = all the owner can reach)
  maxRisk: text("max_risk").notNull().default("medium"),
  readOnly: boolean("read_only").notNull().default(false),
  ipAllow: cidr("ip_allow").array(),
  rotatedFromId: text("rotated_from_id"),                           // overlap rotation lineage
  lastUsedIp: inet("last_used_ip"), lastUsedAt: timestamp("last_used_at"),
  createdVia: text("created_via"),                                  // "web:session:<id>" | "cli:device:<id>"
})

export const accessRequests = pgTable("access_requests", {          // approvals AND elevations
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind", { enum: ["approval", "elevation"] }).notNull(),
  requesterId: text("requester_id").notNull(),                      // principal ref (user id, or agent token's owner + tokenId in `via`)
  via: text("via"),                                                 // credential id when requested by a token/agent
  permission: text("permission"),                                   // approval: exact permission; elevation: null
  roleId: text("role_id"),                                          // elevation: role to grant
  scope: jsonb("scope").$type<ScopeRef>().notNull(),
  actionHash: text("action_hash"),                                  // approval: sha256 of the exact action; single-use binding
  reason: text("reason").notNull(),
  requiredApprovals: integer("required_approvals").notNull().default(1),
  status: text("status", { enum: ["pending", "approved", "denied", "expired", "consumed", "cancelled"] }).notNull(),
  ttlSec: integer("ttl_sec").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  grantId: uuid("grant_id"),                                        // elevation: the materialised grant
  createdAt: timestamp("created_at").notNull().defaultNow(),
})
export const accessRequestVotes = pgTable("access_request_votes", {
  requestId: uuid("request_id").notNull().references(() => accessRequests.id, { onDelete: "cascade" }),
  approverId: text("approver_id").notNull(),
  decision: text("decision", { enum: ["approve", "deny"] }).notNull(),
  assertionHash: text("assertion_hash"),                            // passkey assertion over the request id (non-repudiation, I-18)
  at: timestamp("at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.requestId, t.approverId] })])

export const stepUpEvents = pgTable("step_up_events", {             // evidence for the StepUp requirement
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id").notNull(),
  method: text("method", { enum: ["passkey", "totp", "password"] }).notNull(),
  aal: smallint("aal").notNull(),
  assertionHash: text("assertion_hash"),
  at: timestamp("at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
})

export const authzEpoch = pgTable("authz_epoch", {                  // cache invalidation, §5.7
  subjectKey: text("subject_key").primaryKey(),                     // "user:<id>" | "role:<id>" | "global"
  epoch: bigint("epoch", { mode: "number" }).notNull().default(0),
})

export const invitations = pgTable("invitations", {                  // replaces platform_invite
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),                 // token shown once, hashed at rest
  grantTemplate: jsonb("grant_template").$type<GrantDraft[]>().notNull(),
  invitedBy: text("invited_by").notNull(), expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"), revokedAt: timestamp("revoked_at"),
})

// Service accounts are user rows: add `kind` ('human'|'service_account'), `owner_id`, `disabled_at` to `user`.
// Decision/audit: `audit_events` is OBS-071's table; authz adds columns/fields described in §5.8.
```

### 4.3 Fate of existing artifacts

| Existing | Action |
|---|---|
| `role_rules` table + `ResourceRule` JSONB per role [code `identity/permissions.ts`] | **Drop.** No consumer reads it and it is empty/unseeded; its job (per-role scoped rules) is covered by `authz_roles` + `authz_grants`. Add a migration that drops it in the same change set (v3 rule: no compat layers). |
| `PermissionEngine.check/assert/buildWhereClause` | **Rewrite the shell, keep the parts.** Keep `filter-matcher`, `filter-compiler`, `resource-graph`, `rule-validator` (adapt to grants). Delete the `superAdmin` bypass, the `loadRoleRules(...).catch(() => [])` fail-open/closed ambiguity [code `permission.service.ts`], the "empty rules = DENY" accident, and the `cascade` stub ("conservatively allows all rows" [code `permission-engine.ts` Phase B notes] — a latent over-grant). Core becomes a **pure** `evaluate(facts) -> Decision` + SQL `accessFilter(...)`; the Effect `Authz` service is the shell. |
| `PermissionBuilder` plugin system + compiled `.js`/`.js.map` artifacts under `src/permissions/system/builder` [code] | Replace by the catalog; delete the build artifacts checked into `src`. Generate BA `ac`/roles from the catalog for the coarse admin plugin. |
| `project_collaborators` (role enum + dead `permissions` jsonb: `canDeploy`...) | Data-migrate rows into `authz_grants` (`source='migration'`, role = collaborator role, scope = project); then drop the table and the dead flags. `invitedBy/acceptedAt` move to `invitations`. |
| `projects.ownerId` shortcut | Keep column as display/ownership attribute; authorization reads the ownership *grant*. |
| `api_keys` legacy table + `ApiKeyService` | Delete (`AUTH-020`). |
| `platform_invite` + `invite.ts` plugin | Replace by `invitations` + our service; delete plugin (`AUTH-002/009`). |
| `masterTokenAuth`, `loginAs` plugins, `DEV_AUTH_KEY` | **Delete, not gate.** Replaced by device-code login, service-account tokens and the host recovery CLI. A gate can be misconfigured; a deleted plugin cannot. (`AUTH-003/004`.) |
| `agentAuth.ts` (unregistered) | Delete until the spec stabilises (`DEC-AUTH-6`); agent tokens replace it. |
| `apps/web` `platform-role.rules.ts` rank table, `RequirePermission` over `platformRolesConfig` | Re-point to the capability endpoint (§5.9); delete the rank table. |

---

## 5. Effect implementation design

### 5.1 Layers and services

```
                    ┌────────────────────────── per request (effect/wrap) ──────────────────────────┐
 headers ──► Authn.authenticate ──► CurrentActor (+ CorrelationId, Logger annotations)
                │                                         │
   SessionVerifier  ApiTokenVerifier  ActorClaimVerifier  │   ┌── Authz.require / check / filter / explain ──┐
   ServiceTokenVerifier  MeshVerifier  WebhookVerifier    └──►│  PermissionResolver (cache)  ResourceResolver │
   SetupClaimVerifier                                         │  PolicyStore  ApprovalStore  StepUpStore      │
                                                              │  QuotaStore   DecisionLog ──► AuditLog        │
                                                              └───────────────────────────────────────────────┘
```

| Service (tag) | Responsibility | Live layer deps |
|---|---|---|
| `Authn` | try each verifier whose `matches(headers)` is `Some`; enforce exactly-one-credential; produce `Actor` | verifiers |
| `AuthnVerifier<K>` (one layer per credential kind) | `matches(req) -> Option<Raw>`, `verify(raw) -> Effect<Actor, Unauthenticated \| AuthnUnavailable>` | BetterAuth handle, `TokenConstraintsRepo`, roster reader, `Clock` |
| `PermissionResolver` | `grantsFor(subjects, ancestry) -> ResolvedGrants`; expands roles; applies cache + epoch | `AuthzRepo`, `Cache` |
| `ResourceResolver` | `resolve(ref) -> ResourceCtx { ref, ancestry, attrs }` in one query via `RESOURCE_GRAPH`; per-request memo | `Database` |
| `PolicyStore` | active `Policy[]` (builtin + rows), versioned; `policyVersion` hash | `AuthzRepo` |
| `ApprovalStore` / `StepUpStore` | find/consume approvals (atomic `UPDATE … WHERE status='approved' AND action_hash=$h RETURNING`), read latest step-up for session | `Database` |
| `QuotaStore` | `hit(key, windowSec) -> count` (Redis per `DEC-SEC-4`; Postgres unlogged-table fallback) | Redis/DB |
| `Authz` | the API of §5.3 | all of the above |
| `DecisionLog` | writes one event per decision to `AuditLog` (`OBS-071`), never fails the request (bounded queue, drop-counter metric), denies always logged | `AuditLog` |

All services are `Context.Service` tags with Live layers, so they work in Nest via the existing `useExisting` alias pattern and in unit tests via `Layer.succeed` / in-memory repos [audit effect-architecture §2].

### 5.2 Pure decision core

```ts
// packages/auth/src/authz/evaluate.ts — no Effect, no IO: property-testable and reusable by the web "simulate" preview
export interface Facts {
  actor: Actor
  permission: Permission
  resource: ResourceCtx
  grants: ReadonlyArray<ResolvedGrant>                 // already filtered to subjects + non-expired; may include deny
  delegationGrants: ReadonlyArray<ReadonlyArray<ResolvedGrant>>   // one set per onBehalfOf hop
  policies: ReadonlyArray<Policy>
  approvals: ReadonlyArray<ApprovalFact>               // consumable approvals matching actionHash
  stepUp?: StepUpFact
  now: Date
  action: { hash: string }
}

export type Decision =
  | { effect: "allow"; matched: GrantId[]; consumed?: ApprovalId[]; trace?: Trace }
  | { effect: "deny"; reason: DenyReason; matched: GrantId[]; trace?: Trace }
  | { effect: "challenge"; requirements: Requirement[]; policyIds: string[]; trace?: Trace }

export const evaluate = (f: Facts): Decision => {
  // 1. credential ceiling and delegation chain: permission must be inside every ceiling
  // 2. any matching deny grant -> deny("explicit-deny")
  // 3. need >=1 matching allow grant (scope ∈ ancestry, permission matches, condition true) else deny("no-grant")
  // 4. each hop in onBehalfOf must independently pass 2-3 (intersection)
  // 5. guardrails: fold verdicts (Deny > Require > Limit > Pass); unmet requirements -> challenge
  // 6. allow
}
```

### 5.3 The `Authz` service

```ts
export class Forbidden extends Data.TaggedError("Forbidden")<{ permission: Permission; resource?: ResourceRef; reason: DenyReason; requestId: string }> {}
export class NotFoundConcealed extends Data.TaggedError("NotFoundConcealed")<{ resource: ResourceRef }> {}   // actor lacks :read -> pretend it does not exist
export class Unauthenticated extends Data.TaggedError("Unauthenticated")<{ reason: "missing" | "expired" | "revoked" | "ambiguous" | "banned" }> {}
export class StepUpRequired extends Data.TaggedError("StepUpRequired")<{ maxAgeSec: number; minAal: Aal; methods: ReadonlyArray<"passkey" | "totp"> }> {}
export class ApprovalRequired extends Data.TaggedError("ApprovalRequired")<{ requestId: string; count: number; approverRole: string; expiresAt: number }> {}
export class QuotaExceeded extends Data.TaggedError("QuotaExceeded")<{ key: string; retryAfterSec: number }> {}
export class AuthzUnavailable extends Data.TaggedError("AuthzUnavailable")<{ cause: unknown }> {}   // fail CLOSED, 503

/** Unforgeable proof that a check passed; constructor is private to the Authz layer. */
declare const authorizedBrand: unique symbol
export interface Authorized<P extends Permission, R extends ResourceRef = ResourceRef> {
  readonly [authorizedBrand]: P
  readonly permission: P
  readonly resource: R
  readonly decisionId: string
}

export type AccessFilter =
  | { readonly kind: "all" }
  | { readonly kind: "none" }
  | { readonly kind: "sql"; readonly where: SQL }                     // push into the repository query

export class Authz extends Context.Service<Authz, {
  /** Decide only; never fails on deny. Used by the gate in shadow mode and by explain. */
  readonly check: (req: AuthzRequest) => Effect.Effect<Decision, AuthzUnavailable, CurrentActor>
  /** Decide and fail with a typed error. Returns the witness on success. */
  readonly require: <P extends Permission>(
    permission: P, resource: ResourceSelector,
  ) => Effect.Effect<Authorized<P>, Unauthenticated | Forbidden | NotFoundConcealed | StepUpRequired | ApprovalRequired | QuotaExceeded | AuthzUnavailable, CurrentActor>
  /** SQL predicate for list/count/stream queries. Deny grants become NOT predicates; cascade is real (FK-chain subquery). */
  readonly filter: (permission: Permission, type: ResourceType, ctx: { idColumn: SQL; resolver: ColumnResolver<any> })
    => Effect.Effect<AccessFilter, AuthzUnavailable, CurrentActor>
  readonly capabilities: (scope?: ScopeRef) => Effect.Effect<CapabilitySet, AuthzUnavailable, CurrentActor>
  readonly explain: (req: ExplainRequest) => Effect.Effect<Explanation, AuthzUnavailable | Forbidden, CurrentActor>
  readonly simulate: (change: SimulateRequest) => Effect.Effect<SimulationResult, AuthzUnavailable | Forbidden, CurrentActor>
}>()("auth/Authz") {}
```

Implementation sketch of `require`:

```ts
const require_ = <P extends Permission>(permission: P, sel: ResourceSelector) =>
  Effect.gen(function* () {
    const actor = yield* CurrentActor
    const meta = catalogLookup(permission)
    const resource = yield* resources.resolve(sel)                           // ancestry + attrs
    const grants = yield* resolver.grantsFor(Actor.subjects(actor), resource.ancestry, { fresh: meta.risk >= "high" })
    const hops   = yield* Effect.forEach(actor.onBehalfOf, (h) => resolver.grantsFor([h.principal], resource.ancestry))
    const policies = yield* policyStore.active
    const action = { hash: hashAction(permission, resource.ref, yield* currentInputDigest) }
    const approvals = yield* approvalStore.matching(actor, permission, action.hash)
    const stepUp = yield* stepUpStore.latest(actor)
    const decision = evaluate({ actor, permission, resource, grants, delegationGrants: hops, policies, approvals, stepUp, now: yield* Clock.currentTimeMillis.pipe(Effect.map((t) => new Date(t))), action })
    yield* decisionLog.record({ actor, permission, resource: resource.ref, decision, policyVersion: yield* policyStore.version })
    switch (decision.effect) {
      case "allow":
        if (decision.consumed) yield* approvalStore.consume(decision.consumed, action.hash)   // atomic, single-use
        return makeWitness(permission, resource.ref, decisionId)
      case "deny":
        return yield* decision.reason === "no-grant" && !(yield* canRead(actor, resource))
          ? Effect.fail(new NotFoundConcealed({ resource: resource.ref }))
          : Effect.fail(new Forbidden({ permission, resource: resource.ref, reason: decision.reason, requestId: actor.origin.requestId }))
      case "challenge":
        return yield* challengeToError(decision, actor, permission, resource, action)            // StepUpRequired | ApprovalRequired (creates access_request)
    }
  }).pipe(Effect.catchTag("DbError", (e) => Effect.fail(new AuthzUnavailable({ cause: e }))))   // fail closed
```

Error mapping (done once, in `effect/wrap`, not per controller):

| Tagged error | oRPC code / HTTP | Body `data` |
|---|---|---|
| `Unauthenticated` | `UNAUTHORIZED` / 401 | `{ reason }` |
| `Forbidden` | `FORBIDDEN` / 403 | `{ permission, reason, requestId }` (no grant details) |
| `NotFoundConcealed` | `NOT_FOUND` / 404 | none |
| `StepUpRequired` | `STEP_UP_REQUIRED` / 401 + `insufficient_user_authentication` semantics (RFC 9470 [mem]) | `{ maxAgeSec, minAal, methods }` |
| `ApprovalRequired` | `APPROVAL_REQUIRED` / 403 | `{ requestId, count, approverRole, expiresAt }` |
| `QuotaExceeded` | `TOO_MANY_REQUESTS` / 429 | `{ retryAfterSec }` |
| `AuthzUnavailable` | `SERVICE_UNAVAILABLE` / 503 | none; defect logged with cause (not swallowed) |

`STEP_UP_REQUIRED` and `APPROVAL_REQUIRED` are added to `STANDARD_DOMAIN_ERROR_DEFS` so every contract carries them without per-contract declarations.

### 5.4 Contract annotation and the default-deny gate

Annotation lives on the contract (the single source the web, CLI manifest, MCP tools and the 403 matrix all read — `FEAT-084`):

```ts
// packages/contracts/identity/modules/user/…  /  contracts/project/modules/service/update.ts
import { standard, access, byInput, byParent, platform } from "@repo/orpc-utils"

export const serviceUpdateContract = serviceOps
  .update()
  .access({
    permission: "service:update",
    resource: byInput("serviceId", "service"),          // resolved to ancestry server-side
    // risk defaults to catalog(service:update).risk; override only to RAISE it
    audit: "diff",                                       // none | event | diff (field-level redacted, OBS-072)
    cli: { name: "service update" },                    // feeds FEAT-084 manifest
  })
  .build()

export const serviceListContract = serviceOps
  .list(serviceListConfig)
  .access({ permission: "service:read", list: { type: "service", parent: byInput("projectId", "project", { optional: true }) } })
  .build()

export const healthLivenessContract = healthOps.check().access(access.public({ reason: "orchestrator liveness probe" })).build()
export const clusterInfoContract    = fleetOps.info().access({ permission: "node:read", resource: platform() }).build()
export const signInIntrospect       = … .access(access.self())          // actor's own resource only; no catalog permission
```

Gate (runs inside the same Effect runtime as handlers; it is the only code that calls `Authz.require` for the *procedure-level* check):

```ts
// packages/nest/effect/src/authz-gate.ts
export const authzGate = os
  .$context<{ effect: EffectContext }>()
  .middleware(async ({ context, procedure, next, path }, input) => {
    const meta = procedure["~orpc"].meta as AccessMeta | undefined            // [mem] verify the exact accessor in Template v1
    if (meta === undefined) throw misconfigured(path)                          // default deny: 500 + loud log; CI should have caught it first
    if (meta.kind === "public") return next({ context })                       // allowlisted, reasoned, snapshot-tested
    const run = context.effect.runPromiseExit(
      Effect.gen(function* () {
        const authz = yield* Authz
        const mode = yield* AuthzMode.forProcedure(path)                       // "shadow" | "enforce", per area, from settings (not env)
        if (meta.kind === "self") return yield* assertSelf(input)
        const witness = meta.list
          ? undefined                                                          // lists are filtered in the repository via Authz.filter
          : yield* mode === "enforce"
              ? authz.require(meta.permission, meta.resource(input))
              : authz.check(...).pipe(Effect.tap(logShadowDisagreement(path, legacyDecisionOf(path))), Effect.as(shadowWitness))
        return witness
      }),
    )
    const witness = await unwrapOrThrow(run)                                   // typed errors -> ORPCError via the central mapper
    return next({ context: { ...context, authorized: witness } })
  })
```

Applied once by the host (`createOrpcModule`) as a global middleware so a controller cannot forget it; `requireAuth()` is retired as an authorization mechanism (it remains the authentication step inside `Authn`). **Input access**: the resource selector needs parsed input; oRPC supports mapping input into a middleware [mem] — the Template-v1 spike must confirm gate-after-validation ordering for `implement()`-style contracts, and note `callProcedure` in `packages/transport/orpc/src/testing` bypasses middleware and validation [audit effect-architecture §6], so authorization tests must use `@orpc/server`'s `call()` or a real HTTP harness.

### 5.5 Service layer: proof-carrying mutations

```ts
// Service methods that mutate take the witness: you cannot call them without having passed the gate.
update: (
  auth: Authorized<"service:update">,            // brand constructor is private to Authz
  patch: ServicePatch,
) => Effect.Effect<Service, ServiceNotFound | ServiceConflict, ServiceRepository | AuditLog>
```
Controller: `({ context, input }) => svc.update(context.authorized as Authorized<"service:update">, input.patch)`; the generic gate stores the witness under a typed key so the cast disappears behind a helper `authorizedFor("service:update")`. Rules of thumb: required for every `mutating: true` permission with `risk >= high` first, extended to all mutations by the end of Phase 3; **internal callers (jobs, other services) obtain a witness through `Authz.require` with their own Actor** — the witness proves *a check happened for this actor*, not that HTTP was involved. This is defence in depth for the "someone adds a second entry point and forgets the gate" failure class (webhooks, SSE, supervisors).

### 5.6 Service-to-service and deputy calls

1. BFF receives user request -> `Authn` -> Actor. For fan-out calls `ServiceClientRegistry` signs an **actor claim** for each downstream service (`aud`), claims: `{ sub: principalRef, cred: {kind,id}, aal, authTime, stepUpAt, ceiling (compact), obo, ip, via, req, jti, exp }`. **Permissions are not in the claim**; the service resolves grants itself from the shared DB (instant revocation, small claim). This replaces cookie/ALS forwarding (`SEC-030`, `EFF-016`, `DEC-SEC-3` -> "claim for user-originated calls, service token for background calls: both").
2. Signer key: BFF holds an Ed25519 key; its public half is admitted in the roster as a member `kind: service` with capability `sign-actor`; services verify against the roster-admitted keys (mesh-first, no shared secret; rotation = roster admission). Interim before roster anchoring: Docker-secret keypair, same code path.
3. **Service principals** have their own grants (`subjectType='service'`), e.g. `svc-project`: `dns.record:write` on platform; `svc-runtime`: `container:*`, `node:read`. Least privilege replaces anonymous calls (`SEC-031`).
4. **Deputy rule (confused-deputy protection):** an *internal* procedure declares `audience: "internal"` and `callers: [{ service: "svc-project", onBehalfOf: "domain:attach" }]`. The callee requires (a) the calling service holds the permission, **and** (b) the carried original actor holds `onBehalfOf` for the same resource. A service can therefore not be tricked into doing for user A what A could not do directly, and internal procedures are never reachable from the BFF's public surface (generated delegation excludes `audience: internal`).
5. **Background jobs** run with `Actor.system(job)` provided via `Effect.provideService(CurrentActor, …)` (`ARCH-056`); system actors have small fixed grants and show as `system:scheduler` in audit.

### 5.7 PermissionResolver: cache and invalidation

- Per-request memo (`Effect.cached`) of `grantsFor`.
- Process cache keyed by `(subject, ancestryHash)`; entry carries `epoch`. Validity: `entry.epoch === currentEpoch(subject) && age < 30 s`. `currentEpoch` is one cheap query on `authz_epoch` batched per request, or in-memory updated by `LISTEN authz_changed` (Postgres NOTIFY from every write path; the TTL is the backstop if the listener drops).
- Writes (`Grants.assign/revoke`, role edit, group change, policy change, ban) bump the relevant `authz_epoch` row(s) **in the same transaction** and `NOTIFY` after commit.
- `risk >= high` permissions bypass the cache (`fresh: true`): demotion is instant for exactly the actions that matter.
- **Fail closed:** any loader/DB error becomes `AuthzUnavailable` (503). The existing `catch(() => [])` [code `permission.service.ts`] is deleted. A boot invariant check asserts that at least one active human holds `platform.superAdmin` and the system roles exist; otherwise the service refuses to report ready (health indicator, `OBS` probe) instead of denying everyone silently.
- Streams (SSE logs, deployment streams): authorize on subscribe, then re-validate on each `authz_changed` for the subject (or every 60 s) and close the stream on loss of access (`SEC-010`).

### 5.8 Decision log -> AuditLog

One event per decision, fields: `ts, requestId, actor{principal, credential.kind/id, aal, via, ip, nodeId, onBehalfOf[]}, permission, risk, resource{type,id,projectId}, decision{effect, reason, matchedGrantIds, policyIds, requirements}, policyVersion, shadow{effect?} , approvalId?, inputDigest`. Volume policy: **always** log denies, challenges, every `mutating` allow, every `risk>=high` allow; **sample** low-risk reads (1% + always for `audit:read`, `secret:list`); writes go through a bounded async queue, hash-chained per `OBS-071`/I-03 so deletion is detectable; field-level diffs for mutations come from `OBS-072`. The log is also the replay corpus for `simulate` (retain >= 30 days of decision summaries even when full events rotate). Coverage guard: the `OBS-085` test (every mutating procedure writes exactly one audit row) is satisfied by the gate, not per controller.

### 5.9 Web: capabilities and `useCan`

```ts
// contract: authz.capabilities  (access.self())
type CapabilitySet = {
  actor: { id: string; kind: PrincipalKind; aal: Aal; stepUpValidUntil?: number; epoch: number }
  platform: Permission[]                                    // expanded, after deny/ceiling
  projects: Record<ProjectId, { permissions: Permission[]; environments?: Record<EnvId, Permission[]> }>   // only projects the actor can read
  challenges: Partial<Record<Permission, Requirement[]>>    // which allowed actions will need step-up/approval (from guardrails at default scope)
  generatedAt: number
}
// web
const can = useCan()                                        // reads one TanStack Query ["authz","capabilities"], invalidated on 403/STEP_UP_REQUIRED and epoch change via the stream
can("deployment:create", { project: id, environment: envId })      // boolean
const { allowed, reason, requirement } = useCanExplain("secret:reveal", { service: id })   // reason string for disabled buttons
<Can permission="project:delete" project={id} fallback={<DisabledWithTooltip/>}>…</Can>
```
Server stays the boundary. `RequirePermission` / `RequireOrganizationRole` / `RequirePlatformRole` components are replaced by `<Can>` over the same hook; no `PLATFORM_RANK` table on the client. A 401 `STEP_UP_REQUIRED` triggers a global passkey prompt dialog, then retries the failed mutation once; `APPROVAL_REQUIRED` opens the "Request approval" sheet and shows the pending request in the inbox. Server-provided capabilities also drive the generated CLI/MCP manifests (§6.11).

### 5.10 Generated artefacts and CI gates

From the contract metadata, one script generates: (1) the **permission matrix doc page** (`apps/doc/.../authz-matrix.mdx`: procedure × system role -> allow/deny/challenge, computed by the pure `evaluate` against role definitions), (2) the **403 test matrix** (`SEC-038`: every `mutating` procedure x {anonymous, member, viewer, non-member project owner} -> expected denial; plus allow for the lowest role that should pass), (3) the **CLI/MCP manifest** (`FEAT-084`), (4) a **snapshot of the `public` allowlist** (any change needs review). CI fails when a procedure lacks `access` metadata, when `permission` is not in the catalog, or when a `mutating` permission is attached to a procedure whose HTTP verb/name is read-like. The oracle for the generated tests is the role-definition table, **independent of `evaluate`**, so a bug in the engine cannot hide itself.

---

## 6. Granular controls worth having

Ordered by value per effort for a one-to-few-operator platform. Each is a *policy or credential property on the same model*, not a new subsystem.

### 6.1 Approvals / two-person rule (`I-06`, `I-18`)
- Policy `Require Approval{count, approverRole, excludeRequester, ttl}` on e.g. `deployment:create` at `env.kind=production`, `container:exec` in prod, `secret:reveal`, `node:revoke`, `project:delete`.
- Flow: gate returns `ApprovalRequired{requestId}` and creates `access_requests(kind='approval', actionHash)`; approvers (hold `approval:decide` for that scope; never the requester) approve in the UI with a passkey assertion (`assertionHash` stored); requester retries (the web client does it automatically); `evaluate` finds an approval whose `actionHash` equals this action's hash and **consumes it atomically** (single use, TTL 15 min). Because the hash binds procedure + resource + input digest, an approval for "deploy v1.2 to prod" cannot be reused for "deploy v9 to prod".
- **Solo mode** (single human): requirement degrades to `StepUp(passkey) + Reason + Cooldown(60 s)` — still recorded and still a speed bump, without needing a second person. Preset auto-switches to `team` when >= 2 active humans hold approver-capable roles (operator is asked, not forced).

### 6.2 Break-glass / just-in-time elevation (`I-06`)
- Standing powerful roles are minimised: members hold `deployer`/`operator`; `elevation:request` asks for a role at a scope for <= `maxTtl(role)` (default 30 min, owner role max 15 min) with a mandatory reason; approval per policy (solo: step-up + cooldown); materialises as a grant `source='elevation'`, `expires_at` enforced by the same query (no cron needed for correctness, a sweeper only cleans up).
- Recorded: request, approvers, grant id, every decision made under it (`actor.elevations` carried in the Actor and in every audit row); notification to all owners (web push exists); auto-revoke on expiry; `exec` sessions under elevation are recorded by the executing node (`I-06`).
- Emergency path when no approver is reachable: owner self-elevation with step-up + reason + **loud notification**; strict preset disables it.

### 6.3 Step-up authentication
- Built-in guardrail: `risk=critical` requires AAL3 within 5 min (`requireStepUpForCritical`); optional per-policy for lower risks. `Require StepUp` is satisfied by a row in `step_up_events` for the *current session* with `expiresAt > now`.
- Evidence capture: our endpoint `POST /authz/step-up` wraps BA passkey `verify-authentication` (via an `after` hook [mem], or by calling BA's verify API server-side) and writes `step_up_events` with the assertion hash; TOTP is accepted for AAL2-only requirements. We do **not** rely on BA `session.freshAge` for this (it measures session creation, not a re-assertion); `freshAge` is set (5-10 min) for BA's own sensitive endpoints (password/email change) [mem]. Tokens cannot step up (AAL0): a token hitting a StepUp-requiring action gets `Deny` for `critical` (via `tokensNeverDoCritical`) or an approval challenge for the rest.

### 6.4 Session policies
Stored in `security_settings` (audited changes, `AUTH-012`): absolute session age (default 30 d), idle timeout (7 d), max concurrent sessions per user (default 10, oldest revoked), `requireMfaFor: [roles]` (`AUTH-050`: admins/owners must have TOTP or passkey; enforced at sign-in and as a guardrail on `role:assign`/`user:*`), device trust (30 d "remember this device" skips the TOTP prompt but never skips step-up), new-device sign-in notification (web push), revoke-all on password change, on ban, on role change. Cookie cache stays for UX reads only; **no authorization decision reads role or ban state from the cookie cache** (kills the 5-minute staleness [audit auth.md §3.12]).

### 6.5 IP allowlists
Per token (`token_constraints.ip_allow`, enforced in `ApiTokenVerifier`, reject before any grant lookup) and per role class (`adminsFromAllowedNetworks` guardrail with the CIDR list in settings; mesh/operator-laptop ranges are the natural list). Requires correct trusted-proxy handling (`advanced.ipAddress.ipAddressHeaders` for Traefik, `AUTH-012`) — an IP rule on a spoofable header is worse than none, so this item is gated on that fix.

### 6.6 API token constraints
Mandatory expiry (default 90 d; `ci` kind up to 365 d; no non-expiring tokens), kind (`pat`/`ci`/`agent`/`deploy_hook`/`cli`), scopes `⊆` minter's grants, optional resource scope (`project:X` / `environment:Y`), `maxRisk` (default `medium`), `readOnly`, IP allowlist, rate limit (BA plugin) plus quota guardrail, **overlap rotation** (mint successor with `rotatedFromId`; both valid for a configurable window; old one auto-expires; UI nudges at T-14 d, `Coolify ApiTokenExpirationWarningJob` equivalent [audit bench-coolify]), `last_used_at/ip` visible, instant revoke (owner, project owner for project tokens, `token:any.revoke`), revocation on owner ban/disable/demotion-below-scope, `dk_` prefix for secret scanners (`SEC-023`), shown once. Token creation is session-only with step-up when the scope set contains a mutating permission.

### 6.7 Invite flows with role caps
`invitations.grant_template` is validated by `Grants.assertGrantable(actor, template)`: every grant must satisfy `perms(grant) ⊆ perms(actor at that scope)`, the actor needs `user:invite` (platform) or `project:member.manage` (project), and **`superAdmin`/owner can never be granted via invite** (only by an existing owner with step-up, or the host recovery CLI). Token shown once, stored hashed, bound to email, 72 h expiry, atomic single-use consume, revoke/resend, never returned in list endpoints. Accepting requires setting a passkey or password; sign-up stays disabled everywhere else (`disableSignUp: true`, plus a sign-up `before` hook that only allows (a) a valid invitation, (b) the setup claim). Fixes `AUTH-001/002/009/010`.

### 6.8 Impersonation with audit
Replaces `loginAs`/master token. Allowed for `platform.superAdmin` (or custom `user:impersonate`) with step-up + reason, never to an equal-or-higher principal, TTL 1 h, **read-only by default** (explicit toggle to allow mutations, itself a step-up), persistent banner, session carries `onBehalfOf=[admin]`, effective permissions = `target ∩ admin` (intersection, so impersonation cannot exceed either party), every audit row records both. BA's `impersonate` endpoint is wrapped (not exposed raw) (`AUTH-031`).

### 6.9 Quotas / rate limits
`Limit` verdicts keyed by `actor|token|project|ip`: e.g. `deployment:create` <= 30/h per token, `container:exec` <= 5 open sessions per actor, `token:mint` <= 10/day, sign-in/invite/device endpoints per IP (`SEC-024`). Counters in Redis per `DEC-SEC-4` (give it its first real purpose), Postgres unlogged table as the single-node fallback. Also stops a compromised CI token from spamming deploys (`I-14`).

### 6.10 Secrets scoping
- Split the verbs: `secret:list` (names, metadata) vs `secret:write` vs **`secret:reveal`** (value; `critical`, step-up, always audited with secret id not value). API responses never contain secret values unless the caller holds a `reveal` grant *and* the procedure is the explicit reveal procedure (`SEC-021`).
- Scope secrets to `(project, environment, service)` and, for the platform tier, to nodes: a `node_selector` grant lets "edge-operator" see edge-node credentials only. Node-side: a mesh member may unwrap only secrets for services the placement policy can put on it (envelope encryption to member keys, `I-05`); the API-level authz and the node-level cryptographic scoping are two independent locks.
- Guardrail template: `secret:reveal` on `env.kind=production` requires approval.

### 6.11 Delegation to agents (MCP/CLI) — read-only by default
- Agent credentials are `api_token` kind `agent`, owner = a human (or service account), minted through the device-code flow whose approval page lists the **exact scopes, maxRisk, expiry** and requires a passkey tap. Default scope set = all `mutating:false` permissions with `risk <= medium` minus `secret:*`, `container:*`, `audit:export`, `token:*`.
- **Propose/dispose:** an agent calling a mutating procedure it was not explicitly granted gets `APPROVAL_REQUIRED` and the resulting `access_request` shows the *human-readable plan* (procedure, resource, input diff). A human approves with a passkey; the agent retries; the hash binding makes the approval apply to exactly that action. Auto-approval for low-risk mutations can be enabled per token, never for `high+`.
- Short-lived (default 8 h), `maxRisk=medium`, quota-limited, IP/location optional, every call audited with `via=mcp`, tool outputs (logs, env) flagged untrusted in the MCP layer (prompt-injection hygiene, `FEAT-095`).
- The MCP tool list and CLI commands are generated from the contract manifest (`FEAT-084`), so an agent literally cannot see tools its token cannot call.

### 6.12 Group of smaller items worth having
Last-owner lock-out protection (cannot delete/demote/ban/expire the last active `platform.superAdmin`; invariant checked in the same transaction), "freeze window" deny policies (`Deny deployment:create at env.kind=production between Fri 16:00 and Mon 08:00 unless elevation`), per-environment protected flag ("production" environments default to the `prodDeploy` policy), grant review report ("who has what, stale grants, never-used tokens"), time-boxed contractor grants.

---

## 7. Hardening: how the design closes the known holes

| Known hole [audit] | Closed by | Roadmap IDs |
|---|---|---|
| Open sign-up at the API; client-settable `role` (`auth.ts:135 input:true`) | `disableSignUp: true`; sign-up `before` hook = invitation-or-setup-claim only; `user.role` `input:false` and write-protected projection; new accounts get baseline `member` with no capabilities | `AUTH-001`, `AUTH-024`, `AUTH-041` |
| Invite escalation to superAdmin; token in response; list leaks tokens | Own `invitations` table; `assertGrantable` (subset rule); superAdmin never inviteable; token hashed, shown once, never listed; atomic consume | `AUTH-002`, `AUTH-009`, `AUTH-042` |
| Master token / loginAs on by default, public default key, `z.coerce.boolean` bug | **Plugins deleted**; no `DEV_AUTH_KEY` anywhere; dev convenience = device-code login + service-account token in dev seed; recovery = host CLI | `AUTH-003`, `AUTH-004`, `AUTH-043`, `SEC-017` |
| Default admin `admin@admin.com`/`adminadmin`, promotion of existing users | Setup claim principal bound to passkey enrolment; seed only on empty user table; no promote-by-email path exists in the model (grants are explicit rows) | `AUTH-005`, `AUTH-016`, `SEC-012` |
| `admin` can self-promote / act on superAdmin (BA `set-role` has no hierarchy) | `set-role` removed from BA's surface; `Grants.assign` enforces subset + strictly-lower rank for role assignment on a target; `role:assign` is `critical` (step-up); BA admin endpoints behind `before` hook calling `Authz.require` | `AUTH-006`, `AUTH-044` |
| Platform mutations guarded only by `requireAuth()` (fleet 83/4, project 69/0, runtime 85/11, bff 18/0) | Global gate, default deny, CI check that every procedure is annotated; generated 403 matrix | `SEC-001`, `SEC-002`, `SEC-003`, `SEC-004`, `SEC-011`, `SEC-038` |
| Swarm join tokens to every authenticated user | `node:join-token.reveal` is `critical`, platform-scope only, step-up + audit, never part of list/info outputs | `SEC-005` |
| Missing project scoping on reads/lists/streams | Scoped grants + `Authz.filter` SQL push-down + stream re-validation; non-members get 404 (concealment) | `SEC-006`, `SEC-010`, `SEC-034`, `SEC-044`, `DEC-SEC-6` (member-only + platform viewer fleet read) |
| Project role escalation (`"admin"` role that does not exist; collaborators) | Collaborators become grants; `assertGrantable`; `project:member.manage` is `high`; owner grant cannot be created by anyone but an existing project owner/superAdmin | `SEC-007`, `AUTH-020` |
| Cross-project injection / template scoping | Resource selectors resolve ancestry from the *stored* resource, not from client-supplied `projectId`; a mismatch between claimed and actual parent is a `Forbidden` | `SEC-009`, `SEC-008` |
| Monolith user CRUD open to any session | Retire module (cutover); identity rules re-expressed as catalog permissions + `assertGrantable` | `AUTH-007`, `AUTH-049` |
| Raw cookie forwarding; anonymous svc->svc | Signed actor claim; service principals; services never accept cookies | `SEC-030`, `SEC-031`, `SEC-032`, `SEC-043` |
| `AUTH_SECRET` default `fallback-auth-secret` (forged sessions; derives ingress token and column key) | Out of scope for authz but a precondition: separate secrets by purpose, fail boot in prod | `SEC-016`, `SEC-017`, `SEC-018` |
| Cookie cache serves stale role/ban for 5 min; `setBanned` raw DB write | Authz never reads role/ban from cache; ban = transaction {grant revoke, session revoke, token revoke, epoch bump} | `AUTH-013` |
| Permission engine fail-open/closed ambiguity; empty rules deny all; `superAdmin` bypass | Fail closed with 503 + boot invariant; seeded system roles; bypass deleted; recovery CLI | `AUTH-025`, `SEC-033` |
| 2FA/passkey/API-key/device flows half-wired | Prerequisites, not part of the model: passkey rpID/origin fix, TOTP challenge UI, API key transport via `customAPIKeyGetter`, device CLI client | `AUTH-017`, `AUTH-018`, `AUTH-019`, `AUTH-023`, `AUTH-047`, `AUTH-048` |
| Roster: any member can revoke any member / write any setting [audit I-02] | Mesh-member actors get catalog `mesh:*` permissions from roster **capabilities** (admission record), delegation can only narrow; `roster.revoke` of an `admit`-capable member needs 2 signers | `I-02` / `NET-069` family, `IDEA-004` |
| Terminal/files/exec reachable by viewers | `container:exec` / `file.write` `critical`; prod requires approval; session recording | `SEC-003`, `OBS-075`, `I-06` |
| No audit of auth events | Decision log + BA hooks -> AuditLog | `AUTH-029`, `OBS-071`, `OBS-085` |

---

## 8. Orgs, teams, SSO, SCIM: scope and timing

| Item | Recommendation | When | Why |
|---|---|---|---|
| Organizations (tenants) | **Do not build.** Close `DEC-AUTH-1` as "platform + project", fix root `AGENTS.md`/`docs/qa/permissions` drift. | never until multi-tenant billing is a goal (`DEC-CLUSTER/FEAT` single-vs-multi-tenant) | One mesh = one tenant [code comments in `permission-engine.ts`, `PermissionService`]. The design leaves the door open: add `org` as an ancestor scope type + nullable `projects.org_id` + resolver change; grants/roles/guardrails are unchanged. BA `organization` plugin is not a fit for per-project roles [doc]. |
| Groups/teams | **Add in Phase 6** when there are >= 3 humans: `authz_groups` + membership, grants may target a group (1-hop subject set, so SQL stays a simple `IN`). | After enforcement is stable | Cheap, and it is the only ReBAC-like feature we need. |
| OIDC SSO (GitHub/GitLab/generic) | **Yes, Phase 6**, via `@better-auth/sso` [search/doc]: JIT provisioning creates a baseline `member`, optional `idp_group_mappings(group claim -> role@scope)` creating grants with `source='sso'`; allowed email domains; sign-up stays closed except through the IdP provisioning hook; passkeys remain the step-up factor. Effort M. | After `AUTH-018` (passkey rpID) and Phase 3 | `bench` shows Dokploy/Dockhand paywall SSO; free OIDC is a differentiator but not a blocker. |
| SAML | **No.** BA's SAML support is documented as still maturing [search: official docs warn it may not be production-ready]. | revisit on concrete demand | |
| SCIM | **No** until a customer asks; then `@better-auth/scim` (v1.8 beta [search]) mapped to groups. | later | Provisioning does not grant access by itself [search]; our grants model already separates identity from authorization. |
| LDAP | No | | |

---

## 9. Migration plan from today's roles

### 9.1 Seed rules from current roles
- **Platform roles:** generate `authz_roles` rows from `platformRolesConfig` (superAdmin, admin, operator, viewer) **mechanically** (a one-shot generator reading `permissions/config.ts`), then extend with the new resources (`container`, `secret`, `node`, `dns.provider`, `token`, `mesh`, …) using the explicit policy decisions in §9.3. Add `member`. Existing users: `user.role` -> one platform grant at scope `platform` (`source='migration'`); users with the undefined legacy role `user` become `member` (`DEC-AUTH-4` follow-up).
- **Project roles:** `project_collaborators` rows -> grants at `project:<id>`; owners (`projects.ownerId`) -> `project.owner` grants (`source='ownership'`).
- **Default guardrails** seeded in `shadow` mode: `requireStepUpForCritical`, `tokensNeverDoCritical`, `prodDeployNeedsMaintainerOrApproval` (preset-dependent), quotas.
- Migration is a **versioned data migration with a dry-run report** (counts per role, users with no resulting grant, projects without an owner grant).

### 9.2 Phased rollout with shadow mode

| Phase | Content | Exit criteria | Effort |
|---|---|---|---|
| **P0 (now, independent of this design)** | Close the cheap criticals with the *smallest* changes: `disableSignUp`, `role input:false`, delete master-token/loginAs plugins, delete default-admin fallbacks, invite plugin removed or hard-gated, `/setup/*` lock, join-token endpoint role-gated (temporary coarse `requirePlatformRole`, tracked for deletion in P3), monolith user controller removed from `AppModule`. | `AUTH-001..007`, `SEC-005`, `SEC-012` tests green | ~1-1.5 wk |
| **P1 Foundations** | Catalog; `Actor`/`CurrentActor`; verifiers (session + api-token incl. `customAPIKeyGetter`); tables + seed + migration; `evaluate` (pure) with property tests; `PermissionResolver` + cache + epoch; `Authz.check/require/filter/explain`; gate middleware in **shadow** on 3 pilot procedures (one read, one mutation, one admin) per `effect-ecosystem-research` prototype step; error mapping | Pilot shadow log shows decisions; spike confirms oRPC meta/input ordering | ~2-2.5 wk |
| **P2 Coverage + shadow** | Annotate every procedure (mechanical, LLM-assisted, human-reviewed per area); CI check; generated matrix + 403 tests; shadow in all areas for one full release; legacy decision oracle = existing inline checks, **and for `requireAuth()`-only procedures the legacy decision is "allow"**, so the disagreement report is precisely "what would newly be denied" | disagreement report empty or each entry explained; matrix page generated | ~2-3 wk (spread over the release) |
| **P3 Enforce by area** | Flip in this order: **fleet/cluster/docker/secrets/dns** (highest blast radius, `SEC-002..005`) -> **runtime/deployments** (`SEC-010`) -> **project/service** + `Authz.filter` on all lists/streams (`SEC-006/034`) -> **identity/user/roles** -> **bff screens**. Per-area flip is a settings row (`authz.mode.<area>`), audited. Delete the temporary coarse gates from P0. | `SEC-044` negative tests green per area; no unexplained 403 in a soak period | ~1.5-2 wk |
| **P4 Credentials + guardrails** | Scoped tokens (`AUTH-022`, `FEAT-080`), signed actor claim + service principals (`SEC-030/031`), step-up (`AUTH-030`), approvals + elevation (`I-06`), session policy (`AUTH-012`), impersonation (`AUTH-031`), invitations rewrite (`AUTH-010`), service accounts (`AUTH-034`), agent tokens + MCP (`FEAT-095`) | each has e2e (`AUTH-047/048`) | ~4-5 wk |
| **P5 UI** | Roles & grants admin (`AUTH-026`), access explorer (explain/simulate), approvals inbox, token & session management, `useCan`/`<Can>` replacing `RequirePermission` | | ~2-3 wk |
| **P6 Later** | Groups, OIDC SSO, signed policy bundle in roster (`SEC-036`), node-local enforcement of exec/secret unwrap, quorum for catastrophic mesh ops (`I-02`) | trigger-based | ~3-4 wk |

### 9.3 Explicit policy decisions to take while seeding (recommended defaults)
- Platform `viewer` and `operator`: read fleet/node/health views (`DEC-AUTH-5`/`DEC-SEC-6` recommendation); **project data (services, deployments, logs) only via project membership** — platform `admin`/`superAdmin` see all projects (platform-scope `project:read`).
- `operator`: `node:read/label/drain`, `deployment:*` and `container:read` platform-wide? **No** — operator gets runtime *observation* and node operations; deploy/exec in a project needs a project role. This is the single biggest behaviour change for existing operators and must be called out in release notes.
- `container:exec`, `secret:reveal`, `dns.provider:write`, `mesh:roster.*`, `role:assign`: **owner only** by default.

### 9.4 Rollback
- Kill switch per area: `authz.mode.<area> = shadow` (never `off`; shadow still logs). Flip is audited and itself requires `system:configure` + step-up. Flipping back re-opens the hole it closed, so it is a break-glass action with a notification and an auto-expiry to "enforce" after N hours.
- DB: migration is additive until P3 completes; `project_collaborators` and `user.role` are retained read-only for one release after the flip, then dropped (`user.role` is retained permanently as the projection).
- Recovery: `deployer authz recover --grant-owner <email>` runs on a node (requires host root + DB access; prints to audit), the only lock-out escape.
- Config rollbacks: system roles carry `content_hash`; a bad role edit is reverted by re-seeding from code.

### 9.5 Test strategy
1. **Pure core, table-driven** (`evaluate`): every system role x every catalog permission x {in-scope, sibling project, descendant, ancestor} x {token ceiling variants} — the table doubles as the doc matrix.
2. **Property tests (fast-check)**, run in CI on every PR:
   - **P-ESC** no escalation: for any actor A and any grant/invite/role/token request G that `assertGrantable` accepts, `perms(G, scope) ⊆ perms(A, scope)`; for any sequence of accepted grants, the set of reachable permissions never exceeds the root's.
   - **P-TOK** token ⊆ owner at every point of time (including after owner demotion).
   - **P-DENY** adding a deny grant never *adds* an allowed (permission, resource); adding an allow never removes one unless a deny exists.
   - **P-INH** project-scope grant ⇒ allowed on every descendant, none on siblings or ancestors.
   - **P-FILTER** `filter()` SQL result set == `{ r | evaluate(r).effect == allow }` over generated data in real Postgres (PGlite or the test container) — the push-down must agree with the checker.
   - **P-DELEG** result for `onBehalfOf` chains = intersection of hops.
   - **P-APPROVAL** an approval is consumed at most once and only for an identical action hash, under concurrent consumption.
   - **P-FAILCLOSED** any resolver exception yields 503/deny, never allow.
3. **Negative authz matrix** generated from contracts (`SEC-038`, `SEC-044`), run through **full oRPC `call()`/HTTP** (not `callProcedure`, which bypasses middleware [audit effect-architecture]).
4. **Contract/CI guards:** unannotated procedure fails; public allowlist snapshot; catalog <-> role definition consistency; every system role permission exists.
5. **Integration (in-memory Better Auth, `AUTH-046`):** sign-up closed, invite caps, set-role hierarchy, token transport, ban revokes sessions/tokens, step-up expiry, device-code scopes.
6. **Shadow-diff harness:** replay of recorded production-like traffic against old vs new.
7. **Mutation test the gate:** remove the gate from one controller in a test build and assert the matrix fails.

### 9.6 Effort summary (single engineer, includes tests)

| Work item | Size | Notes |
|---|---|---|
| Catalog + system roles + BA ac projection | M | port from `config.ts`, extend resources |
| Actor + verifiers (session, token, claim, service, mesh) + `Authn` | L | tokens fix `AUTH-019` |
| Schema, seed generator, data migration, drop `role_rules`/`project_collaborators` | M | |
| Pure `evaluate` + property tests | M | |
| `PermissionResolver`, cache, epoch/NOTIFY, resource resolver | M | |
| `Authz` service incl. `filter` SQL push-down + real `cascade` | L | extends existing compiler |
| Contract `.access()` meta, gate, error mapping, CI checks, generators (matrix, 403 tests, manifest) | L | needs Template v1 (`EFF-001`, `EFF-014`) |
| Annotate all procedures (~hundreds; BFF delegation generated) | L | mechanical, reviewed per area |
| Shadow tooling + disagreement report + per-area flips | M | |
| Scoped tokens, rotation, constraints | M | |
| Signed actor claim + service principals + deputy rule | M | roster anchoring later |
| Step-up + session policy | M | needs `AUTH-018` |
| Approvals + elevation + decision log integration | L | `OBS-071` provides the table |
| Invitations + service accounts + impersonation | M | |
| Agent tokens + device-code scope UX + MCP | M | |
| Web: capabilities endpoint, `useCan`, admin UI, explorer, inbox | L | |
| Groups, OIDC | M each | later |
| **Total to enforced + tokens + step-up** | **~9-12 wk** | |

---

## 10. Open decisions with recommendations

| ID | Question | Options | **Recommendation** |
|---|---|---|---|
| D1 | Authorization model | flat RBAC / grants+guardrails / ReBAC / Cedar-OPA | **Grants + guardrails** (this doc); record as the closing of `DEC-AUTH-8` ("wire the engine": yes, as a rewritten shell over the kept filter machinery). |
| D2 | Keep `superAdmin` bypass? | keep / remove | **Remove**; owner = all permissions, guardrails apply; host recovery CLI for lock-out. |
| D3 | BFF->service identity | cookie forward / signed claim / mTLS | **Signed EdDSA claim (30 s) + service tokens**, signer key anchored in the roster; mTLS only if the mesh later provides it for free. Resolves `DEC-SEC-3`, `EFF-016`, ADR in `DEC-EFF-3`. |
| D4 | Where policy lives | Postgres / roster / both | **Postgres for human/API authz now; roster capabilities for mesh-member authority; signed policy bundle in the roster later (`SEC-036`) for node-local enforcement.** Respects the mesh-first rule without forcing the API tier onto the roster. State this trade-off in the architecture doc: the API tier *is* a coordinator for human actions. |
| D5 | Service accounts | user rows / separate table | **User rows with `kind`** (native to BA API keys). |
| D6 | Non-member reads | 403 / 404 | **404 (concealment)** when the actor lacks `:read` on the resource; 403 only when read is held but the action is not. |
| D7 | Default role for new accounts | `viewer` / none | **`member` with no capabilities** (supersedes `DEC-AUTH-4`'s "viewer"). |
| D8 | Approvals in a one-person install | require second person / degrade | **Preset `solo`: degrade to step-up + reason + cooldown**; auto-suggest `team` at >=2 humans. |
| D9 | Invites | BA org invitations / own table / drop and use `admin.createUser` | **Own `invitations` table** (`DEC-AUTH-2`): grant templates and caps. Interim (before P4): admin-created users via our service, no email invites. |
| D10 | Agent Auth plugin | register / delete | **Delete** (`DEC-AUTH-6`); agent tokens + device flow instead. Revisit if the Agent Auth spec stabilises. |
| D11 | Quotas store | Redis / Postgres | **Redis** per `DEC-SEC-4`, Postgres unlogged-table fallback for single-node. |
| D12 | Decision-log volume | log everything / tiered | **Tiered** (§5.8), hash-chained, 30 d decision summaries for simulate. |
| D13 | Condition language | CEL/Cedar / existing `DFilter` | **`DFilter`** (non-Turing, tested, SQL-compilable); extend with `in`/`matches`/time/attribute paths only as needed (I-01 recommendation). |
| D14 | Proof-carrying `Authorized` witness | adopt / skip | **Adopt incrementally**: `risk>=high` mutations first. |
| D15 | Org layer | build / not | **Not now**; leave the `org` ancestor extension point (D-§8). |
| D16 | `operator` scope | platform-wide deploy / observe + node ops only | **Observe + node ops only**; deploys require a project role (documented behaviour change). |
| D17 | Impersonation default | rw / ro | **Read-only by default**, step-up to enable writes, intersection semantics. |
| D18 | oRPC gate/meta mechanics | middleware reading `procedure["~orpc"].meta` after validation | **Confirm in the Template v1 spike** [mem] before annotating hundreds of procedures; fallback is `implement(contract).use(authzGate(accessMapFromContract))` keyed by procedure path. |

---

## 11. Roadmap mapping (what this design owns, what it unblocks)

- **Owns / replaces:** `SEC-001` (= `IDEA-001`), `SEC-033`, `SEC-034`, `SEC-035` (explain/simulate), `SEC-036` (signed policy bundle, later), `SEC-037` (guardrails), `SEC-038`, `SEC-044`, `AUTH-025`, `AUTH-026`, `AUTH-030`, `AUTH-031`, `AUTH-034`, `AUTH-035` (-> delete/replace), `AUTH-050`, `FEAT-080` / `AUTH-022` (scoped tokens), `FEAT-084` (manifest from metadata), `FEAT-095` (MCP), `EFF-014` (Actor), `EFF-016` (claim forwarding).
- **Closes by consequence:** `SEC-002..011`, `AUTH-006`, `AUTH-013`, `AUTH-024`, `AUTH-027` (obsolete if D15), `DEC-AUTH-1/2/4/5/6/8`, `DEC-SEC-3/6`.
- **Prerequisites owned elsewhere:** `AUTH-001..005` (P0 now), `AUTH-012` (session policy, trusted proxy), `AUTH-017/018/019/023` (2FA, passkey rpID, API-key transport, device CLI), `SEC-016..018` (secrets separation), `OBS-071/072/085` (audit table, diffs, coverage guard), `EFF-001/004/014` (Template v1), `SEC-024` / `DEC-SEC-4` (rate-limit store), `IDEA-004` / `NET-069` (roster identity/capabilities).
- **Unblocks:** `I-06` break-glass, `I-18` signed approvals, `I-05` node-scoped secrets (authz side), `I-14` quotas, `FEAT-081` deploy hooks (a `Webhook` principal with one grant), CLI/CI/MCP.

### Appendix A. Seed role/permission sketch (abridged; the real matrix is generated)

| Permission (risk) | superAdmin | admin | operator | viewer | member | project.owner | maintainer | deployer | project.viewer |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `project:read` (low) | all projects | all projects | none | none | none | own | own | own | own |
| `project:delete` (critical) | ✔ | ✔ | | | | ✔ | | | |
| `project:member.manage` (high) | ✔ | ✔ | | | | ✔ | ✔ (cap: <= maintainer) | | |
| `service:update` (medium) | ✔ | ✔ | | | | ✔ | ✔ | ✔ | |
| `deployment:create` (medium; prod = approval policy) | ✔ | ✔ | | | | ✔ | ✔ | ✔ | |
| `deployment:rollback` (high) | ✔ | ✔ | | | | ✔ | ✔ | ✔ | |
| `container:exec` (critical) | ✔ | | | | | ✔ | | | |
| `secret:reveal` (critical) | ✔ | | | | | ✔ | | | |
| `node:read` (low) | ✔ | ✔ | ✔ | ✔ | | | | | |
| `node:drain`/`label` (high) | ✔ | ✔ | ✔ | | | | | | |
| `node:join-token.reveal` (critical) | ✔ | | | | | | | | |
| `dns.provider:write` (critical) | ✔ | | | | | | | | |
| `user:invite` (high) | ✔ | ✔ (cap: <= admin, never owner) | | | | | | | |
| `role:assign` (critical) | ✔ | | | | | | | | |
| `token:self.manage` (medium) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `audit:read` (medium) | ✔ | ✔ | ✔ | | | project-scoped | | | |
| `mesh:roster.revoke` (critical) | ✔ (2-signer for admit-capable members) | | | | | | | | |

(Every ✔ for a `critical` row still passes through the step-up guardrail; every row is evaluated with deny grants and guardrails after the allow.)
