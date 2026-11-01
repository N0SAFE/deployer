# Duplication audit — 2026-11-01

Scope: every app (`apps/api/services/*`, `apps/api/bff`, `apps/setup`) and every package. Four independent read-only
sweeps (pure helpers, Nest/Effect plumbing, infra clients, domain rules), then the three cheapest high-value extractions
were implemented and verified. Everything else is ranked below as backlog.

## 1. Extracted in this pass

| Duplicate | Copies | Now |
|---|---|---|
| Non-empty-string coercer (`asNonEmptyString`, `asNullableString`, `toNonEmptyString`, `toOptionalNonEmptyString`) | 4 named + 12 inline, 3 apps | `nonEmptyString(value: unknown): string \| null` in `@deployer/type-guards`, next to the existing `isNonEmptyString` predicate |
| `DEFAULT_NODE_ID` + `resolveNodeId` | 4 byte-identical, 3 apps | `@deployer/env` (`src/node-id.ts`); the outbox's `nodeId`-first branch stays at its call site |
| Service catalog (`API_SERVICES`, `apiServicePort`, `apiServiceUrl`, `API_SERVICE_PORTS` parsing) + name rule | 2 implementations, one wrong | `@deployer/env` (`src/services.ts`) + `apiServiceName(name, prefix)`; `apps/api/shared/src/server/service-address.ts` deleted, 12 importers moved; setup's hardcoded `3101…3105` map and its `?? 3101` fallback are gone, and an unknown tier app is now a compile error |
| Credential digest + `timingSafeEqual` | 2 (node-agent) | node-agent calls `credentialVerifier` from `@deployer/mesh/server`; rotation grace unchanged |
| `primaryLanAddress` (interface filter + sort) | 2, with a `ponytail:` note asking for it | one export in `@deployer/node-agent-container`; node-agent imports it |

Verification: root type-check 116/116, `check:di-graph`, `global-modules`, `di-graph:cycles` green;
type-guards 2, config/env 102, agent-container 5, mesh/server 19, shared 859, setup 162, bff 51, node-agent 343,
project 181, runtime 528/530 (the two known docker/scanner e2e).

## 2. Backlog, ranked by drift blast radius

1. **Ingress "is this host routed?" probe** — 4 implementations with three different timeouts and three candidate
   lists: `packages/platform-supervisors/src/managed-web/route-probe.ts:36`, `setup/.../bootstrap-ingress.service.ts:449`,
   `setup/.../handover-orchestrator.service.ts:503`, `bff/.../post-setup-verification.service.ts:46`. It gates the
   handover success verdict; a divergence is a false "no router" or a false pass. One `probeIngressRoute({host, path,
   candidates, timeoutMs})` next to the engine primitives.
2. **`setupState` vocabulary + "is this node configured"** — 3 enum declarations (`nest-schema/node-config.ts:16`,
   `contracts/node-agent/node/state.ts:16`, `shared/src/server/node-status.ts:23`, plus a stale 4th in
   `contracts/entities/.../setup/state.schema.ts`) and 5 predicate variants that disagree on `configuredAt` without
   `databaseUrl`. Owner: contracts (enum) → `@deployer/node-state` (`isNodeConfigured(row)`).
3. **Node-state verdict / exit codes** — `shared/src/server/node-status.ts:75-137` (`deriveNodeState`,
   `exitCodeForState`) has **zero callers**; the live contract is
   `bff/src/cli/commands/node-startup-check.command.ts:89-213`, and the two disagree on what `1` means. Either delete
   the shared table or make the CLI call it.
4. **Preview naming (web vs API)** — `apps/web/.../previewUrl.ts:16` re-implements the preview hostname with
   `Math.imul` hashing and the `branch` strategy, while the server
   (`shared/.../preview-naming.service.ts:56`) uses `sha256(seed).slice(0,7)` and rejects `pr` without a number. The page
   renders a URL that does not match the deployed host. Fix by returning the host from the API rather than recomputing it.
5. **Swarm init options** — `packages/swarm/.../swarm-participation.ts:119` falls back to `127.0.0.1`, while
   `setup/.../swarm-bootstrap.service.ts:122` refuses loopback and resolves a real interface. That is the exact bug the
   setup comment documents breaking overlays.
6. **`/proc/net/route` + `primaryLanAddress`** — 3 parsers (`packages/docker/src/client/host-address.ts:25`,
   `setup/.../swarm-bootstrap.service.ts:187-261`, `setup/.../bootstrap-ingress.service.ts:892`) and 4 mesh-address
   readers.
7. **`describeError` / `formatError`** — 11 named copies and ~177 inline ternaries in 125 files; `@deployer/errors`
   already exports `getErrorMessage` and is used by none of the API tier. Largest payoff, purely mechanical.
8. **`ServiceClient` duplicated** — `apps/api/shared/src/server/service-client.ts` is a functional subset of
   `@deployer/service-client` (no caller credentials, no date revival, no error normalization), and both are live.
9. **Project access rule** — `shared/.../project-access.service.ts:22` owns it; `runtime/.../deployment.service.ts:326`
   re-implements it plus a platform-role bypass; the role list `["owner","maintainer","deployer"]` is written ~12 times.
10. **Pagination/sort glue** — three invalid-sort policies (throw / `createdAt` / `updatedAt`) and three default page
    sizes. Move `toPage(...)` and `readSortField(value, allowlist, fallback)` beside the contract schemas.
11. **Mesh/peer status composition + join-token wrappers** — 3 shapes from the same two door calls
    (`setup/.../mesh-onboarding.service.ts:37`, `fleet/.../ingress-edge.service.ts:148`, `fleet/.../mesh-view.service.ts:35`).
12. **`main.ts` boot tail** — 6 copies of the `DependencyNotReadyError` catch, exit codes and mesh-join/close hook.
13. **Health probes / DB probe** — 5 implementations; the BFF controller in the same app as `DatabaseProbeService`
    does its own `Pool` + `SELECT 1`.
14. **`withTimeout`** — 2 byte-identical copies (shared node-record client, mesh client node-door) and a web copy that
    leaks its timer.
15. **Signed-token envelope** — `shared/.../system-actor.ts` and node-agent `lease-token.ts` hand-roll the same
    `<b64url(json)>.<b64url(hmac)>` + `timingSafeEqual` shape with different key derivation.

## 3. Rule of thumb applied

Extract when a rule would make two apps disagree **silently** (ports, hostnames, setup state, preview URLs). Leave
alone when the copies are three lines of obvious code in one app (`{ provide: X, useValue: X.live }`, per-app database
tags, single-field `typeof` guards) — the indirection costs more than the duplication.
