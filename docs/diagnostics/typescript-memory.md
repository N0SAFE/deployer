# TypeScript memory diagnostic — packages now ship `.d.ts`

> **Date**: 2026-10-06
> **Scope**: `v3/` monorepo (Turborepo + Bun workspaces, native TypeScript 7.0.2)
> **Trigger**: `tsc --noEmit` in `apps/api` peaked at **~8 GB RSS**, and VS Code's
> `tsserver` needed `--max-old-space-size=8192` to stay alive.

## TL;DR

The 7–8 GB type-check had three structural causes:

1. **Every package exposed raw `.ts` sources as its `types` entry.** Any consumer
   (each app, each package's `type-check`, each editor project) re-type-checked the
   entire implementation of every package it imports — ~600 files of inference-heavy
   Zod/ORPC/Better-Auth code, re-done per program.
2. **`@repo/api-contracts` could not emit declarations at all** (TS7056: the combined
   21-module router exceeds the compiler's serialization limit), which forced every
   consumer to compile the 232-file contract tree from source.
3. **All projects shared one `.tsbuildinfo` file.** `tsBuildInfoFile: ".tsbuildinfo"`
   in the shared base tsconfig resolves relative to the config that declares it, so
   every project wrote its incremental state to
   `tooling/typescript/config/.tsbuildinfo`. Projects overwrote each
   other, so almost every check was effectively cold (and a mismatched file could
   even skip checking entirely).

Packages now emit declarations to `dist/types/**` and `exports.types` points there.
Measured on `apps/api` (cold, 0 errors):

| | Before | After | Δ |
| --- | ---: | ---: | ---: |
| Type instantiations | 26,033,865 | 18,081,863 | **−31 %** |
| Types | 5,526,642 | 3,644,812 | **−34 %** |
| Compiler "Memory used" | 7,963,387 K | 5,167,516 K | **−35 %** |
| Peak RSS | 8,053,096 KB | 5,980,536 KB | **−26 %** |
| Check time (idle machine) | ~250 s | 12–25 s | **−90 %+** |
| Warm incremental re-check | — (shared/cold) | 1.5 s (`0.004 s` check) | — |

`apps/api`, `apps/web` and `apps/setup` all type-check with **0 errors** against the
declarations. The remaining ~5–6 GB is app-level type inference the declaration
switch cannot remove: instantiating the composed ORPC contract and the Better
Auth `Auth<…>` instance inside `apps/api` (see
[Remaining hotspots](#remaining-hotspots)).

## Methodology

All numbers from identical commands, `--extendedDiagnostics` for compiler counters
and `/usr/bin/time -v` for OS-level peak RSS:

```bash
# apps/api
cd apps/api && rm -f dist/tsconfig.tsbuildinfo   # force a cold check
/usr/bin/time -v ./node_modules/.bin/tsc --noEmit --extendedDiagnostics

# apps/web
cd apps/web && /usr/bin/time -v ./node_modules/.bin/tsc --noEmit
```

> **Time caveat.** The original before-run happened while the machine was swapping
> (3.9 M major page faults, 25 GB swap in use, two `tsserver` processes alive), so
> its 6 m 30 s wall clock is inflated; a later after-run under the same pressure
> took 3 m 12 s. Counter deltas (instantiations/types/memory) and the idle-machine
> check time are the stable comparison.

## Root causes

### 1. `exports.types` pointed at raw TypeScript

Every package export looked like:

```json
"./*": { "types": ["./src/*.ts", "./src/*.tsx"], "import": "./dist/esm/*.mjs" }
```

With `moduleResolution: bundler`, TypeScript follows `types` and adds those source
files to the consumer's program. That made every package's internals part of every
consumer's check — and every editor session. It also meant **no package could be
type-checked from a cold clone without reading all of its dependencies' sources**.

Before-program composition (`--listFiles`, 5,215 files): 3,906 `node_modules`,
731 `apps/api`, 352 `packages/contracts` (232 under `contracts/api`), 123 utils,
93 nest, 10 ui — plus **346 package `src` files pulled in via `exports.types`**,
which are the most expensive per-line code in the repo.

### 2. TS7056 blocked declarations for `@repo/api-contracts`

The old root contract:

```ts
export const appContract = oc.router({ user: userContract, /* 20 more */ });
```

The inferred type of a 21-module router exceeds TypeScript's declaration
serialization limit. `tsc` failed with TS7056 after ~17 s and 3.6 GB, which is why
the old pipeline worked around declarations entirely.

### 3. One shared `.tsbuildinfo` for every project

`tooling/typescript/config/base.json` set:

```json
{ "incremental": true, "tsBuildInfoFile": ".tsbuildinfo" }
```

Relative paths in an extended config resolve from the config that declares them, so
**every workspace project** wrote incremental state to
`tooling/typescript/config/.tsbuildinfo`. Two consequences:

- Interleaved checks (apps, packages, CI) overwrote each other's state, so each
  run invalidated the next — full checks most of the time, which is exactly how a
  type-check "can take up to 7 GB" on every invocation.
- A mismatched state could make the compiler skip checking entirely (observed:
  0 instantiations / 0.004 s check on a supposedly cold run).
- It could also **hide real diagnostics**: after the fix, a cold run of `apps/api`
  surfaced a genuine type error in an e2e spec
  (`contract-inspect.e2e-spec.ts`, `Reflect.get` on a possibly-`undefined`
  schema) that incremental reuse had been masking. Fixed in the same change.

### 4. Compounding: editor `tsserver`

Two VS Code `tsserver` processes were observed — one with
`--max-old-space-size=8192` — each loading the same source-based graph per open
project. Combined with the swap pressure above, the OS was thrashing during
single `tsc` runs.

## What changed

| Area | Change |
| --- | --- |
| `tooling/bin-pkg-build` | New declaration pass (native `tsc`) driven by a generated config `extends`ing the package tsconfig; emits `dist/types/**` + `.d.ts.map`; copies authored ambient `.d.ts`; `--types` flag; `build` = JS + types; `--watch` rebuilds both. Rebuilt as a NestJS + nest-commander CLI (root command, services, variant child), self-built, consumed from `dist/cjs/main.js` |
| Package manifests | `exports.types` → `dist/types/**`; top-level `types` → `dist/types/index.d.ts`; every pkg-build package gets `build:types` (`scripts/normalize-package-exports.ts`, idempotent) |
| `turbo.json` | New `build:types` task (`dependsOn: ["^build:types"]`, outputs `dist/types/**`); `type-check`, `lint`, `compile` depend on `^build:types` |
| Root `package.json` | `build:types` → `turbo run build:types`; `watch:types` → `turbo watch build:types` |
| `@repo/config-typescript` | Removed the shared `tsBuildInfoFile`; each project now writes its own buildinfo (default location, e.g. `apps/api/dist/tsconfig.tsbuildinfo`). `.gitignore` covers `*.tsbuildinfo` |
| `@repo/api-contracts` | No combined router export (TS7056); per-module contracts stay exported |
| `apps/api` / `apps/web` / `apps/setup` | Compose the router locally (`app-contract.ts`), where `declaration` is off |
| `@repo/auth` | Named `ReturnType<…>` annotations on plugin wrappers/factory; explicit `Auth<ReturnType<typeof createAuthConfig<TSchema>>>`; nameable plugin tuples |
| Service contract input | Recursive `children` typed as a named interface (`z.ZodType<ServiceCreateInput, ServiceCreateInputInput>`) so declaration emit keeps the recursion instead of collapsing it to `Record<string, unknown>[]` |
| Recursive entity/contract schemas | `Service`, service subtree, sub-dependencies tree and the dependency filter union typed with named recursive interfaces — zero `elided`/`any`/`unknown` recursion left in any `dist/types` |

## Declaration builds

`turbo run build:types` across all 32 tasks (30 packages + the builder's own JS
build and declarations): **~18 s** cold, cached afterwards. Heaviest packages:
`@repo/api-contracts` 230 declarations/0.4 s, `@repo/auth` 64/≈3 s, `@repo/ui`
88/3.4 s. `@repo/config-eslint` keeps its custom bundler for JS and uses pkg-build
for declarations.

The builder itself (`@repo/pkg-build`) is a NestJS + nest-commander CLI, built
with its own pipeline. Consumers execute its **built** CLI
(`dist/cjs/main.js`): bun resolves `tsconfig.json` from the cwd, so running the
CLI source under a consumer's tsconfig drops its decorators. Turbo orders
`@repo/pkg-build#build` before `build:types` via an explicit task dependency.

## Type completeness after the switch

Emitted declarations can silently degrade some inferred types. The remaining
degradations were found by scanning `dist/types` and fixed:

| Degradation | Where | Fix |
| --- | --- | --- |
| `ZodObject<elided>` — anonymous recursive getter collapsed to `any` | `Service.children`, service subtree contract, sub-dependencies tree | Named recursive interfaces + `z.ZodType<Out, In>` annotation (zod's documented recursive-type pattern) |
| `ZodType<unknown, unknown>` — bare annotation erased a union | `ServiceDependencyTargetFilter` | Explicit recursive union interfaces (`DependencyTargetFilterNode` / `…Builder` / inputs) |

Result across every `dist/types`: **0 × `ZodObject<elided>`, 0 × `ZodObject<any>`,
0 × `ZodLazy<ZodType<unknown>>`**. `api`, `web` and `setup` type-check green with
the tightened types — the source code was already written against the precise
shapes.

One intentional artifact remains: non-CRUD contracts built through
`standard.zod(outputSchema, …)` expose an internal
`ZodObjectSchemaOf<{ id: ZodType<unknown> }>` placeholder for the entity-id
extraction. It does not affect handler input/output inference; tightening it
means giving the builder an explicit entity-shape parameter.

## Remaining hotspots

A `--generateTrace` run on `apps/api` (5193 files, 744 k named types) shows where
the remaining compiler memory goes:

| Symbol family | Type instances | Share |
| --- | ---: | ---: |
| `__type` (anonymous object literals) | 110,715 | 15 % |
| Zod (`$ZodType`, `ZodType`, `_ZodType`, `ZodObject`, `$ZodObject`, `$ZodTypeInternals`, …) | ~300,000 | ~40 % |
| Drizzle query builders (`PgSelectQueryBuilderBase`, `QueryPromise`, `TypedQueryBuilder`, `Column`, …) | ~20,000 | ~3 % |
| React (`Props`, `Promise`, …) | ~30,000 | ~4 % |

Conclusions:

1. **Zod is the dominant remaining cost.** Every `@Implement(contract.x.y)` and every
   `RouterContractClient<AppContract>` instantiation expands zod schemas across all
   21 modules. Reducing it means narrowing what the app instantiates (per-domain
   clients, explicit output schemas), not more declaration work.
2. **App-level router composition** (`app-contract.ts` in each app) is inherent to
   the single typed client. Splitting per domain would remove it at the cost of one
   client type per domain.
3. **Better Auth instance type** — `Auth<ReturnType<typeof createAuthConfig<TSchema>>>`
   is precise (needed for session fields) but expensive; a narrower exported session
   interface could cap it.
4. **`node_modules` declarations** — ~3,900 files (bun-types, vitest, next).
   `skipLibCheck: true` already caps the cost.
5. **Editor + CLI concurrency** — `turbo` runs with `concurrency: 40`; several
   simultaneous `tsc`/`tsserver` programs can still exhaust 14 GB. With per-project
   buildinfo now fixed, `watch:types` + incremental checks replace most full runs.

## Verification

```bash
# declarations for everything (dependency-ordered, cached)
bun run build:types

# keep them current while editing
bun run watch:types

# cold type-check an app against declarations
cd apps/api && rm -f dist/tsconfig.tsbuildinfo && ./node_modules/.bin/tsc --noEmit
```
