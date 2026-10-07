# TypeScript type-check optimization — proposals for `apps/api` and `apps/web`

> **Date**: 2026-10-06
> Companion to [`typescript-memory.md`](./typescript-memory.md) (the diagnosis).
> All numbers are native TS 7.0.2, cold runs with per-project buildinfo deleted.

## Where we are

| Target | Files | Symbols | Types | Instantiations | Compiler mem | Peak RSS | Check |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `apps/api` | 5,193 | 10.1 M | 3.70 M | 18.5 M | 5.25 GB | 5.98 GB | ~12 s |
| `apps/web` | 3,886 | 6.82 M | 2.60 M | 12.1 M | 3.71 GB | 4.46 GB | ~10 s |
| `apps/setup` (tiny app) | 2,808 | 4.99 M | 1.82 M | **7.87 M** | 2.59 GB | 3.07 GB | ~5 s |

The setup number is the important one: an app with a handful of files still
spends **7.9 M instantiations / 2.6 GB**. But probes (see
[Correction](#correction-the-shared-types-are-cheap-to-reference)) show that is
its **own usage code**, not the imported types — merely referencing the router or
auth types costs almost nothing. The shared declarations are large (9 MB) and
every consumer must load and bind them, and check its ~700 usage sites against
them.

### What the types actually are

- `packages/contracts/api/dist/types` is **9 MB** of declarations; single files:
  `docker/index.d.ts` **814 KB**, `deployment/index.d.ts` 445 KB,
  `template/index.d.ts` 373 KB, `mesh/index.d.ts` 307 KB, `service/index.d.ts` 297 KB.
  (`contracts/entities` 3 MB, `nest/schema` 2 MB.)
- **281** `standard.zod(...)` call sites in the contracts, **16**
  `createFilterConfig(...).withFiltering(...)` chains.
- **339** `@Implement(...)` and **351** `implement(...)` call sites in `apps/api`.
  Every one instantiates a `ProcedureContract<z.ZodObject<…the 814 KB shape…>>`.
- Trace of a full `apps/api` check (744 k named types): **Zod family ≈ 40 %**,
  anonymous object literals (`__type`) 15 %, Drizzle query builders ≈ 3 %,
  React ≈ 4 %.

In short: the declaration switch removed *re-compiling package implementations*,
but the apps still **instantiate the serialized zod/builder types** hundreds of
times, and those types were never designed for cheap instantiation.

## Correction: the shared types are cheap to *reference*

Probes changed the model. A tiny program that only **uses** the shared types costs:

| Probe (setup) | Files | Symbols | Instantiations | Memory |
| --- | ---: | ---: | ---: | ---: |
| `Awaited<ReturnType<typeof betterAuthFactory>>['auth']['$Infer']['Session']` | 1,367 | 190 k | **13,498** | 169 MB |
| `RouterContractClient<AppContract>` | 499 | 90 k | **29** | 78 MB |
| import-only (no use) | — | — | 0 | — |

So the 7.9 M instantiations in `setup` are **not** the router/auth types — they are
the app's own **usage sites**: `implement(...).use(...).handler(...)` per
procedure, React components, `react-hook-form` + `zodResolver`, TanStack query
hooks, and the app's own Zod schemas. Importing/passing those types around is
almost free; *checking the code that uses them* is the cost.

Consequences for the proposals below: P1 (shrink declaration types) and P3
(narrow auth) help less than assumed; P2's split is only useful if it does not
re-check the app in the test program, which requires project references (P6).

## Measured quick wins (cold `apps/api`)

| Variant | Instantiations | Compiler mem | Peak RSS | Check |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 18.52 M | 5.25 GB | 5.98 GB | ~12 s |
| app config (specs/e2e excluded) | 16.85 M (−9.0 %) | 4.71 GB | 5.60 GB | ~15 s |
| app config, `vitest/globals`+`vite/client` dropped | 16.68 M (−9.9 %) | 4.69 GB | 5.42 GB | ~10 s |
| **spec config alone** | **18.35 M** | **5.18 GB** | 6.33 GB | ~14 s |
| spec only, `vitest/globals` trimmed | 17.56 M | 4.95 GB | 5.82 GB | ~10 s |

The app config is genuinely lighter, but the test program pulls all of `src`
through imports, so **checking app + tests as two programs is ~2× the work of one
full run** (16.9 M + 18.4 M ≈ 35 M vs 18.5 M single). With the constraint that a
single `type-check` command must check everything, the split is a regression and
was reverted.

## Implemented

### P7 — editor: use native TypeScript (tsgo) *(local setting)*

`.vscode/settings.json` had `"js/ts.experimental.useTsgo": false`, so VS Code ran
its **bundled JavaScript tsserver** (observed at `--max-old-space-size=8192`).
Set to `true` so the workspace's native TypeScript 7 serves edits. This is the
single biggest editor-memory lever; `.vscode/` is gitignored, so it is a local
change. If TS plugins (Copilot TS, MDX, goto-alias) misbehave, flip it back and
rely on the program-level teardown instead.

## Findings on the rest (measured, then dropped)

- **Latent error surfaced by the buildinfo fix** — the first cold run after the
  optimization experiments failed on `contract-inspect.e2e-spec.ts`
  (`Reflect.get` on a possibly-`undefined` schema). Incremental reuse had been
  masking it; fixed with a narrowing guard. Expect more of these to appear on the
  first cold check after any buildinfo change.

- **P2 split type-checking** — reverted: with one coverage-complete `type-check`
  command, the test program re-checks the app (18.4 M) and total work doubles.
  Only viable with project references that avoid re-checking (see P6).
- **P5 deep contract imports** — no gain in this program. `core/orpc/app-contract.ts`
  composes all 21 modules and is part of `src/**`, so every module declaration is
  loaded regardless of how controllers import. Would only pay off if the composer
  left the main program (P6 territory).
- **P6 project references** — not feasible as-is. `tsc -b` requires `composite`
  projects that **emit declarations**, and both apps must not emit (their ORPC
  types hit TS7056 — that is why `apps/web/tsconfig.json` disables `declaration`).
  A real solution means splitting the apps into declaration-safe libraries.
- **P3 narrow Better Auth type** — probe says referencing the auth type costs
  ~13 k instantiations (≈0.2 % of `setup`), so a hand-written session interface
  would add drift risk for little reduction. Dropped unless a concrete hot use
  site is found.

## What actually moves the needle

The remaining cost is **checking app usage sites** against very large types, so
the effective levers are:

### P1′ — Give `implement(...)` / hooks explicit input-output types *(high, larger effort)*

Every `implement(contract.x).use(...).handler(({ input }) => …)` re-derives the
input from the builder's deep generics. Export a named `XInput`/`XOutput` per
operation (contracts already export some) and annotate handlers/hooks with them,
so the checker uses a named type instead of expanding the builder chain. Pilot on
one module (`docker` or `deployment`, the 814 KB/445 KB declarations), measure
with `--extendedDiagnostics`, then decide on rollout.

### P4 — Explicit Drizzle return types *(low effort)*

Repository methods returning `Promise<PgSelectQueryBuilderBase<…>>` leak generic
chains into callers; annotate `Promise<Row[]>` / `Promise<Row | undefined>`.

### P8 — Ops *(low effort)*

Cap type-check concurrency (currently 40, lets several 5 GB programs swap), keep
`watch:types` + per-project buildinfo, and prefer the editor fast path (P7).

### P9 — Smaller spec/e2e payloads *(low effort, needs product decision)*

The heaviest single exclusion is the test + e2e surface (−9 % when excluded from
one program). If tests stay in the one `type-check`, the only safe trim is
removing single-use global type packages — not worth it. Alternatively move
integration/e2e tests that need `testcontainers` into a workspace package so the
app program stops carrying them; the app `type-check` then naturally covers only
app code.


## Suggested order

1. **P1′** — pilot named input/output types on one heavy module (`docker` or
   `deployment`), measure cold before/after, then decide on rollout. This is the
   only lever that targets the real cost (app usage sites).
2. **P4** — explicit Drizzle return types (local, low risk).
3. **P8** — ops guardrails (cap concurrency; keep `watch:types` + per-project buildinfo).
4. **P9** — move testcontainers-heavy e2e tests out of the app program (product call).

## How each proposal is measured

```bash
# cold per project
rm -f apps/api/dist/tsconfig.tsbuildinfo
cd apps/api && /usr/bin/time -v ./node_modules/.bin/tsc --noEmit --extendedDiagnostics

# per-proposal comparison: watch Files / Symbols / Types / Instantiations /
# "Memory used" / Check time, then apps/web and apps/setup for cross-checks.

# editor
# compare VS Code process RSS with useTsgo true/false on the same file set.
```
