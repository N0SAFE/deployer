# Providers & Runners — Unification Deep Analysis (2026-08-04)

> Goal (user request): **everything provider-related lives under one `providers/`
> folder; everything runner-related under one `runners/` folder; providers are
> split between `code` and `dns`; and there is a public API that automatically
> calls the right provider through a shared method.**
>
> This document analyzes the current fragmentation, defines the target
> architecture, and records the implementation.

---

## 1. Current State — Fragmentation Map

Provider/runner code is scattered across **7 API locations** today:

| Current location | What it is | Verdict |
|---|---|---|
| `modules/deployment/providers/` | **Source providers** (github/custom/upload) — resolve a deployment trigger into a checkout context. Has `DeploymentSourceProvider` interface + `SourceProviderRegistryService` (dispatch by `sourceType`) + `DEPLOYMENT_SOURCE_PROVIDERS` multi-token | **Code provider** — the registry pattern to generalize. Move to `providers/code/` |
| `modules/deployment/runners/` | **Runtime runners** (docker/dockerfile/compose/nixpacks/buildpack/railpack) — `RuntimeRunnerRegistryService.execute(runnerKind, input)` | **Runners** — move to `modules/runners/` as-is |
| `modules/github-apps/` | **GitHub account CRUD + manifest/OAuth/listRepos/detectRunner** (controller-only module, persistence via core `GitHubService` + `githubApps` table) | **Code provider account layer** — move to `providers/code/github/` |
| `modules/dns-providers/` | **DNS provider accounts + Cloudflare zones/records** (`DnsProvidersService`, token stored in `github_apps` with `organizationId="dns-providers"` — the known P0 abuse) | **DNS provider** — move to `providers/dns/cloudflare/` and introduce a real `DnsProvider` interface + registry |
| `modules/github/` | **GitHub webhook ingress** (receiver + preview provisioning + TTL cleanup) — consumes `DnsProvidersService` | **Ingress, not a provider config** — stays `modules/github/`; imports the new `ProvidersModule` |
| `modules/provider-schema/` | Static wizard metadata (providers + builders catalog from `packages/utils/provider-schema`) | **Metadata service, not a provider implementation** — stays; referenced from the wizard |
| `core/modules/git/github/` | Core GitHub API service (octokit wrapper), deployment rules/cache repos | **Core infra** — stays in `core/`; adapters depend on it |

The web side mirrors the mess: `domains/github-apps/`, `domains/dns-providers/`,
`domains/provider-schema/` + pages under `admin/providers/code/{github,gitlab,
docker-hub}` and `admin/providers/dns/{cloudflare,route53,google-dns}` — GitLab
and Docker-Hub pages use **fake local state** (no API), only GitHub is real.

---

## 2. The Existing Pattern That Generalizes

Both registries already prove the "public API with a shared method" pattern:

```ts
// source-provider-registry.service.ts (today)
@Injectable()
export class SourceProviderRegistryService {
  private readonly providersByType = new Map(
    this.providers.map((p) => [p.sourceType.toLowerCase(), p]),
  );
  async resolveSourceCheckout(input) {
    const provider = this.providersByType.get(input.sourceType.toLowerCase());
    return provider?.resolveSourceCheckout(input) ?? null;   // shared method
  }
}

// runtime-runner-registry.service.ts (today)
export class RuntimeRunnerRegistryService {
  async execute(runnerKind, input) {
    const selected = runners.find((r) => r.runnerType === runnerKind.toLowerCase());
    return selected.executeRuntime(input);                     // shared method
  }
}
```

- Multi-provider injection via **token**: `DEPLOYMENT_SOURCE_PROVIDERS`.
- Each provider implements a **narrow interface** (`sourceType` + shared method).
- Dispatch by **type string** — zero switch/if-chain on provider kind.

The design flaw: the pattern exists **twice, in two folders, hardcoded to
deployment**. DNS providers have **no** interface/registry at all (the controller
calls `DnsProvidersService` directly). GitHub accounts have **no** interface
either (controller calls `GitHubService` directly).

---

## 3. Target Architecture

### API — `apps/api/src/modules/providers/`

```
providers/
  providers.module.ts                    ← wires code + dns registries, exports both
  base/
    provider.interface.ts                ← ProviderId, base metadata (shared)
  code/
    code-provider.interface.ts           ← CodeProvider: sourceType + shared methods
                                           (resolveSourceCheckout, listRepos, detectRunner, selfCheck)
    code-provider.token.ts               ← CODE_SOURCE_PROVIDERS multi-token
    code-provider-registry.service.ts    ← dispatch by sourceType (generalized registry)
    github/
      github-account.service.ts          ← account CRUD (from github-apps controller logic)
      github-source-provider.service.ts  ← checkout (moved from deployment/providers/github)
      github-account.controller.ts       ← public API (from github-apps controller)
    gitlab/
      gitlab-code-provider.service.ts    ← NEW real implementation (replaces fake UI)
    docker-hub/
      docker-hub-code-provider.service.ts ← NEW real implementation
    upload/
      upload-source-provider.service.ts  ← moved
      upload-bundle-registry.service.ts  ← moved
    custom/
      custom-source-provider.service.ts  ← moved
  dns/
    dns-provider.interface.ts            ← DnsProvider: listZones, listRecords,
                                           createRecord, deleteRecord, findZoneForHostname
    dns-provider.token.ts                ← DNS_PROVIDERS multi-token
    dns-provider-registry.service.ts     ← dispatch by providerType
    cloudflare/
      cloudflare-dns-provider.service.ts ← CloudflareDnsProviderService implements DnsProvider
      cloudflare.helpers.ts              ← moved
  controllers/
    code-providers.controller.ts         ← github account endpoints (from github-apps controller)
    dns-providers.controller.ts          ← moved from dns-providers/controllers
```

### API — `apps/api/src/modules/runners/`

```
runners/
  runners.module.ts                      ← moved
  runtime-runner.interface.ts            ← moved
  runtime-runner-registry.service.ts     ← moved
  base/                                  ← delegated-runtime-runner.base.ts,
                                           runner-option-policies.schema.ts
  docker/  dockerfile/  docker-compose/  ← moved
  nixpacks/  buildpack/  railpack/       ← moved
  adapters/deployment-load-balancer-sync.adapter.ts  ← moved (only used by runners)
```

### Shared dispatch contract (the "public API")

```ts
// Every code provider implements this ONE interface:
export interface CodeProvider {
  readonly sourceType: string;                    // "github" | "gitlab" | "docker-hub" | ...
  resolveSourceCheckout(input): Promise<DeploymentSourceCheckoutContext | null>;
  listRepos?(account): Promise<ProviderRepo[]>;
  detectRunner?(repo): Promise<RunnerSuggestion | null>;
  selfCheck?(): Promise<ProviderSelfCheck>;
}

// Every DNS provider implements this ONE interface:
export interface DnsProvider {
  readonly providerType: string;                  // "cloudflare" | "route53" | ...
  listZones(account): Promise<DnsProviderZone[]>;
  listRecords(account, zoneId): Promise<DnsProviderRecord[]>;
  createRecord(account, input): Promise<DnsProviderRecord>;
  deleteRecord(account, zoneId, recordId): Promise<void>;
  findZoneForHostname(account, hostname): Promise<{ zoneId; zoneName } | null>;
}
```

`CodeProviderRegistryService` and `DnsProviderRegistryService` become the only
entry points — controllers and services call **one shared method** and the
registry resolves the right adapter by type. No switch on provider kind anywhere.

### Contracts — `packages/contracts/api/modules/providers/`

```
providers/
  index.ts                  ← providersContract router (code + dns routers)
  code/contracts.ts         ← github account/manifest/oauth/listRepos contracts (from github-apps)
  dns/contracts.ts          ← dns provider + cloudflare zone/record contracts (from dns-providers)
```

---

## 4. Decisions & Rationale

| Decision | Rationale |
|---|---|
| Keep `modules/github/` (webhook) + `modules/provider-schema/` outside `providers/` | Webhook is **event ingress**, not a provider config; provider-schema is **metadata** for the wizard covering both providers AND builders. Both only *import* the providers module. |
| Keep `core/modules/git/github/` in `core/` | It's a shared infra adapter (octokit wrapper) used by more than providers (webhook dispatch, deployment rules). Adapters compose it. |
| Runners move verbatim to `modules/runners/` | Already a clean registry module; just relocate + fix relative imports + move the LB sync adapter in (its only consumers are runners). |
| `DeploymentModule` imports `ProvidersModule` + `RunnersModule` | Keeps deployment as a consumer; providers/runners become first-class top-level feature modules. |
| `dns_providers` still stored in `github_apps` (P0) | **Out of scope for this refactor** — tracked separately; the refactor isolates the service behind the `DnsProvider` interface so the storage fix is a one-file change later. |
| GitLab/Docker-Hub adapters | Real minimal implementations (token-based self-check + repo listing) so the fake UI pages get real backing. Full GitLab API surface can grow later behind the same interface. |

---

## 5. Impact List

- **API moves**: `deployment/providers/*` → `providers/code/*`, `deployment/runners/*` → `runners/*`, `github-apps/*` → `providers/code/github/*`, `dns-providers/*` → `providers/dns/cloudflare/*` (+ new interface/registry files, + new gitlab/docker-hub adapters, + controllers).
- **Module rewiring**: `app.module.ts` (replace `GitHubAppsModule` + `DnsProvidersModule` with `ProvidersModule`), `deployment.module.ts` (import `ProvidersModule` + `RunnersModule`), `github.module.ts` (webhook imports `ProvidersModule`).
- **Contracts**: `github-apps/contracts.ts` → `providers/code/contracts.ts`, `dns-providers/contracts.ts` → `providers/dns/contracts.ts`; `providers/index.ts` router re-exports both.
- **Web**: `domains/github-apps` + `domains/dns-providers` → `domains/providers/code` + `domains/providers/dns` (9 importer files updated); GitLab/Docker-Hub pages switch from fake state to real hooks.
- **Tests**: move with their sources; update relative imports.

---

## 6. Swappable-Service Pattern Decision (v2 researched)

The v2 app (`~/Bureau/projects/tests/deployer/v2`) already solved this with a
full provider architecture:

```
core/modules/providers/
  interfaces/provider.interface.ts      ← IDeploymentProvider + IProvider contracts
  common/services/base-provider.service.ts ← abstract BaseProviderService (shared logging/helpers)
  services/provider-registry.service.ts ← Map<string, IProvider>, register/get/dispatch
  services/provider-registry-initializer.service.ts ← OnModuleInit: injects EACH concrete
                                          provider and calls registerProvider()
  github/  static/                      ← concrete providers extending the base
```

Builders (the runner analog) use the identical registry + initializer pattern.
Dispatch everywhere is `registry.getProvider(id)` → shared method.

### Comparison

| Pattern | How registration works | Add a provider = | Pros | Cons |
|---|---|---|---|---|
| **A. Multi-token + `useFactory`** (v3's current `DEPLOYMENT_SOURCE_PROVIDERS`) | module `useFactory` returns `[github, upload, custom]` | edit providers array + useFactory + inject | DI-native, no init lifecycle | verbose block per group |
| **B. v2 initializer** (`OnModuleInit`) | initializer injects each concrete, calls `registerProvider()` | create provider + add to initializer constructor + register call | explicit, easy to read | imperative, extra class, can forget |
| **C. Abstract class token + `multi: true`** (NestJS canonical) | `{ provide: CodeProvider, useClass: GithubProvider, multi: true }` | **one `useClass` line** | class IS token AND contract (matches v3 copilot-instructions), DI-native, minimal ceremony | none significant |

### Chosen: Pattern C — abstract class as token + `multi: true` + registry

```ts
// providers/code/code-provider.interface.ts
export abstract class CodeProvider {
  abstract readonly sourceType: string;                       // dispatch key
  abstract resolveSourceCheckout(input): Promise<CheckoutContext | null>; // shared method
  protected logProvider(input) { ... }                        // shared helpers (like v2 base)
}

// module
providers: [
  GithubSourceProviderService,
  UploadSourceProviderService,
  CustomSourceProviderService,
  { provide: CodeProvider, useClass: GithubSourceProviderService, multi: true },
  { provide: CodeProvider, useClass: UploadSourceProviderService, multi: true },
  { provide: CodeProvider, useClass: CustomSourceProviderService, multi: true },
  CodeProviderRegistryService,   // injects @Inject(CodeProvider) CodeProvider[]
]

// registry — the public API: one shared method, auto-dispatches by type
@Injectable()
export class CodeProviderRegistryService {
  constructor(@Inject(CodeProvider) providers: CodeProvider[]) { /* Map by sourceType */ }
  resolveSourceCheckout(input) { return this.map.get(input.sourceType)?.resolveSourceCheckout(input) }
}
```

Same for `DnsProvider` (abstract) + `CloudflareDnsProviderService extends DnsProvider`
+ `DnsProviderRegistryService` — already drafted in this refactor.

This keeps: **type-safety** (the abstract class is the contract), **DI-native
registration** (real Nest providers, deps auto-injected), **swappable** (add/remove
one `useClass` line), **testable** (`overrideProvider(CodeProvider)`).

---

## 7. Validation Plan

1. `bun --bun run api -- type-check` — my files must add **zero** new errors (repo has pre-existing drift in unrelated files).
2. `bun --bun run web -- type-check` — same.
3. Rebuild `api-dev` container; verify `/health` 200 + provider routes still 401 auth-gated.
4. Proof script for the DNS registry dispatch + code registry dispatch.
---

## 7. Schema Type-Safety Pass (2026-08-04)

Follow-up review of ALL provider/runner schemas per the rule:
**no loose object with many optional fields that depend on each other — every
discriminated kind gets its exact type.**

## 8. Legacy Code Removal Pass (2026-08-04)

Per the rule: **no legacy code, no backwards-compat shims, no migration
fallbacks — the app is in active development.** All of the following were
removed (each verified: zero consumers, type-check clean, API boots healthy):

### API — config/migration fallbacks removed
| Removed | File | Why |
|---|---|---|
| `NODE_TUNNEL_MODE` legacy key + boolean fallback | `core/modules/reachability/services/reachability.service.ts` | Only the JSON `NODE_TUNNEL` config remains; no migration path |
| `legacyResult` convergence source + untyped `result` reads for convergence | `modules/deployment/services/deployment-execution-workflow.service.ts` | `runtimeRunnerOptions` (typed union) is the only source; untyped `getResultNumber` fallback removed |
| `resolveDomainUrl(healthSummary: unknown)` healthSummary fallback | same file | Domain mappings (`routeSync`) are the only URL source; `RouteSyncResult` typed |
| Legacy loose-row `sourceConfig` coercion | `modules/deployment/repositories/deployment.repository.ts` | DB column is union-shaped; only SSOT `deploymentTriggerSourceSchema.safeParse` |
| `MESH_NODE_SERVER_URL` env-var legacy fallback | `system-mesh-config.service.ts`, `runners/adapters/deployment-load-balancer-sync.adapter.ts`, `packages/utils/env` | `APP_URL` is canonical; env var + mock + schema removed |

### API — mesh deprecated APIs removed
| Removed | File |
|---|---|
| Deprecated `execute()` alias + its 2 call sites + e2e specs | `mesh-query-builder.ts`, `system-mesh-resource-discovery.service.ts`, `mesh-query-executor.ts`, 4 e2e specs |
| `MeshResourceScope` / `MeshResourceConfig` deprecated types + `config` field + `TScope` generic + `legacyScope`/`legacyConfig` conversion | `mesh-entity.ts` (zero consumers — pure dead weight) |

### Packages — legacy shims removed
| Removed | File |
|---|---|
| 9 dead legacy types (`HttpMethod`, `EntitySchema`, `InferSchemaType`, `PaginationOptions`, `SortingOptions`, `FilteringOptions`, `StandardOperation`, `BatchOptions`, `EventIteratorOptions`) | `packages/utils/orpc/src/types/types.ts` (kept `UnionTuple` — used) |
| `_attachLegacyAccessors()` (dead — no `.input.entitySchema` consumers) | `packages/utils/orpc/src/builder/core/route-builder.ts` |
| Duplicate deprecated `detectOperationTypeByName` | `orpc/src/hooks/core/operation-detection.ts`, `orpc/src/hooks/generate-hooks.ts` |
| `useSessionBridge` legacy session fallback (option + 2 fallback branches + plumbing) | `packages/utils/auth/src/client/use-session.ts`, `react/session/{client,server,shared}.ts` (web already dropped it) |
| `inviteClient` deprecated alias | `packages/utils/auth/src/client/plugins/index.ts` |
| `getMany` legacy Record-mode overload | `permissions/system/builder/roles/roles-config.ts` (kept collection mode) |
| `useSafeQueryStatesFromZod` / `QueryStateFromZodOptions` legacy aliases + migrated 9 web consumers | `use-safe-query-param-states-from-zod/src/index.ts` + 9 web files |

### Docs / comments
- `isObjectLike` `@deprecated` marker removed (57 active consumers — it's a real primitive, not legacy).
- Stale "legacy hook" comments removed from `apps/web/src/domains/docker/*` + `docker/containers/page.tsx`.
- `UnionTuple` doc comment updated (it's a shared tuple helper, not "legacy").

### Validation
- API non-spec type errors: **335 → 181** (removed ~154; my files add zero).
- API container rebuilds + boots **healthy**.
- Web migrated files type-check clean (remaining docker DataTable errors are pre-existing).

### 7.1 `runtimeRunnerOptionsSchema` → discriminated union on `runner` ✅

`packages/contracts/entities/src/entities/deployment/runtime-runner-options.schema.ts`
was a **flat object** where `dockerfile` / `dockerCompose` / `nixpacks` /
`buildpack` / `railpack` were mutually-exclusive sub-objects but the discriminator
(`runner` kind) lived in a **sibling field** (`execution.runner`, `runnerType`).
You could set `dockerfile` AND `railpack` on the same object — a loose type.

**Now**: `z.discriminatedUnion("runner", [...])` with one member per runner kind:

```ts
// every member: shared execution-level fields + its OWN runner-specific nested options
export const dockerfileRuntimeRunnerOptionsSchema = z.object({
  runner: z.literal("dockerfile"),
  containerName: z.string().min(1).optional(),          // execution-level (shared)
  startupCommand: z.string().min(1).optional(),          // execution-level (shared)
  traefikSyncMaxAttempts: z.number().int().positive().optional(), // shared
  ...
  dockerfile: dockerfileAdvancedSchema.optional(),        // ONLY on this member
}).strict();
```

- Shared execution-level fields exist on **every** member so cross-runner
  consumers (workflow, queue processor) read them without narrowing.
- Runner-specific nested options exist **only** on their member — narrowing
  `options.runner === "dockerfile"` gives the exact type.
- `resolveRuntimeRunnerKind(value)` helper defaults unknown/empty to `"docker"`.
- The API-side duplicate `providers/base/runtime-runner-options.schema.ts` now
  **re-exports from entities** (SSOT). Same for `runners/base/runner-option-policies.schema.ts`
  (keeps backward-friendly `dockerfileRunnerOptionsSchema` aliases).

### 7.2 `RuntimeRunnerExecutionOptions` interface → derived from the union ✅

`apps/api/src/modules/runners/runtime-runner.interface.ts` had a hand-written
loose interface duplicating the schema. Now:
`export type RuntimeRunnerExecutionOptions = RuntimeRunnerOptions;` (imported
from `@repo/contracts-entities`). No parallel definition.

### 7.3 Trigger input `source` → discriminated union on `sourceType` ✅

`deploymentTriggerInputSchema` had `sourceType` + a flat `sourceConfig` object
whose fields (`repositoryUrl`/`branch`/`commitSha` for github vs `uploadId`/
`fileName` for upload vs `customData` for custom) depended on `sourceType`.

**Now**: a single `source: deploymentTriggerSourceSchema` =
`z.discriminatedUnion("sourceType", [github, upload, custom])` — each member
carries exactly its own fields. Consumers updated: providers (github/upload/
custom), `CodeProviderRegistryService`, `CodeProvider.matchesSourceType`,
`deployment.service`, storage utils, `deployment.repository` (DB row type
changed to the union shape + `coerceSourceConfig` for legacy rows), web
deployments page.

### 7.4 Consumers updated for the unions

| Consumer | Change |
|---|---|
| `providers/code/{github,upload,custom}/*` | parse `input.source` (union member), not `input.sourceConfig` |
| `providers/code/code-provider-registry.service.ts` | dispatch on `input.source.sourceType` |
| `providers/code/code-provider.interface.ts` | `matchesSourceType` reads `input.source.sourceType` |
| `runners/*/*-runtime-runner.service.ts` | inject their `runner` literal before validating their member schema |
| `deployment/queue/deployment-queue.processor.ts` | `mergeRuntimeRunnerOptions` preserves the discriminator; only merges same-runner |
| `deployment/storage/base/storage-provider.utils.ts` | reads `input.source.customData` via union |
| `deployment/repositories/deployment.repository.ts` | `sourceConfig` DB type = union; `coerceSourceConfig` parses legacy rows |
| web deployments page | builds `{ source }` union instead of `{ sourceType, sourceConfig }` |

### 7.5 Validation status

- `packages/contracts/entities` — 0 errors in deployment schemas (1 pre-existing auth error).
- `packages/contracts/api` — 0 errors in deployment/crud + providers.
- `apps/api` — **0 errors in every file touched** (335 non-spec errors remain,
  all pre-existing drift in unrelated files; one FEWER than baseline — the
  pre-existing missing `ConflictError` import in `deployment.repository.ts` was fixed).
- `apps/web` — 0 errors in the deployments page; other web errors pre-existing.
- API container: **boots clean** ("Nest application successfully started").
  Pre-existing boot crash (dead-code lifecycle refactor: `DatabaseStartupGuard`
  couldn't resolve `AppLifecycleService`) fixed by importing `AppLifecycleModule`
  in `DatabaseModule`. Provider routes return the pre-existing gateway 503
  (sub-app migration in-flight), not an exception.