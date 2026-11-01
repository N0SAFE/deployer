# Permission-model research — what to build, and what to copy

Date: 2026-11-01. Read alongside [`PERMISSIONS-ROADMAP.md`](./PERMISSIONS-ROADMAP.md). Sources fetched this session are
tagged `[web]` with a link; repo facts are tagged `[code]` with a path.

## 1. The four models, in one table

| Model | Question it answers well | Where it breaks | Engines |
|---|---|---|---|
| **RBAC** | "may this role do X on resource type R?" | per-object and per-field rules; role explosion | Casbin, WorkOS, most SaaS |
| **ABAC** | "may this principal do X, given these attributes?" | every caller must supply attributes; hard to audit | Cerbos (CEL), Cedar |
| **ReBAC** (Zanzibar) | "is there a path from this user to this object?" | not a policy language; needs a graph store + tuples | OpenFGA, SpiceDB, Ory Keto |
| **PBAC** | "what does this policy say about this request?" | Rego/policy-language learning curve; no data of its own | OPA, Cedar, SAPL |

Sources: `[web]` [Oso, "OPA vs Cedar vs Zanzibar" (Oct 2025)](https://www.osohq.com/learn/opa-vs-cedar-vs-zanzibar),
`[web]` [AuthZed, ABAC vs ReBAC](https://authzed.com/learn/abac-vs-rebac-when-to-use-which),
`[web]` [Cerbos vs OpenFGA](https://www.cerbos.dev/cerbos-vs-openfga),
`[web]` [Permit, OpenFGA alternatives (Oct 2026)](https://www.permit.io/blog/openfga-alternatives-fga-comparison).

## 2. Deployment shape matters more than the model

`[web]` [sph.sh comparison](https://sph.sh/en/posts/external-authorization-management-systems/) puts it bluntly: a central
PDP service costs a network hop per decision and is a single point of failure; a sidecar costs a container per service; an
embedded library is fastest but you own policy distribution and audit.

This repo already decided against a sidecar or a PDP service: the mesh must run on 2–10 self-hosted nodes, the API tier
already owns Postgres, and the decision sits in the request path `[code] docs/audit-2026-10-25/authz-authn-design.md §1.3`.
So the model must be **evaluable in-process, from Postgres rows, with no extra daemon**. That rules out OpenFGA/SpiceDB
(graph store to operate), OPA (bundle distribution + Rego), and a Cerbos PDP (a service to keep alive) — not because they
are bad, but because each adds a daemon this product would have to install, monitor and back up on every node.

## 3. What each system gets right (and what we take)

| Source | Idea worth copying | What we do with it |
|---|---|---|
| **WorkOS RBAC** `[web]` [docs](https://workos.com/docs/rbac/configuration) | permissions are **immutable slugs** `resource:action`; roles are named bundles; **custom roles are organization-scoped** and start from environment roles | `Permission` is a code-owned union of slugs; system roles are code-owned; custom roles are DB rows scoped to the platform (and per project later) |
| **Stripe custom roles** `[web]` [docs](https://docs.stripe.com/get-started/account/teams/custom-roles) | a custom role **clones a built-in role and only removes** permissions ("jobs" then individual permissions); it does not silently inherit later additions | custom role = `base_role` + a permission set that must be a **subset** of the base; the UI shows additions to the base for review, never auto-applies them |
| **WorkOS bundles / Stripe jobs** `[web]` [RBAC at scale](https://workos.com/blog/how-to-design-multi-tenant-rbac-saas) | admins pick **bundles** ("invoice management"), not 200 checkboxes | a `Bundle` groups permissions per product concept; the UI edits bundles by default and opens the atomic list on demand |
| **CASL** `[web]` [casl.js.org](https://casl.js.org/) | one typed ability definition, isomorphic to server and UI, with conditions and field-level rules | one catalog generates the type union used by the server gate, the contracts, and the web `useCan`; conditions are typed, not stringly |
| **Casbin** `[web]` [comparison](https://casbin.apache.org/docs/comparison/) | policies as **rows in your database**, evaluated in-process, RBAC-with-domains, hot-editable at runtime | grants/roles are rows; `domain` ≡ our scope (`platform`, `project`, `environment`, `service`, `node`); runtime edits bump an epoch |
| **Cerbos** `[web]` | attribute conditions in a small expression language, plus **policy tests as data** | a small typed `DFilter`-style condition DSL (already in `[code] packages/auth/src/permissions/engine/filter-matcher.ts`), and generated test matrices |
| **Permit** `[web]` [best practices](https://docs.permit.io/overview/best-practices/) | run the new engine **alongside** the old one and compare decisions before enforcing; give non-developers a policy editor | **shadow mode** with a disagreement report (`SEC-082`), then per-area enforcement flips |
| **Cedar** `[web]` | forbid wins over permit; policies are analyzable | deny-first evaluation order, one explicit bypass-free structure; we do not adopt Cedar's language |

## 4. Why not a Zanzibar/ReBAC engine

ReBAC earns its keep when the graph is deep, large, and shared across applications (documents, folders, orgs, sharing
links). This product's graph is small and fixed: `platform → project → environment/service → deployment → logs/container`,
plus `node`/`cluster` under platform `[code] packages/auth/src/permissions/engine/resource-graph.ts`. A single recursive
SQL query over an indexed parent chain answers "is this object inside that project" in one round trip, and the same rows
generate the list `WHERE` clause (`[code] packages/auth/src/permissions/engine/filter-compiler.ts`).

What we keep from Zanzibar is the *shape*: grants attach to a **scope node**, and a check walks up the chain (a grant on
`project:p` covers `service:s`). That is "ReBAC with one level of indirection" without a tuple store.

## 5. What "best DX" means here, concretely

The audit's own finding is that a permission system fails in practice for two reasons: nobody can tell **why** a decision
happened, and adding a procedure silently forgets the gate. The design that fixes both:

1. **One catalog file** is the only place a permission exists. Adding one is a one-line edit; TypeScript then forces every
   affected call site (contract annotation, UI capability map, test matrix) to acknowledge it.
2. **Declaration at the contract**, not at the handler: `.access({ permission: "deployment:create", resource: "service" })`
   sits next to the schema, so the gate is uniform and a new procedure without it fails the build (`SEC-061/062/064`).
3. **Explainability built in**: every denial carries `{ permission, scope, reason, evaluated_rules }`, the UI has a
   "why?" drawer, and `deployer authz explain --user X --permission Y --scope Z` prints the same tree.
4. **Simulation before save**: the role editor can "preview as" a user and lists the diff (`+3 / -1 permissions`) before
   persisting.
5. **Small default surface**: five system roles that map to real jobs, bundles for editing, custom roles only when a
   customer needs them. `[web]` WorkOS explicitly recommends starting single-role; multiple roles only when additive sets
   are common.

## 6. The model we adopt

**Typed capability RBAC with scoped grants, small typed conditions, deny/expiry, and a guardrail layer.**

```
Principal (user | service | agent | system | anonymous)
  └─ Grant*  { subject, role?|permission?, scope, effect: allow|deny, condition?, expiresAt? }
       └─ Role (system | custom)  { bundles[] | permissions[] , baseRole?, scopeKind }
            └─ Permission (slug, risk tier)  { resource, action }
                 └─ Bundle (product concept)  { permissions[] }
```

- **Scope** is a typed node (`platform`, `project:<id>`, `environment:<id>`, `service:<id>`, `node:<id>`); a grant on a
  parent applies to descendants, never to siblings.
- **Effect**: `allow` by default, `deny` wins; `deny` exists for "everyone may read logs except this project".
- **Condition**: a small typed predicate over facts the resolver already loads (`actor.id`, `resource.ownerId`,
  `request.ip`, `now`, `environment.kind`), compiled from the same `DFilter` vocabulary that already exists.
- **Guardrails** (Layer B, per the existing design): per-permission requirements that are not identity — step-up TOTP,
  approval by a second person, quota, IP allow-list, time window.
- **Tokens** carry scopes that are intersected with the owner's live permissions (never additive), so a build token can
  never exceed the person who minted it.
- **No bypass.** `superAdmin → ALLOW` is deleted; the owner role holds every capability and guardrails still apply. A
  lock-out is recovered by a host CLI that writes a grant through the database, not by an in-code shortcut
  `[code] packages/auth/src/permissions/engine/permission-engine.ts:1-8` (which currently has exactly that bypass).

## 7. Costs we accept

- The catalog is code, so a **new permission needs a deploy**. That is deliberate: a permission is part of the product's
  contract, and the alternative (admins inventing slugs in a UI) produces the 40-role sprawl WorkOS warns about.
- Custom roles are **subsets of a system role**, so an admin cannot grant something the product does not model. If a
  customer needs a genuinely new capability, it becomes a bundle in code, then a role.
- Evaluation stays in-process, so **list endpoints must compile the filter to SQL** rather than page-then-filter. That is
  already the engine's Phase B `[code] packages/auth/src/permissions/engine/filter-compiler.ts`.

## 8. Sources

- Oso, *OPA vs Cedar vs Zanzibar* (Oct 2025) — https://www.osohq.com/learn/opa-vs-cedar-vs-zanzibar
- AuthZed, *ABAC vs ReBAC: when to use which* — https://authzed.com/learn/abac-vs-rebac-when-to-use-which
- Cerbos, *Cerbos vs OpenFGA* — https://www.cerbos.dev/cerbos-vs-openfga
- Casbin, *Casbin vs alternatives* (2026) — https://casbin.apache.org/docs/comparison/
- Permit, *OpenFGA alternatives* (Oct 2026) — https://www.permit.io/blog/openfga-alternatives-fga-comparison
- sph.sh, *OpenFGA vs SpiceDB vs Cerbos vs OPA* — https://sph.sh/en/posts/external-authorization-management-systems/
- WorkOS, *RBAC configuration* / *custom roles* / *multi-tenant RBAC* — https://workos.com/docs/rbac/configuration ,
  https://workos.com/blog/how-to-design-multi-tenant-rbac-saas
- Stripe, *Custom roles* — https://docs.stripe.com/get-started/account/teams/custom-roles
- CASL — https://casl.js.org/
- Permit, *Best practices* — https://docs.permit.io/overview/best-practices/
