# AGENTS.md — contract packages

Contracts define the oRPC procedures each part of the system serves. They are the
boundary between a producer (a service, or the BFF) and its consumers.

## The packages

| Package | Owner | Serves |
|---|---|---|
| `@/` | — | Entity (Zod) schemas. The lowest layer; no routers. |
| `@deployer/contracts-common` | — | Schemas shared across domains (environments, providers, runners). |
| `@deployer/identity-contracts` | `svc-identity` | `user`, `push`, `analytics` |
| `@deployer/project-contracts` | `svc-project` | `project`, `service`, `domain` |
| `@deployer/runtime-contracts` | `svc-runtime` | `deployment`, `docker` |
| `@deployer/fleet-contracts` | `svc-fleet` | `cluster`, `nodes`, `providers`, `provider-schema`, `reachability`, `mesh`, `platform`, `events` |
| `@deployer/health-contracts` | `svc-health` | `health` |
| `@deployer/bff-contracts` | `svc-bff` | `setup`, `test`, `template` — the procedures the BFF owns outright |

## Dependency direction (no cycles)

```
contracts-entities  ->  <service>-contracts  ->  bff-contracts
```

A service imports **only its own** contract package. `apps/api/services/identity/src`
importing `@deployer/fleet-contracts` would mean the identity service is coupled to a
surface it does not serve — that is the coupling this split exists to remove.

The BFF is the one exception, by design: it composes every service's contract into its
public router, so it depends on all of them. See
`apps/api/bff/src/orpc/app-contract.ts`.

## Why the packages are split

They used to be one `@/`, which meant:

- a service could import a contract it does not implement, and the compiler would not
  object;
- **the public surface could drift from what any service actually serves**, with no
  single place to notice;
- renaming a procedure touched one package that every consumer depended on, so an
  unrelated app's type-check failed for a change it had nothing to do with.

One package per service makes the contract package the service's published interface:
it is what the service serves and nothing more.

## No combined router in a package

Each package deliberately exports its modules **individually**, not a combined router.
The inferred type of a 23-module router exceeds TypeScript's declaration
serialization limit (TS7056), which would block declaration emit for the package.

Consumers that need the full surface compose it locally, where `declaration` is off:

| Consumer | Composition |
|---|---|
| `apps/api/bff` | `src/orpc/app-contract.ts` |
| `apps/web` | `src/lib/orpc/app-contract.ts` |
| `apps/setup` (retiring) | `src/views/lib/app-contract.ts` |

Application code that needs ONE contract (controllers, services) imports that
module's contract directly — never a composed router.

## Adding a procedure

1. Add it to the module in the owning service's package (e.g.
   `packages/contracts/identity/modules/user/`).
2. Implement it in that service (`apps/api/services/identity/`). A controller binds the
   contract with `@Implement`; the service holds the rule.
3. Add it to the BFF's composed router if it should be publicly reachable.
4. Update `docs/ORPC-TYPE-CONTRACTS.md`.

## Scripts

```bash
bun run --bun <package> -- type-check
bun run --bun <package> -- test
```
