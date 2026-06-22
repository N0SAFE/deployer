# E2E Testing Handbook — API

> **Location**: `apps/api/src/e2e/`
> **Framework**: Vitest + NestJS Testing Module + Testcontainers + oRPC
> **Last updated**: 2026-05-28

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Runtime Lifecycle](#3-runtime-lifecycle)
4. [Writing Tests — Step by Step](#4-writing-tests--step-by-step)
5. [Test Patterns](#5-test-patterns)
6. [Best Practices](#6-best-practices)
7. [Running Tests](#7-running-tests)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Overview

### What are E2E tests?

End-to-end tests validate the **fully assembled NestJS application** from its public API boundary down to the database and back. They boot the real `AppModule`, connect to a real Postgres instance, and exercise every NestJS middleware, guard, interceptor, pipe, and service in the request lifecycle.

### What they are NOT

- **Unit tests** (`*.spec.ts`) — validate a single class/module in isolation with mocks.
- **Integration tests** — validate a subset of modules wired together (no separate config exists; use `describe`-scoped runtimes with custom module overrides instead).

### What to test in E2E

| Priority | What | Why |
|----------|------|-----|
| 🔴 Critical | Auth & permission boundaries | Guards, middleware, role/permission checks |
| 🔴 Critical | oRPC contract behavior | Input validation, response shape, error codes |
| 🟡 High | Multi-step workflows | Setup → project → service → deploy pipelines |
| 🟡 High | State-machine transitions | Setup state, deployment lifecycle, dead-letter flows |
| 🟢 Medium | CRUD + pagination | Create/read/update/delete with filters and sorting |
| 🔵 Low | Infrastructure integration | Traefik routing, container networking (use Testcontainers) |

---

## 2. Architecture

### Layer diagram

```
Vitest (runner)
  ├── globalSetup  ───→  startSharedPostgresContainer()
  │                         (PostgreSQL 16 Alpine via Testcontainers)
  ├── setupFiles   ───→  per-worker env config + afterAll cleanup
  ├── test suites  ───→  *.e2e-spec.ts
  │                        └── getSharedApiRuntimeContext()
  │                              ├── acquire Postgres container (shared ref-counted)
  │                              ├── CREATE DATABASE (isolated, per runtime)
  │                              ├── run Drizzle migrations on isolated DB
  │                              ├── compile AppModule via Test.createTestingModule
  │                              ├── override providers (REQUEST, GLOBAL_DATABASE_POOL, etc.)
  │                              ├── createNestApplication() + listen(0)
  │                              └── return SharedApiRuntimeContext
  │                                    ├── .runtime      (app, moduleRef, pool, dbUrl, baseUrl)
  │                                    ├── .orpc         (typed oRPC client bound to appContract)
  │                                    ├── .http         (supertest instance)
  │                                    ├── .betterAuth   (direct Auth reference)
  │                                    ├── .serviceMapper (DI container proxy)
  │                                    └── .orpcTracker  (transport metadata interceptor)
  └── globalTeardown ─→  stopAllSharedApiRuntimes() + stopSharedPostgresContainer()
```

### Key files

| File | Role |
|------|------|
| `vitest.config.mts` | Multi-project config: `unit` + `e2e` |
| `vitest.global-setup.e2e.ts` | Starts shared Postgres container once per run |
| `vitest.shared-postgres.e2e.ts` | Testcontainers Postgres lifecycle (start/stop) |
| `vitest.setup.e2e.ts` | Per-worker env vars, mock reset, afterAll cleanup |
| `vitest.teardown.e2e.ts` | Global teardown: stops runtimes + Postgres |
| `src/e2e/utils/shared-api-runtime.ts` | Public API for tests (`getSharedApiRuntimeContext`, `useDescribeSharedApiRuntime`) |
| `src/e2e/utils/shared-api-runtime/manager.ts` | Core bootstrap logic (container, DB, NestJS compilation) |
| `src/e2e/utils/shared-api-runtime/types.ts` | All shared types (`SharedApiRuntime`, `SharedApiRuntimeContext`, etc.) |
| `src/e2e/utils/shared-api-runtime/orpc.ts` | oRPC client creation with transport tracker |
| `src/e2e/utils/shared-api-runtime/request-override.ts` | NestJS `REQUEST` provider override for E2E |

### Vitest configuration (relevant parts)

```typescript
// vitest.config.mts
{
  name: "e2e",
  globalSetup: ["./vitest.global-setup.e2e.ts"],  // shared Postgres
  setupFiles: ["./vitest.setup.e2e.ts"],           // per-worker
  globalTeardown: ["./vitest.teardown.e2e.ts"],    // cleanup
  include: ["src/**/*.e2e-spec.ts"],
  testTimeout: 120_000,    // 2 min per test
  hookTimeout: 120_000,    // 2 min per hook
  maxConcurrency: 4,       // max parallel runtimes
}
```

### 2.1 Shared Postgres Container

A **single** Postgres 16 Alpine container starts in `globalSetup` and is shared across all workers. Its connection URI is exported via `E2E_SHARED_POSTGRES_CONNECTION_URI` env var. Each runtime then `CREATE DATABASE`s its own isolated database with a unique name (e.g., `deployer_e2e_worker-1_a1b2c3d4`), runs migrations on it, and drops it on teardown.

### 2.2 Parallelism and max concurrency

The `maxConcurrency: 4` setting in `vitest.config.mts` controls how many runtime instances can coexist. Each runtime is keyed by:
- **Default**: `worker-{VITEST_WORKER_ID}` — one per Vitest worker process
- **Custom**: via `instanceKey` option — for multi-runtime tests (e.g., mesh tests)
- **`describe`-scoped**: via `useDescribeSharedApiRuntime()` — automatic setup/teardown per `describe` block

Maximum parallel runtimes is controlled by `E2E_MAX_CONCURRENCY` env var (default: 4).

---

## 3. Runtime Lifecycle

### 3.1 Bootstrap sequence (`SharedApiRuntimeManager.startRuntime`)

```
1. acquireSharedPostgresContainer()
   - ref-counted; only starts container on first acquire
   - reuses external URI if E2E_SHARED_POSTGRES_CONNECTION_URI is set

2. createRuntimeDatabase()
   - CREATE DATABASE {unique_name} with retry logic
   - builds connection URL with connect_timeout + statement_timeout

3. Plugin hook: onDatabaseCreated()

4. Apply runtime environment variables
   - mock env from @repo/env/mock
   - DATABASE_URL, AUTH_SECRET, TRAEFIK paths, NODE_LOCAL_DB_PATH
   - saves snapshot for later restore

5. Wait for database readiness (SELECT 1 with retry)

6. Run Drizzle migrations on the isolated database

7. Import AppModule dynamically

8. Compile NestJS TestingModule
   - overrideProvider(REQUEST) → sharedRequestOverride
   - overrideProvider(GLOBAL_DATABASE_POOL) → runtime Pool
   - overrideProvider(GLOBAL_DATABASE_CONNECTION) → runtime Drizzle instance

9. Configure Traefik filesystem paths for E2E (temp directories)

10. CreateNestApplication() + listen(0) → random port

11. Assert database binding matches expected connection string

12. Plugin hook: onReady()
```

### 3.2 Teardown sequence

```
1. app.close()
2. moduleRef.close()
3. runtimePool.end()
4. DROP DATABASE {name} WITH (FORCE)
5. releaseSharedPostgresContainer() (decrements ref count)
6. Restore original process.env snapshot
```

### 3.3 Plugin system

The runtime supports lifecycle plugins via the `SharedRuntimePlugin` interface:

```typescript
interface SharedRuntimePlugin {
  name: string
  onContainerReady?: (ctx) => void
  onDatabaseCreated?: (ctx) => void
  onEnvironmentPrepared?: (ctx) => void
  onModuleBuilder?: (ctx) => void
  onModuleCompiled?: (ctx) => void
  onAppInit?: (ctx) => void
  onReady?: (ctx) => void
  onError?: (ctx) => void
}
```

Pass plugins via `getSharedApiRuntimeContext({ plugins: [...] })`.

---

## 4. Writing Tests — Step by Step

### 4.1 File naming and location

- Place tests in `src/e2e/` organized by domain:
  - `src/e2e/auth-workflows/`
  - `src/e2e/setup-workflows/`
  - `src/e2e/deployment-workflows/`
  - `src/e2e/module-workflows/`
  - `src/e2e/mesh-workflows/`
- File extension: `.e2e-spec.ts`
- One `describe` block per file minimum

### 4.2 Minimal test file

```typescript
import { beforeAll, describe, expect, it } from "vitest";
import { getSharedApiRuntimeContext } from "@/e2e/utils/shared-api-runtime";

describe("My module e2e: feature description", () => {
  let http: Awaited<ReturnType<typeof getSharedApiRuntimeContext>>["http"];

  beforeAll(async () => {
    const context = await getSharedApiRuntimeContext();
    http = context.http;
  });

  it("GET /my-route returns expected data", async () => {
    const response = await http.get("/my-route").expect(200);
    expect(response.body).toHaveProperty("data");
  });
});
```

### 4.3 Getting the runtime context

There are two ways to get the runtime:

#### A. Shared (default) — use in most tests

```typescript
const context = await getSharedApiRuntimeContext();
```

The runtime is cached per-worker. Subsequent calls return the same instance. Call this in `beforeAll` or directly inside `it` blocks.

#### B. `describe`-scoped — use for isolated module overrides

```typescript
const runtimeScope = useDescribeSharedApiRuntime({
  nest: {
    onModuleBuilder({ moduleBuilder }) {
      moduleBuilder.overrideProvider(SomeProvider).useValue(mockValue);
    },
  },
});

it("works with custom overrides", async () => {
  const context = runtimeScope.getContext();
  // ...
});
```

This creates a dedicated runtime with automatic `beforeAll` setup and `afterAll` teardown.

### 4.4 Using the context

```typescript
const context = await getSharedApiRuntimeContext();

// ── Type-safe oRPC client (preferred) ──
const users = await context.orpc.user.list();
const user = await context.orpc.user.get({ id: "usr_123" });

// ── Supertest HTTP client (fallback) ──
const res = await context.http.post("/setup/configure-database")
  .send({ databaseUrl, testOnly: true })
  .expect(200);

// ── Service-level injection (bypass HTTP) ──
const userService = context.serviceMapper.get(UserService);
const created = await userService.createUser({ name: "Test", email: "t@t.com" });

// ── Direct database access ──
import { user } from "@/config/drizzle/global/schema/auth";
const dbService = context.serviceMapper.get(GlobalDatabaseService);
await dbService.db.insert(user).values({ ... });

// ── Auth instance ──
const session = await context.betterAuth.api.getSession({ headers });
```

### 4.5 Multi-runtime tests

For mesh or multi-node scenarios, use explicit instance keys:

```typescript
const nodeA = await getSharedApiRuntimeContext({ instanceKey: "mesh-node-a" });
const nodeB = await getSharedApiRuntimeContext({ instanceKey: "mesh-node-b" });

// Cleanup manually:
await stopSharedApiRuntime({ instanceKey: "mesh-node-a" });
await stopSharedApiRuntime({ instanceKey: "mesh-node-b" });
```

---

## 5. Test Patterns

### 5.1 oRPC client with transport tracking (preferred)

```typescript
it("validates HTTP metadata via oRPC tracker", async () => {
  const context = await getSharedApiRuntimeContext();

  const result = await context.orpc.setup.getStatus();
  expect(result.needsSetup).toBe(true);

  const meta = context.orpcTracker.getLast();
  expect(meta?.status).toBe(200);
  expect(meta?.requestUrl).toContain("/setup/status");
  expect(meta?.headers["content-type"]).toContain("application/json");
});
```

The `orpcTracker` records every oRPC call's HTTP metadata (status, URL, headers, etc.). Use it to assert transport-level concerns while keeping domain assertions type-safe.

### 5.2 HTTP-only (supertest) — for malformed payloads, webhooks, raw HTTP

```typescript
it("rejects malformed JSON", async () => {
  const context = await getSharedApiRuntimeContext();
  await context.http
    .post("/setup/configure-database")
    .set("Content-Type", "application/json")
    .send("not-json")
    .expect(400);
});
```

### 5.3 Dual verification (HTTP + oRPC parity)

```typescript
it("HTTP and oRPC return consistent setup status", async () => {
  const context = await getSharedApiRuntimeContext();
  const [httpRes, orpcRes] = await Promise.all([
    context.http.get("/setup/status").expect(200),
    context.orpc.setup.getStatus(),
  ]);
  expect(orpcRes.needsSetup).toBe(httpRes.body.needsSetup);
});
```

### 5.4 Service-level CRUD workflows

```typescript
it("creates, updates, and deletes a user", async () => {
  const userService = runtime.serviceMapper.get(UserService);

  const created = await userService.createUser({ name: "Test", email: "t@t.com" });
  expect(created).not.toBeNull();

  const fetched = await userService.getUserById(created.id);
  expect(fetched.email).toBe("t@t.com");

  const updated = await userService.updateUser(created.id, { name: "Updated" });
  expect(updated.name).toBe("Updated");

  const deleted = await userService.deleteUser(created.id);
  expect(deleted.id).toBe(created.id);
});
```

### 5.5 Auth boundary testing

```typescript
it("rejects anonymous access to protected routes", async () => {
  await context.http.get("/test/authenticated").expect(401);
});

it("allows anonymous access to public routes", async () => {
  const res = await context.http.get("/test/public").expect(200);
  expect(res.body.approach).toContain("AllowAnonymous");
});

it("rejects invalid bearer tokens", async () => {
  await context.http
    .get("/test/admin/role")
    .set("Authorization", "Bearer e2e-invalid-token")
    .expect(401);
});
```

### 5.6 Infrastructure tests (Testcontainers)

For Docker/network tests (e.g., Traefik routing), use Testcontainers directly:

```typescript
import { GenericContainer, Network } from "testcontainers";

it("routes host-based traffic to labeled upstream", async () => {
  const network = await new Network().start();
  const whoami = await new GenericContainer("traefik/whoami:v1.11")
    .withNetwork(network)
    .withLabels({ "traefik.http.routers.test.rule": "Host(`app.test`)", ... })
    .start();
  // ...
  await network.stop();
}, 120_000);
```

---

## 6. Best Practices

### Do

- ✅ **Prefer oRPC over supertest** — type-safe, contract-coupled, refactor-proof.
- ✅ **Test workflows, not endpoints** — compose multiple operations into realistic user journeys.
- ✅ **Include negative paths** — every test suite should have at least one error/edge case.
- ✅ **Assert read-back state** — after a write operation, read the entity back and verify persistence.
- ✅ **Use `useDescribeSharedApiRuntime` for module-specific overrides** — keeps the shared runtime clean.
- ✅ **Keep tests deterministic** — use `randomUUID()` for entity names to avoid collisions.
- ✅ **Clean up test data** — databases are ephemeral (dropped on teardown), but clean up temp files/Traefik paths if created.
- ✅ **Use `orpcTracker` for HTTP metadata** — verify status codes, headers, cookies through the tracker.

### Don't

- ❌ Don't mock services or database — the point is to test the real wiring.
- ❌ Don't share mutable state between tests in the same file — each `it` should be independent.
- ❌ Don't hardcode URLs or paths — use the typed oRPC contract instead.
- ❌ Don't add E2E tests for pure validation logic — that belongs in unit tests.
- ❌ Don't skip cleanup — always call `stopSharedApiRuntime()` if you used a custom instance key.

### Test structure guidelines

```
describe("Module name e2e: scenario description")  ← one describe per file
  beforeAll: get context, resolve services
  it "positive case 1"
  it "positive case 2"
  it "negative case"                                 ← always include at least one
  it "edge case"                                     ← pagination, concurrency, empty states
```

### Assertion quality

- Assert **semantic outcomes**, not implementation details
- For expected failures: assert status + stable error shape
- For stateful features: assert both action result **and** persisted/read-back state
- Use `expect(...).toBeTypeOf("string")` for shape, not exact values where values are non-deterministic

---

## 7. Running Tests

### Commands

```bash
# Run all E2E tests
bun run test:e2e                          # vitest run --project e2e

# Run E2E tests in watch mode
npx vitest --project e2e                  # from apps/api/

# Run a single E2E test file
npx vitest run --project e2e src/e2e/auth-workflows/test-auth-patterns.e2e-spec.ts

# Run E2E with debug logging
E2E_SHARED_RUNTIME_LOGS=true bun run test:e2e

# Adjust parallelism
E2E_MAX_CONCURRENCY=2 bun run test:e2e

# Run inside Docker (CI mode)
bun run test:e2e:api:docker

# Type-check before running
bun run api -- type-check
```

### Docker-based E2E (CI)

```bash
bun run test:e2e:api:docker
# → docker compose -f ./docker/compose/api/docker-compose.api.e2e.yml up --build --abort-on-container-exit
```

This provisions a container with Docker socket access (for Testcontainers) and runs `bun run test:e2e` inside it.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `E2E_MAX_CONCURRENCY` | `4` | Max parallel runtime instances |
| `E2E_SHARED_RUNTIME_LOGS` | unset | Enable verbose bootstrap logging |
| `E2E_SHARED_POSTGRES_CONNECTION_URI` | auto | Skip testcontainers; use external Postgres |
| `E2E_USE_GLOBAL_SHARED_POSTGRES_SETUP` | unset | Force global shared Postgres mode (non-Bun) |

---

## 8. Troubleshooting

### "Max shared runtime instances reached"

You're trying to create more than `E2E_MAX_CONCURRENCY` runtimes. Either:
- Increase `E2E_MAX_CONCURRENCY`
- Reduce parallelism by calling `stopSharedApiRuntime()` when done
- Use the default worker-keyed runtime (shared) instead of custom instance keys

### Bootstrap timeout (120s)

The most common cause is Testcontainers pulling Postgres on first run. Subsequent runs are faster because the image is cached.

Check:
- Is Docker running? (`docker info`)
- Does the Docker socket have enough resources?
- Try `E2E_SHARED_RUNTIME_LOGS=true` to see per-step timing

### "Postgres testcontainer not ready in time"

Usually a connectivity issue. The runtime retries `SELECT 1` with 20s deadline. Possible causes:
- Docker resource constraints
- Port conflicts
- Previous container not fully cleaned up

### Database pool mismatch

The runtime asserts the injected database pool matches the expected connection URL. This can fail if:
- `GLOBAL_DATABASE_POOL` override is incorrect
- The pool was created with a different connection string than the runtime's isolated database

### Tests pass in isolation but fail in batch

Likely a shared state issue:
- Are tests using `randomUUID()` for unique entities?
- Is the shared runtime's state leaking between tests? Each worker gets its own runtime, but within a worker the runtime is shared.
- Use `describe`-scoped runtimes for tests that need isolation.

### oRPC client returns type errors

Ensure the contracts are up to date:
```bash
bun run api -- type-check
```
If contracts changed, rebuild with `bun run build` in `packages/api-contracts`.

---

## Related Documents

| Document | Location |
|----------|----------|
| E2E Coverage Matrix & Roadmap | `src/e2e/E2E_TEST_STRATEGY.md` |
| oRPC-First Testing Philosophy | `src/e2e/E2E_TESTING_STRATEGY.md` |
| Design Decisions & Findings | `src/e2e/E2E_FINDINGS.md` |
| General Testing Workflow | `apps/doc/content/docs/testing/testing.mdx` |
