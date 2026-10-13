# AGENTS.md — @deployer/nest-service-client

Read the root `AGENTS.md` first. This file adds rules specific to this package.

## What this package is

A NestJS module that turns an oRPC **contract** into a bound, typed client, so a
consumer writes `identityService.getById(...)` instead of threading a link and a
path through every call.

```ts
class IdentityService extends BaseClient<typeof identityContract> {
  constructor() {
    super({ contract: identityContract });
  }
}
// then:
await identityService.user.getById({ ... });
```

## The two moving parts

| Piece | Job |
|---|---|
| `BaseClient` | Copies a contract's **leaf** procedures onto the instance as bound, non-enumerable methods, keyed by their path in the router. |
| `ServiceClientRegistry` | Caches one client per service, and sets auth headers **per request** via a fetch hook rather than per client. |

## Rules

- **Flattening is contract-driven, never client-driven.** The oRPC client is a
  `Proxy`: `typeof client === "function"`, `Object.keys(client) === []`, yet
  `client.nested.deep` resolves. Walking that object yields nothing, so the leaf
  list must come from the contract (`collectContractLeaves`).
- **Bound methods are non-enumerable.** They are attached with
  `Object.defineProperty`, so spreading or `JSON.stringify`-ing a client does not
  leak the whole surface.
- **Headers are per request, not per client.** A client is cached per service
  because its construction is expensive; the credentials change per request, so
  they are applied in the fetch hook.
- **`FlatLeaves<T, Depth = 3>` is a depth-limited type-level walk.** Three is the
  depth every contract in this repo needs. Deepening it costs compile time
  everywhere the type is instantiated, so raise it only with a measured reason.
- **A name collision is a contract problem, not a client problem.** When two
  namespaces expose the same leaf name, do NOT invent a mangled method name.
  `FlatLeaves` omits the colliding leaves and the matter is reported so it can be
  fixed in the contract. `ProjectClient` is the current example: `crud` / `list` /
  `findById` exist on two namespaces, so they are reached through the raw router.

## Tests

```bash
bun --bun x vitest run
```

`src/__tests__/base-client.test.ts` and `src/__tests__/contract-leaves.test.ts`
cover binding and leaf collection. A change to the flattening rules needs a test
that fails without it.
