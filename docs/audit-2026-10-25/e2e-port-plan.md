# Cutover step 8: e2e port / drop proposal

> **Status**: DONE 2026-10-27. Approved with: drop rows 7-11, 13, 15; port row 6 trimmed to 2 instances; move the 12 `it.todo` to the roadmap (`NET-107`). Outcome at the end of this file.
> **Source**: the 16 monolith e2e specs with no tier counterpart (`apps/api/src/e2e/**`), plus the unit specs `monolith-cutover.md` lists as missing.

## What was measured

- **Mesh specs, run against the tier.** The 10 in-process mesh specs were copied unchanged into `apps/api-services/shared` (temporary, removed) and run: **10 files, 93 tests pass, 12 are `it.todo`.** Every mesh class they exercise (`MeshConnectionRegistry`, `ServerConnectionConsumerRegistry`, `StreamManagerService`, `MeshSubscriptionManager`, `OwnershipResolverService`, `MeshPartitionPolicy`, `defineResource`, the filter helpers) already lives in `shared`. So porting is an import change, not a behaviour question.
- **Most "e2e" mesh specs are not e2e.** They boot nothing. Only `mesh-containerized-multi-node` starts runtimes.
- **Several assert nothing about our code.** `mesh-event-namespace` and two sections of `mesh-doc-compliance-matrix` (Query Executor, Consumer Patterns) only exercise local mocks, plain RxJS `Subject`s and string splitting. The one file's only imports from our tree are `import type`.
- **`shared` already has**: `mesh-connection-registry.spec.ts`, `mesh-reactive-subquery.spec.ts` (725 lines, covers the same ground as the e2e copy), `mesh-filter.spec.ts`, `mesh-partition-policy.spec.ts`. **No spec exists** for `StreamManagerService`, `MeshSubscriptionManager`, `OwnershipResolverService`, `defineResource` or the `decidePromotion` rule.

## Mesh specs (11)

| # | Spec | Lines | Verdict | Reason |
|---|------|------:|---------|--------|
| 1 | `mesh-shared-stream-store-advanced` | 466 | **PORT, split** | The only coverage of `StreamManagerService` (attach / promote / new paths) and of registry lifecycle events beyond opened/attached (detached, closed, metadata, rapid release/re-acquire, unknown consumer). Becomes `stream-manager.service.spec.ts` plus additions to `mesh-connection-registry.spec.ts`. Its consumer-registry section duplicates the existing spec: drop that part. |
| 2 | `mesh-stream-key-derivation` | 194 | **PORT, merge** | Isolation by node / entity / method is not in the registry spec (it only tests lookup hit and miss). Registry cases go into `mesh-connection-registry.spec.ts`; the `MeshSubscriptionManager` section goes into the new subscription spec (row 5). |
| 3 | `mesh-resource-ownership` | 226 | **PORT, fix** | `defineResource` and `OwnershipResolverService` have no spec. The partition-policy part duplicates `mesh-partition-policy.spec.ts`: drop it. **Fix on port:** the resolver test makes real DNS lookups for `node-a` / `node-b` (`getaddrinfo EAI_AGAIN` in the run), so it is slow offline and can flake. Stub the transport. |
| 4 | `mesh-sse-shared-store` | 90 | **PORT, merge** | Brings the `decidePromotion` attach / promote rule (untested today) into the registry spec. The rest duplicates it. |
| 5 | `mesh-global-resource` | 43 | **PORT** | First and only test of `MeshSubscriptionManager` notify / subscribe / unsubscribe. Becomes `mesh-subscription-manager.spec.ts`. |
| 6 | `mesh-containerized-multi-node` | 115 | **PORT, trimmed** | Misnamed: it tests the *harness* (three isolated instances on distinct ports, per-instance trackers), not mesh. It is the only multi-instance coverage, and the base a real multi-node mesh e2e needs. Move to the BFF e2e, 2 instances instead of 3. This is also where `ARCH-019` (mesh-6 rigs) starts. |
| 7 | `mesh-stream-manager-persistence` | 39 | **DROP** | Open / lookup / attach / release / close: already in `mesh-connection-registry.spec.ts`. |
| 8 | `mesh-promotion-control` | 42 | **DROP** | Strict subset of row 4. |
| 9 | `mesh-reactive-subquery` | 132 | **DROP** | `shared/.../mesh-reactive-subquery.spec.ts` already has a larger "Reactive Subquery Pattern" and connection-sharing block. |
| 10 | `mesh-event-namespace` | 275 | **DROP** | Asserts RxJS `Subject` / `filter` behaviour and a locally defined string-split helper. Type shapes are enforced by `tsc`. It cannot fail because of our code. |
| 11 | `mesh-doc-compliance-matrix` | 692 | **DROP** | A doc checklist that re-asserts rows 1-5 by name, plus Query Executor and Consumer Patterns sections that test inline mocks, plus 12 `it.todo`. Move the 12 todos (unbuilt mesh features) into the roadmap so they are not lost. |

Net: 6 ported (as ~4 new spec files and 2 extensions), 5 dropped, about 1,000 of 2,300 mesh lines carried over.

## Other specs (5)

| # | Spec | Verdict | Reason |
|---|------|---------|--------|
| 12 | `module-contract-surfaces` | **PORT** to `bff/src/e2e` | It pins the public / 401 boundary for health, user, project, service, deployment, analytics, providers, domain, push, nodes. That boundary is now the BFF's, so it is worth keeping. **Change:** drop the `template.list` 404 case: it pins a known-broken "route not mounted" state, and fails the day the route is fixed. Re-verify every path against the tier (the old file already had one stale path). |
| 13 | `module-http-guards` | **DROP** | Same endpoints as row 12, through raw HTTP instead of the oRPC client. A duplicate. |
| 14 | `contract-inspect` | **PORT** (as a unit spec) | Guards that `getInitializeStream` is detectable as an observable by `ObservableLinkPlugin` and that `triggerInitialize` is not. `setupAppContract` still exists in `packages/contracts/bff`. Needs no app and no containers. |
| 15 | `traefik-routing` | **DROP** | Starts the stock `traefik` and `whoami` images and checks Traefik routes a label. It imports no code of ours, so it tests third-party behaviour and needs `docker.sock`. Our Traefik config generation is covered by unit specs. |
| 16 | `debug-compile-full` | **REPLACE** | Compiles the monolith `AppModule` with a mocked env. The need behind it (does the DI graph resolve at boot) is real: the apps' own comments record "Nest can't resolve dependencies" boot failures. The tier already boots a root module in the `fleet`, `runtime`, `identity` and `bff` e2e. **`project` and `health` have none**: add a small boot-and-`/health` e2e for each instead of porting this. |

## Missing unit specs

The monolith specs cannot be ported as they are: the tier classes diverged (Effect-based user and push code, error mappers, domain rules), so these are **rewrites against the tier's classes**, not copies.

| Area | Monolith specs (lines) | Tier today | Proposal |
|------|------------------------|------------|----------|
| user (identity) | controller 193, repository 396, service 260, module 57 | **none** | **REWRITE**: service (Effect, `UserServiceImpl`), `user.error-mapper`, `user.rules`, repository against a stub `DatabasePort`. Skip the module spec (a DI smoke the identity e2e covers). Highest priority: a whole service with no unit tests. |
| analytics (identity) | service 152 | controller + entity specs only | **REWRITE** `analytics.service.spec.ts` (the service is 874 lines vs 721 in the monolith). |
| push (identity) | controller 84, repository 286 | `push.service.spec.ts` only | **REWRITE** controller (with `push.error-mapper`) and repository; cover `push.rules`. |
| service (project) | controller, service, effective-config | all three **already ported** | **None.** The audit's "service" gap is closed. |

## Suggested order

1. Rows 5, 2, 4, 1, 3: the mesh unit specs (cheap, evidence already in hand, they fill real gaps).
2. Row 14, then row 12 (BFF boundary).
3. Missing unit specs: user first, then analytics service, then push.
4. Boot e2e for `project` and `health` (row 16), then row 6.

## Decisions needed

- **Row 6:** port the multi-instance test now, or wait for the real mesh multi-node e2e (`ARCH-019`)?
- **Row 11:** confirm the 12 `it.todo` should move to the roadmap and the matrix be deleted outright.
- **Rows 7-10, 13, 15:** confirm the drops. They are recoverable from git until `apps/api` is removed at step 14, and after that only from history.

## Outcome (2026-10-27)

All rows are done as proposed. New specs, all passing, none of them copies of the monolith's:

| Area | Added |
|------|-------|
| `shared` mesh | `mesh-connection-registry.spec.ts` extended (stream identity, `decidePromotion`, refcount lifecycle, lifecycle events), new `stream-manager.service.spec.ts`, `mesh-subscription-manager.spec.ts`, `ownership-resolver.service.spec.ts` (transport stubbed, no DNS), `mesh-resource-definition.spec.ts` |
| BFF | `module-contract-surfaces` e2e (+ `deployment.triggerFromEvent` anonymous 401), `setup-contract.observable.spec.ts`, `multi-instance` e2e (2 instances) |
| `project`, `health` | `service-boot` e2e each |
| identity `user` | rules, service (Effect, fake repository), error mapper, filters, SQL builder |
| identity `analytics` | `analytics.service.spec.ts` (22 tests) |
| identity `push` | rules, error mapper, repository against **real Postgres** (e2e) |

Not written: a push **controller** spec (the controller is Effect-runtime wiring around the service, which is covered) and a user **controller** spec for the same reason.

### Found while porting (recorded, not hidden)

1. **The BFF could not run any e2e.** Its source imports `@/auth`, `@/config/*`, `@/core/*`, which `createServiceTestConfig` does not alias, and its harness wrapper used a BFF-local path. Cutover step 7 had been marked done without ever running it. Fixed in `bff/vitest.config.mts` and `bff/src/e2e/runtime.ts`; every app's e2e now passes.
2. **`analytics.deploymentMetrics` computed the wrong average**: it passed `0` as the prior-sample count, so a bucket's `averageDeployTime` was the last duration, not the mean. Fixed (per-bucket sample count) with a test.
3. **`@orpc/contract` renamed the iterator helper again** (`getAsyncIteratorObjectSchemasDetails`, takes the schema array); the monolith's `contract-inspect` used a name that no longer exists.
4. **`deployment.triggerFromEvent` is on the BFF's public surface** (and in `/openapi.json`). Unsigned calls are rejected (tested) but it should not be advertised: `ARCH-109`. My earlier note that the BFF does not expose it was wrong.
5. **`health.check` omits the `timestamp` its contract requires**: `ARCH-110`.
6. **`OwnershipResolverService` treats `{ owns: false }` as an owner**, and `watchOwnership` ignores its key: `NET-108`.
