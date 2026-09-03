# Whole-Application Enhancement Audit — Final Deliverable

**Date:** 2026-08-12 · **Method:** Deep Analysis Resolution Loop (4 waves, 3 review cycles, hard ceiling reached) · **Scope:** entire deployer monorepo (apps api/web/doc/load-balancer, packages, infra, docs)

**Evidence tags:** [LOOP-FACT] verified in-loop · [ESTIMATE] floor/inference · [PRIOR-EVIDENCE] anchored from earlier work, not re-verified

---

## 1. Executive Summary (ranked enhancements)

1. **[HIGH] Type-escape remediation** — 6 production `@ts-ignore` + ≥4 `@ts-expect-error` + ~30 production files with `as unknown as`/`as any` (mesh/auth/docker hotspots). Violates the repo's zero-assertion rule. All individually remediable with Zod parse / `satisfies` / typed adapters.
2. **[HIGH] SC2 contract error-compliance gap** — only 3 `.errors()` call sites in `packages/contracts/api`, ALL in `mesh/`; 25 of 26 non-mesh module dirs declare none. Typed client error handling (`error.code`, `error.data`) is effectively absent outside mesh.
3. **[MED] SC4 export-surface + catalog drift** — 6 wildcard-export packages (string-form ×4: contracts/api, contracts/common, contracts/entities, configs/typescript; object-form ×2: types, ui/base) + 2 verified catalog-drift instances (`zod ^4.3.6`, `tailwindcss ^4.1.16`).
4. **[MED] Env-read sprawl** — 17 verified `process.env` reads outside the `#/env` consolidation (setup-wizard, api-url, utils, masterTokenClient, layout, error fallbacks, WithEnv); "13 was a floor not a ceiling".
5. **[MED] Unwired events contract** — `eventSyncContract` defined once, zero consumers, absent from `appContract`; events domain has no typed ORPC client surface. Wire-or-delete decision required.
6. **[MED] Web conformance** — 2 DUPLICATED raw `fetch("/api/auth/sign-in/email")` bypasses in setup flow (+ double type assertion), 1 empty `catch {}` (file-upload-link.ts:193), 12 unlinked `it.todo()`.
7. **[LOW] Zero-consumer packages** — `@repo/runthenkill`, `@repo/config-schema` (2 of 24) violate the "every package needs ≥1 consumer" rule.

**Clean verdicts:** hardcoded `href` bypassing declarative routes = ZERO production hits; `console.*` = effectively clean (1-2 stragglers); `@ts-expect-error` in vendored declarative-routing assets is ambiguous-but-pinned.

---

## 2. Verified Findings

### F1 — Type escapes [LOOP-FACT]

**`@ts-ignore` — 6 occurrences / 5 files:**

| File:line | Context |
|---|---|
| `apps/api/scripts/build.ts:135` | build script |
| `scripts/init.ts:5` (repo ROOT) | `prompts` lacks TS declarations |
| `packages/ui/base/src/components/data-table/utils/export-utils.ts:192` | minified import fallback |
| `packages/bin/declarative-routing/assets/qwikcity/hooks.ts:44` | vendored asset |
| `packages/bin/declarative-routing/assets/react-router/makeRoute.tsx:353,356` | vendored asset |

**`@ts-expect-error` — ≥4 production:** `apps/api/scripts/build.ts:8`, `packages/utils/auth/src/permissions/system/builder/builder.ts:186`, `packages/utils/auth/src/server/plugins/invite.ts:148`, `packages/utils/orpc/src/types/type-helpers.ts:220`.

**`as unknown as` — 133 hits / 45 files (~30 production):** hotspots `core/modules/mesh/services/base-mesh.service.ts:524,529,580,621,631,659,707`, `core/modules/auth/services/auth-core.service.ts:256,257,503,506,535,538,627`, `modules/docker/repositories/facade/docker.repository.ts:2133,2143,2149,3943`, `config/env/env.service.ts:68`, `core/gateway/gateway.module.ts:112`.

**`as any` — 279 hits / 41 files (~8 production):** `mesh-resource.controller.ts:25` (`@Implement(meshBaseResourceContract as any)` — defeats ORPC typing at the boundary), `mesh-resource-service.ts:87`, `deployments.mesh.service.ts:29`. NOTE: `mesh-entity.ts:208-211` are TYPED casts (`as AnyMeshQuery`), NOT `as any` — the real assertion there is `as unknown as` at `:204`.

**Non-null `!` (~10-15 production):** `mesh-version.service.ts:153`, `orchestrator.service.ts:98,124`, `deployer-version.ts:42`, `docker-runtime-mesh-relay.service.ts:72`, `docker-container-resolution.service.ts:231`, `reachability.service.ts:112`.

### F2 — Unwired events contract [LOOP-FACT]

`eventSyncContract` defined once at `packages/contracts/api/modules/events/index.ts:73`; ZERO consumers; NOT mounted in `appContract` (`packages/contracts/api/index.ts:27-52`, no `events:` key). API/web call `CoreEventSyncService` directly (mesh.controller.ts:8,35; deployment.service.ts:17,190,207; project.service.ts:14,37,39; service.service.ts:10,63,69). **Decision table:**

| Branch | Action | F4 SSE risk applies? |
|---|---|---|
| **Wire** (SSE/Observable push) | keep-and-harden: Zod coerce in producer, re-emit parsed chunks, add typed web hooks | ✅ YES — deferred-value/stable-ref discipline |
| **DB/offline** | keep with validation, or delete if dead | ❌ No stream pressure |

### F3 — Env reads (13 → 17) [LOOP-FACT]

Added: `components/error/DefaultErrorFallback.tsx:37`, `FeatureErrorFallback.tsx:50`, `QueryErrorFallback.tsx:37`, `middlewares/WithEnv.ts:17,45,57`. **Count is a floor [ESTIMATE], not exhaustive.**

### F4 — Web conformance [LOOP-FACT]

- Raw fetch bypasses (DUPLICATED): `apps/web/src/components/setup/steps/complete-step.tsx:32` + `progress-step.tsx:177` — both `fetch("/api/auth/sign-in/email")` + double assertion at complete-step.tsx:39.
- Hardcoded `href`: **ZERO** production hits (clean).
- `process.env` outside `env.ts`: 17 verified (9+ raw unvalidated).
- Empty `catch {}`: 1 — `apps/web/src/lib/orpc/links/file-upload-link.ts:193`.

---

## 3. SC2 — Contract `.errors()` Compliance [LOOP-FACT]

Exactly **3** `.errors(` call sites, ALL mesh: `modules/mesh/index.ts:357,379`, `mesh-base-resource.contract.ts:41`. 25 of 26 non-mesh module dirs declare none (bare `.create().input().build()`). **Remediation recommended:** bulk-pass spreading `meshDomainErrorContracts(error)` into each non-mesh contract (~25 files, one atomic PR).

## 4. SC4 — Wildcard Exports + Catalog Drift [LOOP-FACT]

**String-form `"./*"`:** contracts/api:12, contracts/common:10, contracts/entities:10, configs/typescript:7. **Object-form:** types:5, ui/base:19. **Catalog drift:** `apps/web/package.json:108` `"zod": "^4.3.6"` (catalog `^4.0.0`), `packages/configs/eslint/package.json:70` `"tailwindcss": "^4.1.16"` (catalog `^4`). Depth caveat: only 2 instances verified — full sweep unactioned.

## 5. SC7/SC8 — Hygiene [LOOP-FACT]

- `it.todo()` = **12**, all in `apps/api/src/e2e/mesh-workflows/mesh-doc-compliance-matrix.e2e-spec.ts:680-691` — no tracking-issue links.
- `console.*` = **effectively clean** (1-2 stragglers: `console.warn` at `apps/api/src/core/modules/database/shared/database.service.ts:51`, `console.log` in `apps/api/src/cli/commands/node-startup-check.command.ts:82`).
- Empty `catch {}` = 1 (file-upload-link.ts:193).

---

## 6. Unresolved Gaps (rejected-not-negated — cycle ceiling 3/3)

1. **SC1 per-module API cards** — unexplored-not-negated; no evidence either way.
2. **SC3 web per-page breadth** — sampling only; full breadth unexplored.
3. **SC5 docs conformance** — not performed; known drift risk in `docs/`.
4. **SC6 infra/CI** — out of budget; unexplored.
5. **SC7 test-DX depth** — beyond the 12 `it.todo()` count, unassessed.
6. **Vendored-asset classification** — declarative-routing assets: ambiguous (runtime-shipped but not maintainer-authored); recommend pin + document exception.
7. **Catalog-drift depth** — only 2 instances verified; more may exist.
8. **Unactioned SPAWN_REQUESTS** — deferred by ceiling.

---

## 7. Review & Loop Log

- **Review cycles:** 3/3 (hard ceiling). Completeness 6/10 → accuracy 9/10 → coherence 5/10 → gatekeeper NEEDS_REWRITE (8-item brief) → single rewrite pass applied (2 evidence-forced overrides: console.* softened to "effectively clean", mesh-entity cast range corrected to :208-211).
- **Strategist checkpoints:** D-START-01 (9 scouts) → D-CP-02 (6 Explore retry) → D-CP-03 (4 narrow search_subagent — SUCCEEDED) → DS-POST-WAVE-3 (SYNTHESIZE) → CP-3-FINAL (REWRITE → DELIVER-with-gaps).
- **Tooling lesson:** `scout`/`Explore` agent types with large scopes fail to return; narrow-scope `search_subagent` with ≤800-word output contracts works reliably. Findings-to-file mitigation failed (sandbox blocks /tmp).
- **Mission ledger:** phase-0 pair (planner, curator) ✅ · 9 scouts ✗ (tooling) · 6 Explore ✗ · 4 search_subagent ✅ (F1-F4) · synthesizer ✅ ×2 · 3 reviewers ✅ · gatekeeper ✅ · strategist ✅ ×5.

---

## 8. Confidence & Evidence Map

| Claim | Tier | Source |
|---|---|---|
| Type-escape inventory | [LOOP-FACT] | reviewer-accuracy + gatekeeper verification, file:line |
| SC2 `.errors()` 3 sites / 25-26 bare | [LOOP-FACT] | completeness reviewer grep |
| SC4 wildcards + 2 catalog drifts | [LOOP-FACT] | completeness reviewer |
| Env reads 17 (floor) | [LOOP-FACT] / [ESTIMATE] | accuracy reviewer + synthesizer |
| `eventSyncContract` orphan | [LOOP-FACT] | wave-3 F1 grep |
| Zero-consumer packages | [LOOP-FACT] | wave-3 F2 |
| projects/* enhancements (4 batches) | [PRIOR-EVIDENCE] | session history |
| Web 127 / API 432 baselines | [PRIOR-EVIDENCE] | session history |
