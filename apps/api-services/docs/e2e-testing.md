# E2E testing the API tier

> Applies to `apps/api-services/{bff,services/*}`. The harness lives in `shared/src/e2e-harness`.
> Carried over, and rewritten for the tier, from the monolith's `E2E_HANDBOOK.md` and
> `E2E_TESTING_STRATEGY.md` (`apps/api`, removed). The history of those files is in git.

## What an e2e spec is

It boots one app's REAL root module (`BffModule`, or a service's root module) against a real
Postgres started with Testcontainers, then drives it through its public boundary and checks the
outcome. It is not a unit test (one class, mocks) and not a wiring test (a few modules).

Write an e2e spec for: auth and permission boundaries, contract behaviour (validation, response
shape, error codes), multi-step workflows, state machines. Do NOT write one for logic a unit spec
covers, for a third party's behaviour (the monolith's `traefik-routing` tested the stock Traefik
image and was dropped), or for something that only restates another spec.

A spec that boots nothing is a unit spec: it belongs next to its class as `*.spec.ts`.

## Where things live

| What | Where |
|------|-------|
| Specs | `<app>/src/e2e/<area>-workflows/*.e2e-spec.ts` (the suffix matters: `*.spec.ts` does not match it) |
| The app's runtime binding | `<app>/src/e2e/runtime.ts`: binds the harness to this app's root module |
| The harness | `shared/src/e2e-harness/shared-api-runtime` (`manager`, `orpc`, `request-override`, `types`) |
| Vitest lifecycle | `shared/src/e2e-harness/vitest` (`global-setup`, `setup`, `shared-postgres`, `teardown`, `bun-sqlite-shim`) |
| Vitest config | `@deployer/config-vitest/service` (`tooling/vitest/src/service.ts`), used by each app's `vitest.config.mts` |

Each app has two vitest projects: `<app>-unit` (`src/**/*.{test,spec}.{ts,tsx}`, excluding
`*.e2e-spec.ts`) and `<app>-e2e` (`src/**/*.e2e-spec.ts`).

## Writing a spec

Import the app's own wrapper, never the harness directly: the harness cannot know which root module
to boot, and importing it directly fails with `rootModuleLoader is required`.

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { getSharedApiRuntimeContext, type SharedApiRuntimeContext } from "@/e2e/runtime";

describe("my area e2e", () => {
  let context: SharedApiRuntimeContext;
  beforeAll(async () => {
    context = await getSharedApiRuntimeContext();
  });

  it("rejects an anonymous caller", async () => {
    context.orpcTracker.clear();
    await expect(context.orpc.project.list({ query: { limit: 20, offset: 0 } })).rejects.toBeDefined();
    expect(context.orpcTracker.getLast()?.status).toBe(401);
  });
});
```

`context` gives you `orpc` (a typed client over the real contract), `orpcTracker` (HTTP metadata
for every oRPC call), `http` (supertest, for what is not a contract procedure), `serviceMapper`
(`get(SomeProvider)` from the running Nest container) and the runtime's `baseUrl`.
A second instance of the same app: `getSharedApiRuntimeContext({ instanceKey: "node-b" })`, and
`stopSharedApiRuntime({ instanceKey })` when done (see `bff/src/e2e/platform-workflows`).

### Drive it through the contract first (oRPC-first)

The oRPC client is typed by the same Zod schemas the server enforces, so a contract change breaks
the test at compile time instead of silently (hard-coded URLs and `supertest` assertions do not).
Use `http` only for what has no contract. Transport facts the client hides (status code, headers,
the path called) are read from `orpcTracker`; assert them, because "it rejected" is satisfied by a
404 or a 500 as well as by a 401.

### Reach the database through the app's own classes

To arrange or inspect state, take the repository or service from `context.serviceMapper` and the
database from `GlobalDatabaseService`. Rules that live in SQL (an upsert that re-binds an owner, a
delete scoped to its owner) are tested here against Postgres, not with a stubbed query chain: see
`identity/src/e2e/module-workflows/push-repository.e2e-spec.ts`.

### Keep an app out of another app's rules

A service's e2e exercises that service's domain. Do not create another service's data through its
code to arrange a test (the project/service case was moved out of `identity` for that reason); seed
rows directly.

## Running

From the app directory (there is no `test:e2e` script; `bun run test` runs both projects):

```bash
bunx vitest run --project '*e2e*'                              # all e2e of the app
bunx vitest run --project '*e2e*' src/e2e/module-workflows     # one folder or file
bunx vitest run --project '*unit*'                             # unit only
```

Docker must be reachable (Testcontainers starts one shared Postgres per run). Environment flags:

| Variable | Effect |
|----------|--------|
| `E2E_SHARED_RUNTIME_LOGS=true` | show the harness and Nest logs (silenced by default) |
| `E2E_SHARED_RUNTIME_MAX_CONCURRENCY` | how many runtimes may run at once (default 4) |
| `E2E_DOCKER_CLEANUP` | default `true`: at teardown, force-removes orphaned containers that Testcontainers started AND that are named `deployer*` (label `org.testcontainers=true`). A real stack's containers do not carry that label, so they are never touched. Set `false` to keep the orphans for inspection |

`E2E_SHARED_POSTGRES_CONNECTION_URI` is not a setting: the harness sets it for the runtimes it starts so they share one Postgres in namespace mode.

## Troubleshooting

- **`Cannot find package '@/config/...'` at import.** The app's source uses a `@/` alias the shared
  config does not define. The BFF maps `@/auth`, `@/config/*` and `@/core/*` to `shared` in its
  tsconfig, so its `vitest.config.mts` repeats them in `extraAliases`; a new app with the same
  imports needs the same entries.
- **`SharedApiRuntimeOptions.nest.rootModuleLoader is required`.** The spec imported the harness
  instead of the app's `@/e2e/runtime`.
- **Nest "can't resolve dependencies of ...".** A real wiring error in the root module, which is
  what a boot e2e exists to catch; the message names the provider and the index.
- **Specs interfere through one SQLite file.** The e2e project is serialised for this reason; do
  not make it parallel without giving each worker its own `NODE_LOCAL_DB_PATH`.
