# AGENTS.md — @repo/api-contracts

Contracts define ORPC interfaces and shared types used by API and Web.

## Quick Context via MCP
- `repo://package/@repo/api-contracts/package.json`
- `repo://package/@repo/api-contracts/dependencies`
- `repo://graph/used-by/@repo/api-contracts` (expect apps to depend on it)

## Rules
- Backward-compatibility is critical. Coordinate changes with `apps/api` and `apps/web`.
- Update `docs/ORPC-TYPE-CONTRACTS.md` when adding/modifying contracts.
- Use MCP for impact analysis before changes:
	- `repo://graph/used-by/@repo/api-contracts` to list dependents
	- `list-internal-dependencies { targetName: "@repo/api-contracts" }` for graph context

## Router composition (no root `appContract` export)

This package exports **each module contract individually** (`userContract`,
`deploymentContract`, …). It deliberately does **not** export a combined
`appContract`: the inferred type of a 21-module router exceeds TypeScript's
declaration serialization limit (TS7056), which blocks declaration emit for the
whole package.

Each application composes the full router locally, where `declaration` is off:

| App | Composition |
| --- | --- |
| `apps/api` | `src/core/orpc/app-contract.ts` (`appContract`, `AppContract`) |
| `apps/web` | `src/lib/orpc/app-contract.ts` |
| `apps/setup` | `src/views/lib/app-contract.ts` |

Keep those entry lists in sync with `modules/index.ts`. Application code that
needs one module (controllers, services) should import that module's contract
directly — not a composed router.

## API module ↔ contract module mapping

Contract directory names intentionally do **not** always match `apps/api/src/modules/<name>/`.
Do not "fix" a mismatch by renaming either side — check this table first.

| `apps/api/src/modules/` | `packages/contracts/api/modules/` | Why they differ |
|---|---|---|
| `fleet` | `nodes` | The API module is named for what it manages (the fleet of servers); the contract key is `nodes` (the composed router’s `nodes` key). Documented in `index.ts` next to the `nodes:` entry. |
| `runners` | *(none)* | Pure service/strategy module — build and runtime runner implementations (`nixpacks`, `railpack`, `buildpack`, `dockerfile`, `docker`, `docker-compose`, `swarm`). Registered as providers, never as a route. A module having no contract is correct here, not missing. |
| `permission` | *(none)* | Repositories + services only; permissions are consumed through the auth layer rather than exposed as their own route table. |
| *(none)* | `mesh` | The contract exists without a matching product module because its controller lives in `apps/api/src/core/modules/mesh/`. Likewise `events` (`coreEventStream*`) lives in `core/`. |
| *(none)* | `template` | Registered in the composed app router but has **no implementation anywhere** in `apps/api`. See below. |

### Two contract modules that are registered but not fully wired

- **`template`** — registered as the composed router’s `template` key with 16 operations, and zero implementations
  (no controller, no service, no repository anywhere under `apps/api/src`). Unimplemented routes in the
  public contract.
- **`events`** — a complete, implemented contract (`coreEventStreamListContract`,
  `coreEventStreamFindByIdContract`, and the `streamSync` observable) that is **never mounted**:
  `eventSyncContract` is referenced by nothing outside its own `index.ts`, and it is absent from
  every app's composed router. Unreachable rather than unimplemented.

Both are tracked in `docs/implementation-plan-200.md` as P2-2 and P2-3, pending a decision to implement
or delete.

## Scripts
- Type-check: `bun run @repo/api-contracts -- type-check`
- Test: `bun run @repo/api-contracts -- test`
