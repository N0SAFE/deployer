# 🎯 AI Coding Agent Instructions

> **Foundation file.** All AI agents working on this repo MUST follow every rule below.
> Violations are bugs, not style choices. When in doubt, read [`AGENTS.md`](../../AGENTS.md) (root) and the nearest scoped `AGENTS.md` first.

---

## Table of Contents

1. [🔴 Documentation Awareness](#-documentation-awareness)
2. [🔴 Type Safety — Zero Tolerance for Assertions](#-type-safety--zero-tolerance-for-assertions)
3. [🔴 Zod-as-Source-of-Truth for All External Data](#-zod-as-source-of-truth-for-all-external-data)
4. [🔴 ORPC Contract Patterns](#-orpc-contract-patterns)
5. [🔴 NestJS Server Patterns](#-nestjs-server-patterns)
6. [🔴 React / Next.js Patterns](#-react--nextjs-patterns)
7. [🔴 Error Handling](#-error-handling)
8. [🔴 Logging](#-logging)
9. [🔴 Testing](#-testing)
10. [🔴 Performance — SSE / High-Frequency Streams](#-performance--sse--high-frequency-streams)
11. [🔴 Bun Runtime Rule](#-bun-runtime-rule)
12. [🔴 MCP-First Workflow](#-mcp-first-workflow)
13. [🔴 Documentation Maintenance Protocol](#-documentation-maintenance-protocol)
14. [🔴 Git Workflow](#-git-workflow)
15. [🔴 New Concept Documentation Protocol](#-new-concept-documentation-protocol)
16. [🔴 Change Order & Validation](#-change-order--validation)
17. [🔴 Engineering Mindset & Operating Posture](#-engineering-mindset--operating-posture)
18. [🔴 Pre-Work Investigation Protocol](#-pre-work-investigation-protocol)
19. [🔴 DRY — Don't Repeat Yourself](#-dry--dont-repeat-yourself)
20. [🔴 KISS — Keep It Simple, Stupid](#-kiss--keep-it-simple-stupid)
21. [🔴 YAGNI — You Aren't Gonna Need It](#-yagni--you-arent-gonna-need-it)
22. [🔴 SSOT — Single Source of Truth](#-ssot--single-source-of-truth)
23. [🔴 Separation of Concerns](#-separation-of-concerns)
24. [🔴 Type-Driven Development — Make Illegal States Unrepresentable](#-type-driven-development--make-illegal-states-unrepresentable)
25. [🔴 Error Handling Philosophy](#-error-handling-philosophy)
26. [🔴 Composition & Open/Closed Principle](#-composition--openclosed-principle)
27. [🔴 Dependency Inversion (DI Tokens)](#-dependency-inversion-di-tokens)
28. [🔴 Monorepo Package Boundaries](#-monorepo-package-boundaries)
29. [🔴 Code Smell Catalog](#-code-smell-catalog)
30. [🔴 The Boy Scout Rule](#-the-boy-scout-rule)
31. [🔴 Ripple Effect Analysis](#-ripple-effect-analysis)
32. [🔴 No Bridges, No Compatibility Layers](#-no-bridges-no-compatibility-layers)
33. [🔴 Refactor Incrementalism & Atomic Refactors](#-refactor-incrementalism--atomic-refactors)
34. [🔴 "Scream" Test for Architecture](#-scream-test-for-architecture)
35. [🔴 Self-Review Checklist (Before Any Commit)](#-self-review-checklist-before-any-commit)
36. [🔴 Anti-Pattern Catalog (Always Reject)](#-anti-pattern-catalog-always-reject)
37. [🔴 Deep Debugging Protocol](#-deep-debugging-protocol)
38. [🔴 Proposing Structural Changes](#-proposing-structural-changes)
39. [🔴 Developer Experience Standards](#-developer-experience-standards)
40. [🔴 UI/UX Standards](#-uiux-standards)
41. [🔴 Code Perfection Standards](#-code-perfection-standards)
42. [🔴 MCP Tools Quick Reference](#-mcp-tools-quick-reference)

---

## 🔴 Documentation Awareness

**CRITICAL**: You must be AWARE of the project's documentation structure and read relevant files as needed:

1. **Know the Documentation app exists** at `apps/doc/content/docs/` — the canonical documentation source.
2. **Know the index** at [`apps/doc/content/docs/index.mdx`](../../apps/doc/content/docs/index.mdx) — the central navigation point.
3. **Read relevant documentation BEFORE implementing** — don't guess patterns.
4. **Don't read everything upfront** — be selective and efficient.
5. **Use the index** to discover what's available and navigate to what you need.

### When to Read Documentation

- **Before ANY implementation**: Check if relevant docs exist for the task.
- **When encountering new concepts**: Read the specific guide in `apps/doc/content/docs/`.
- **When uncertain about patterns**: Navigate via `index.mdx` to find the right guide.
- **NOT every single time**: Don't re-read familiar patterns you've already applied.

### Documentation Discovery Pattern

1. **Start at `index.mdx`**: Understand what documentation categories exist.
2. **Check development patterns** in `apps/doc/content/docs/dev/`: Service-Adapter, ORPC, routing, auth, etc.
3. **Navigate to relevant files**: Read only what's needed for your current task.
4. **Keep key patterns in context**: Remember Service-Adapter, ORPC Client Hooks, Declarative Routing, etc.
5. **Re-read when needed**: If a pattern is unfamiliar or you're unsure, read the docs again.

### Scoped AGENTS.md Files (Read Before Touching Code)

| Scope | File | When to read |
|-------|------|--------------|
| Repo root | `AGENTS.md` | Always first |
| Web | `apps/web/AGENTS.md` | Any `apps/web/src/**` change |
| API | `apps/api/AGENTS.md` | Any `apps/api/src/**` change |
| API system | `apps/api/src/system/AGENTS.md` | Any `src/system/**` change |
| Doc app | `apps/doc/AGENTS.md` | Any `apps/doc/**` change |
| UI lib | `packages/ui/base/AGENTS.md` | Any `packages/ui/**` change |
| Contracts | `packages/contracts/api/AGENTS.md` | Any contract change |
| Utils auth | `packages/utils/auth/AGENTS.md` | Any auth-related change |
| Docker builder | `docker/builder/AGENTS.md` | Any Dockerfile change |

**Rule**: If a local `AGENTS.md` contradicts root, **the local one wins** for that scope.

---

## 🔴 Type Safety — Zero Tolerance for Assertions

**The single most important rule in this codebase.** Type assertions (`as X`, `as unknown as X`, `as any`) are **bugs waiting to happen** because they hide the truth from the compiler. Every assertion is a lie that the runtime can expose.

### ❌ Banned Patterns

```typescript
// ❌ NEVER — type lies, runtime crash waiting to happen
const chunk = { ...entity, kind, action } as unknown as DockerEntityStreamChunk
const ports = (container.Ports as Record<string, unknown>[] | undefined) ?? []
const valid = data as DockerContainer
const config = input as any
// @ts-ignore
// @ts-expect-error
```

### ✅ The Right Patterns

```typescript
// ✅ Zod parse — type IS the schema's inferred type, no assertion needed
const entity = dockerContainerSchema.parse(raw)
// entity is DockerContainer by construction

// ✅ Zod safeParse — narrow the union
const result = dockerContainerSchema.safeParse(raw)
if (!result.success) return null
// result.data is DockerContainer

// ✅ Zod discriminated union for enum-like narrowing
const chunk = dockerEntityEventEnvelopeSchema.parse(input)
// chunk is fully typed by Zod

// ✅ Type-safe constructor function
export function buildDockerEntityEventChunk(input: {
  kind: "container"
  entity: z.infer<typeof dockerContainerEntitySchema>
  action: string
  occurredAt: string
  eventId: string | null
}): z.infer<typeof dockerContainerEntitySchema> & { kind: "container"; action: string; occurredAt: string; eventId: string | null } {
  // ...
}
```

### Allowed Narrow Casts (and only these)

- **Discriminated union narrowing** inside `switch (chunk.kind)` or `if (chunk.kind === "container")` — the compiler narrows the type.
- **`as const`** for literal narrowing: `const STATUS = ["running", "stopped"] as const`.
- **`satisfies T`** for ensuring a value matches a type without losing its literal type: `const config = { port: 3000 } satisfies ServerConfig`.

### When the Type System Fights You

- **Fix the type, don't assert it.** If a type is wrong, fix the schema, fix the inference, or add a generic. Never `as unknown as X` to silence the error.
- **Add a Zod schema** for any external data shape and infer the TS type from it: `type T = z.infer<typeof tSchema>`.
- **Use builder functions** like `buildDockerEntityEventChunk` for any value that needs to satisfy a discriminated union — the function returns the precise type.
- **If you MUST convert** between two types, write a small `to*` function that uses Zod to validate: `const toChunk = (e: Entity): Chunk => chunkSchema.parse({ ...e, kind: "container", ... })`.

### TypeScript Compiler Settings (Already Enforced)

| Setting | Value | Source |
|---------|-------|--------|
| `strict` | `true` | `@repo/config-typescript/config/base.json` |
| `noUncheckedIndexedAccess` | `true` | `@repo/config-typescript/config/base.json` |
| `verbatimModuleSyntax` | `true` (nestjs preset) | `@repo/config-typescript/config/nestjs.json` |
| `noFallthroughCasesInSwitch` | `false` (relaxed for nestjs) | `@repo/config-typescript/config/nestjs.json` |
| `noImplicitAny` | `false` (relaxed for nestjs) | `@repo/config-typescript/config/nestjs.json` |

> **Do not weaken these** without team discussion. If a library forces you to, wrap it in a typed adapter instead.

### Audit Before Committing

Before any PR, run:

```bash
grep -rn "as unknown as\|as Record<string" apps/ packages/
grep -rn "@ts-ignore\|@ts-expect-error" apps/ packages/
```

Any result is a candidate for cleanup. New code MUST have zero occurrences.

---

## 🔴 Zod-as-Source-of-Truth for All External Data

**Rule**: Every piece of data that crosses a trust boundary MUST pass through Zod. The inferred TypeScript type is the truth.

### Trust Boundaries That MUST Validate

| Boundary | Source | Zod Schema |
|----------|--------|------------|
| HTTP response body | `orpcClient`/`fetch` | Output schema in contract (`.output((b) => b.body(...))`) |
| SSE/Observable emission | `experimental_liveObservableOptions` | Output schema in contract — **but ORPC does NOT auto-validate per emission**; validate server-side in the stream producer |
| SSE chunk construction | API stream handler | `dockerEntityStreamChunkSchema.safeParse(chunk)` — return the **parsed** result, not the original |
| Database row | Drizzle query | Zod parse if shape isn't already Zod-derived |
| Environment variables | `process.env` | `envSchema.parse(process.env)` (see `apps/api/src/config/`) |
| User input | Form / query string | Zod schema in `_models/` |
| Docker socket response | `dockerode` library | Zod parse at the facade boundary |
| Mesh peer response | `MeshClient` | Zod parse at the receive boundary |

### ORPC Stream Validation — Critical Rule

**ORPC's `validateOutput` ONLY runs on synchronous returns, NOT on each emission of an observable.** The stream contract's output schema is **decorative** for SSE.

**Implication**: Every chunk emitted from `docker.entity.stream` MUST be validated server-side in the stream producer and re-emitted as the **parsed** result (defaults filled, types truthful). Example:

```typescript
streamEntities(input: DockerEntityStreamInput): Observable<DockerEntityStreamChunk> {
  return this.domainService.streamEntities({ ... }).pipe(
    map((chunk) => this.coerceStreamChunk(chunk)),  // ✅ return parsed
    filter((chunk): chunk is DockerEntityStreamChunk => chunk !== null),
  )
}

private coerceStreamChunk(chunk: unknown): DockerEntityStreamChunk | null {
  const result = dockerEntityStreamChunkSchema.safeParse(chunk)
  if (!result.success) {
    this.logger.debug("dropping invalid stream chunk", { issues: result.error.issues })
    return null
  }
  return result.data  // ✅ parsed, defaults filled, fully typed
}
```

**Anti-pattern** (the bug I keep fixing):

```typescript
.pipe(
  filter((chunk) => this.isValid(chunk))  // ❌ returns boolean, emits ORIGINAL chunk
)
```

### Zod Schema Conventions

- **Schemas live with the domain they describe**: `packages/contracts/entities/src/entities/docker/containers/base.schema.ts` for container schema, etc.
- **One schema per file**, exported as `xxxSchema` and inferred as `type Xxx = z.infer<typeof xxxSchema>`.
- **Use `z.string().min(1)` for non-empty strings** — `z.string()` alone accepts `""` which is almost never what you want.
- **Use `.default([])` for required-but-may-be-empty arrays**: `ports: z.array(dockerPortBindingSchema).default([])`.
- **Use `z.enum([...])` not `z.string()` for closed sets** — gives autocomplete + exhaustiveness checks.
- **For external/dockerd output, parse at the facade boundary** — never let `unknown` leak past the boundary without a parse.

---

## 🔴 ORPC Contract Patterns

**ORPC is the only API surface.** All HTTP traffic goes through ORPC contracts. REST endpoints, manual `fetch()`, `axios` calls — all forbidden.

### Contract Definition

```typescript
// packages/contracts/api/modules/<domain>/<operation>.ts
import { standard } from "@repo/orpc-utils"
import { xxxEntitySchema } from "@repo/contracts-entities"
import { xxxInputSchema } from "./shared"
import z from "zod/v4"

const xxxResponseSchema = z.object({
  data: xxxEntitySchema,
  etag: z.string().min(1).optional(),
})

const xxxOps = standard.zod(xxxResponseSchema, "xxxOperation")

export const xxxContract = xxxOps
  .read()  // or .list() for collections
  .path("/<operation>")
  .input((b) => b.body(xxxInputSchema))   // .query() / .params() / .body() as appropriate
  .output((b) => b.body(xxxResponseSchema))  // .body() / .observable() for streams
  .errors((b) => [...meshDomainErrorContracts(error), b.NOT_FOUND(...)])  // ORPC errors
  .build()
```

### Contract Composition

- **`standard.zod(schema, "operationName")`** — wraps a Zod schema into a `StandardOperations` builder. The name is used in error messages and tracing.
- **`.read()` / `.list()` / `.create()` / `.update()` / `.delete()`** — semantic verbs that build the right URL pattern.
- **`.path("/xxx")`** — explicit URL path segment.
- **`.input((b) => b.body(schema))`** — input is in the body. Use `.query()` for `?foo=bar` and `.params()` for `:id` segments.
- **`.output((b) => b.body(schema))`** — output is in the body. Use `.observable(schema)` for SSE streams. **ORPC only validates `.body()` outputs, NOT per observable emission** (see Zod section above).
- **`.errors(...)`** — attach ORPC error definitions (see Error Handling section).

### Server Implementation

```typescript
// apps/api/src/modules/<domain>/<domain>.controller.ts
@Implement(appContract.xxx.contract)
xxx() {
  return implement(appContract.xxx.contract)
    .use(requireAuth())  // or other middleware
    .handler(async ({ input, context }) => {
      return this.xxxService.execute(input)  // ✅ returns the typed value
    })
}
```

**Important rules**:

- The handler **returns** a typed value. ORPC validates the return against the contract's output schema.
- The handler must NOT do `as unknown as X` casts — fix the type or the schema.
- For SSE: use `dockerEndpoints.runtime.stream.experimental_liveObservableOptions(...)` on the client; the server returns `new Observable(...)`.

### Client Consumption

```typescript
// apps/web/src/domains/<domain>/hooks.ts
import { dockerEndpoints } from "@/lib/orpc"

// Query (read)
const query = useQuery(
  dockerEndpoints.xxx.list.queryOptions({
    input: { /* typed input */ },
  })
)

// Mutation
const mutation = useMutation(
  dockerEndpoints.xxx.create.mutationOptions()
)

// SSE stream
const stream = useQuery(
  dockerEndpoints.runtime.stream.experimental_liveObservableOptions({
    input: { /* typed input */ },
  })
)
```

**Never write `fetch()` calls.** Never call the API URL directly. Never hardcode routes. Always go through the typed ORPC client.

### Endpoints Layout

| Source | Lives in |
|--------|----------|
| Contract (input + output schemas) | `packages/contracts/api/modules/<domain>/` |
| Server implementation | `apps/api/src/modules/<domain>/` (product) or `apps/api/src/system/<domain>/` (control plane) |
| Client hooks | `apps/web/src/domains/<domain>/hooks.ts` |
| Per-feature schema/models | `apps/web/src/app/<feature>/_models/` |
| Per-feature components | `apps/web/src/app/<feature>/_components/` |
| Per-feature data-table | `apps/web/src/app/<feature>/_data-table/` (columns.tsx, filter-config.ts) |
| Per-feature utils | `apps/web/src/app/<feature>/_utils/` |
| Per-feature hooks | `apps/web/src/app/<feature>/_hooks/` |

**Boundary rule** (load-bearing): `src/system/**` is **internal control plane only** (mesh coordination, fleet allocator, diagnostics). Product-facing APIs go in `src/modules/**`. If a system endpoint becomes user-facing, **migrate it to `src/modules/**`**, don't expose system routes.

---

## 🔴 NestJS Server Patterns

### Module Structure

```text
modules/<domain>/
  controllers/<domain>.controller.ts    — @Controller() routes
  services/<domain>.service.ts          — business logic, @Injectable()
  repositories/<domain>.repository.ts   — DB / external IO layer
  <domain>.module.ts                    — @Module({ imports, controllers, providers, exports })
  <domain>.module.spec.ts               — colocated unit test
  index.ts                              — public exports
```

### Service / Repository / Controller Split

- **`controllers/`** — thin, call services. No business logic.
- **`services/`** — business logic, `@Injectable()`, registered in `providers` and exported in `exports`.
- **`repositories/`** — DB / external IO. Injectable via DI tokens.
- **Tests colocated**: `xxx.module.spec.ts` next to the module file.

### DI Tokens (Class Tokens Preferred)

**Class tokens are the default. String tokens are a last resort.**

In modern NestJS, the **class IS the token**. Use abstract classes as the contract and concrete classes as the implementation. String-based DI tokens (`export const FOO = "FOO" as const`) are a **DX regression**: they lose TypeScript autocomplete, break rename refactoring, and create magic strings that don't compile when mistyped.

```typescript
// ✅ Abstract class as the contract (the token)
export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>
  abstract create(input: CreateUserInput): Promise<User>
}

// ✅ Concrete class as the implementation
@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaClient) { super() }
  findById(id: string) { return this.prisma.user.findUnique({ where: { id } }) }
  create(input: CreateUserInput) { return this.prisma.user.create({ data: input }) }
}

// ✅ Service depends on the abstract class — TS autocomplete works, rename works
@Injectable()
export class UserService {
  constructor(private readonly users: UserRepository) {}
  //                                          ^^^^^^^^^^^^^^ IDE knows this type
}
```

**Module wiring** (NestJS auto-resolves the abstract class to the concrete):

```typescript
@Module({
  providers: [
    PrismaService,
    PrismaUserRepository,  // Nest resolves `UserRepository` to this concrete
    UserService,
  ],
  exports: [UserService],
})
export class UserModule {}
```

### When String Tokens Are Acceptable (Rare)

String tokens are acceptable ONLY in these specific cases:

1. **NestJS multi-provider tokens** like `APP_GUARD`, `APP_INTERCEPTOR`, `APP_PIPE` (built-in, can't be replaced).
2. **Cross-package tokens that can't be imported** (e.g. a plugin system where the host defines the contract at runtime).
3. **Dynamic / configurable providers** (multi-tenant, feature-flagged services where the binding is decided at runtime).

For everything else (the default): **use a class**.

### Why Class Tokens Are Better DX

| Concern | String token | Class token |
|---------|-------------|-------------|
| **TypeScript autocomplete** | ❌ Magic string, no autocomplete | ✅ `UserRepository` autocompletes |
| **Rename refactoring** (F2) | ❌ Breaks silently if string is mistyped | ✅ Refactored everywhere automatically |
| **Find usages** | ❌ `grep` over strings is noisy | ✅ `vscode_listCodeUsages` is exact |
| **Compile-time check** | ❌ Typos aren't caught | ✅ Wrong class name won't compile |
| **The contract IS the token** | ❌ Token and interface are decoupled | ✅ One symbol for both |

### Anti-Patterns

- ❌ `export const USER_REPOSITORY = "USER_REPOSITORY" as const` — magic string.
- ❌ `{ provide: "USER_REPOSITORY", useClass: PrismaUserRepository }` — string token.
- ❌ Constructor: `@Inject("USER_REPOSITORY")` — string-based injection.
- ❌ Two separate files: `UserRepository` (interface) and `USER_REPOSITORY` (token). Use a single class.
- ❌ `new SomeService()` inside another service (skipping the DI container).

### Module Imports (Gotcha)

`CoreModule` re-exports `AuthModule` and `DatabaseModule` in **`providers`** (not `imports`):

```typescript
@Module({
  imports: [CoreInitializationModule, CoreReachabilityModule],
  providers: [AuthModule, DatabaseModule],  // ← providers, not imports
  exports: [AuthModule, DatabaseModule],
})
```

This is intentional: NestJS provider-scoped modules can be `inject()`-ed into any module that imports `CoreModule`. Do not "fix" this to use `imports`.

### Logging in Services

```typescript
@Injectable()
export class XxxService {
  private readonly apiLogger = new AppLogger("api").scope(XxxService.name)
  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: XxxService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    fallbackEnableEnvVar: "APP_DEBUG_CONTEXT_ENABLED",
    channel: "xxx-domain",
  })
  private readonly scopedLogger = this.apiLogger.log
}
```

### Database Migrations

- Local (schema change): `api-db { action: "generate" }` → review → `api-db { action: "push" }` (dev only) or write a migration.
- Production: **always** write a migration. Never `push` to prod.
- Schema files: `apps/api/src/db/drizzle/schema/`.
- After schema change: `auth-generate` to regenerate auth types.

---

## 🔴 React / Next.js Patterns

### App Router Conventions

- **Routes**: `apps/web/src/app/<feature>/page.tsx` co-located with `page.info.ts`.
- **Layouts**: `apps/web/src/app/<feature>/layout.tsx` for shared chrome.
- **Loading**: `loading.tsx` (Suspense boundary).
- **Error**: `error.tsx` (Error boundary).
- **Declarative routing**: never raw `href` strings, never `fetch()`. Use `import { X } from "@/routes"` then `<X.Link>` or `X.fetch()`. **Regenerate routes after any change**: `bun --bun run web -- dr:build`.

### Feature-Local Structure (mandatory for non-trivial routes)

```text
app/<feature>/
  _models/        — Zod schemas + inferred types (e.g. xxx-input.schema.ts)
  _hooks/         — local hooks (page-level)
  _components/    — local components
  _data-table/    — columns.tsx, filter-config.ts
  _utils/         — pure helpers
```

Filters in `_data-table/filter-config.ts`, columns in `_data-table/columns.tsx`, schemas in `_models/`.

### Information Presentation

**No 4-up top-of-page KPI/info-card strip** below the page title (see `apps/web/AGENTS.md` UI rule). Use:

- Context-first header
- Section-first metric placement
- Action-oriented summary blocks
- Responsive priority on controls

### Component Patterns

- **Default to Server Components**. Only add `"use client"` when you need state, effects, or browser APIs.
- **Hooks order**: `useState` → `useEffect` → `useMemo` → `useCallback` → custom hooks.
- **Stable callbacks**: handlers passed to memoized children must be wrapped in `useCallback`.
- **No unnecessary `useMemo`**: only memoize expensive computations or referentially-stable values.
- **`useDeferredValue`** for non-urgent derived state from high-frequency streams (SSE, polling). See Performance section.
- **`React.memo`** only when the component is expensive AND the parent can't be optimized.

### State Management

- **URL state** (filters, pagination, sort): use `useSafeQueryStatesFromZod` from `@repo/use-safe-query-param-states-from-zod`. Schema in `_models/`.
- **Local state**: `useState`.
- **Global state**: Zustand stores in `src/state/`.
- **Server state**: React Query via `useQuery` / `useMutation` from ORPC contracts. Never fetch manually.

### Declarative Routing

```typescript
import { Home, ApiAuth } from "@/routes"

// Link
<Home.Link>Home</Home.Link>

// Fetch (in client component)
const data = await ApiAuth.fetch({ input: { ... } })

// Open modal/page
<ApiAuth.Link>Open</ApiAuth.Link>
```

**Never** hardcode `href="/foo"`. **Never** use `fetch("/api/foo")`. The route table in `src/routes/index.ts` is auto-generated.

---

## 🔴 Error Handling

### 3-Tier Error Pipeline

```text
Domain error → ORPC error contract → InternalErrorExceptionFilter → HTTP response
```

### Layer 1: AppError Hierarchy

All custom errors MUST extend `AppError`, not `Error`:

```typescript
import { AppError } from "@/core/errors"

export class NotFoundError extends AppError {
  constructor(resource: string, identifier: string) {
    super(`${resource} not found: ${identifier}`, "NOT_FOUND", { resource, identifier })
  }
}

throw new NotFoundError("User", userId)  // ✅
throw new Error("User not found")        // ❌ — bypasses error code + context
```

Standard subclasses: `NotFoundError`, `ValidationError`, `ConflictError`, `UnauthorizedError`, `ForbiddenError`, `TimeoutError`, `ServiceUnavailableError`, `BadRequestError`.

### Layer 2: ORPC Error Contract

Define errors per-contract using the fluent `ErrorDefinitionBuilder`:

```typescript
import { error, meshDomainErrorContracts } from "@repo/orpc-utils"

const contract = xxxContract.errors({
  ...meshDomainErrorContracts(error),  // 6 canonical mesh errors
  NOT_FOUND: error().message("Xxx not found").status(404).data(z.object({ id: z.string() })),
  VALIDATION: error().message("Invalid input").status(400).data(z.object({ fields: z.array(z.string()) })),
})
```

**Throw ORPC errors in handlers**: `throw new ORPCError("NOT_FOUND", { data: { id } })`. The global filter maps ORPC errors to the contract-defined status code.

### Layer 3: Global Filter

`InternalErrorExceptionFilter` (in `apps/api/src/core/middlewares/internal-error/`) handles three branches:

1. **`MeshBaseDomainError`** → 4xx/5xx with `{ statusCode, code, message, orpcCode, requestId, traceId? }`
2. **`HttpException`** → uses its own status, attaches `requestId`
3. **Anything else** → 500 with `{ statusCode, message, requestId, traceId, debug? }`. The `debug` block only in non-production.

The filter is wired in `apps/api/src/main.ts` via `app.useGlobalFilters(...)`.

### Request Correlation

`InternalErrorContextMiddleware` reads `x-request-id` header (or generates `randomUUID()`), attaches to `req` via `INTERNAL_ERROR_CONTEXT_KEY`, sets `x-request-id` response header. **Always log with `requestId` for traceability**.

### Client Error Handling

```typescript
// Web: ORPC errors auto-serialize. Access via:
//   error.code, error.status, error.data (the data() schema)
//   error.message
// React Query mutations: onError receives the typed ORPC error

// Toast: use toast.error("...", { description: error.message }) from sonner
```

**Never** swallow errors silently. **Never** log only the message — always include the stack and context.

---

## 🔴 Logging

### Use `ContextFilterLogger` Everywhere

The single logging primitive for the codebase (both backend and frontend):

```typescript
import { AppLogger } from "@repo/logger"

const logger = new AppLogger("api").scope(MyService.name)
const debugLogger = logger.createContextFilterLogger({
  defaultClassName: MyService.name,
  filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
  fallbackEnableEnvVar: "APP_DEBUG_CONTEXT_ENABLED",
  channel: "my-domain",
})
```

### Filter Syntax

Set `APP_DEBUG_CONTEXT_FILTER` to control verbosity:

- `APP_DEBUG_CONTEXT_FILTER="DockerRuntime*.trace*"` — all DockerRuntime classes, methods starting with "trace"
- `class:*Relay*` — any class containing "Relay"
- `method:stream*` — any method starting with "stream"
- Multiple targets comma-separated: `class:MyService,method:stream`

If `APP_DEBUG_CONTEXT_FILTER` is empty, fall back to `APP_DEBUG_CONTEXT_ENABLED` (boolean). If neither, **no debug logs** (production-safe).

### Per-Call Class Identity

Pass the function as the source argument to auto-resolve the class name:

```typescript
function collectMetrics() { /* ... */ }
debugLogger.debug(collectMetrics, { phase: "collect" })
// Output: "DockerContainerMetricsStreamService.collectMetrics {...}"
```

### What to Log Where

| Level | When |
|-------|------|
| `error` | Unhandled exceptions, failed external calls, validation errors after retry |
| `warn` | Recoverable issues, deprecated usage, throttled events |
| `info` | Lifecycle events (start/stop/reconnect), successful external calls at boundaries |
| `debug` | Per-event traces (gated by filter env var) |

### What NOT to Log

- **Never** log full payloads without filtering PII.
- **Never** log credentials, tokens, or secrets.
- **Never** use `console.log` directly — always go through the logger.
- **Never** log inside hot loops (e.g. per-SSE-event) without the filter env var gating it.

---

## 🔴 Testing

### Frameworks

- **Vitest 2.x** (not Jest) — `vi.fn()`, `vi.mocked()`, `vi.mock()`.
- **Imports from `'vitest'`** — not `'@jest/globals'`.
- **Globals enabled** in the shared config: `describe`/`it`/`expect` are global, no imports needed in most tests.

### Test Location Conventions

| Layer | Pattern | Example |
|-------|---------|---------|
| App (`apps/api`, `apps/web`) | `*.spec.ts` colocated with source | `apps/api/src/core/utils/context-filter-logger.spec.ts` |
| Shared package (`packages/*`) | `__tests__/*.test.ts` colocated with source module | `packages/utils/orpc/src/builder/__tests__/error-builder.test.ts` |
| E2E | `*.e2e.spec.ts` with shared Postgres testcontainer setup | `apps/api/vitest.shared-postgres.e2e.ts` |

**Both patterns are intentional.** Do not force one over the other.

### Mocking Patterns

```typescript
// ✅ Vitest native — use vi.fn() and vi.mocked()
const spy = vi.fn<(input: string) => Promise<void>>()
expect(spy).toHaveBeenCalledTimes(1)

// ✅ NestJS testing module — use Test.createTestingModule
const module = await Test.createTestingModule({
  imports: [MyModule],
})
  .overrideProvider(MY_TOKEN)
  .useValue({ execute: vi.fn() })
  .compile()

// ❌ Never use jest.mock() — we're on Vitest
// ❌ Never auto-mock NestJS providers without .overrideProvider
```

### Per-App Setup Files

- `apps/api/vitest.setup.ts` — NestJS test bootstrapping
- `apps/api/vitest.setup.e2e.ts` — e2e setup
- `apps/api/vitest.global-setup.e2e.ts` + `vitest.shared-postgres.e2e.ts` — e2e with shared Postgres container (testcontainers)
- `apps/api/vitest.teardown.e2e.ts` — e2e teardown

### Coverage

- Vitest `v8` provider, outputs to `./coverage`.
- New code: target >80% line coverage on business logic. UI components: snapshot only.

---

## 🔴 Performance — SSE / High-Frequency Streams

### The SSE Update Problem

SSE events fire every ~200ms. Every event triggers a React re-render. Without optimization, this drops FPS to 1-5 and creates visible lag.

### Required Pattern for SSE-Driven Lists

```typescript
// 1. Read the raw stream into state
const liveContainers = useDockerLiveContainers({ reconcileIntervalMs: 60_000 })
const containerEntities = liveContainers.data

// 2. Defer the heavy derivation (map + sort + project) to background
const deferredContainerEntities = useDeferredValue(containerEntities)
const deferredImageEntities = useDeferredValue(imageEntities)

// 3. Heavy work uses the DEFERRED values (UI stays at 60 FPS)
const containers = useMemo(() => {
  return heavyProjection(deferredContainerEntities, deferredImageEntities)
}, [deferredContainerEntities, deferredImageEntities])

// 4. CRITICAL: data the ref/key needs must use NON-DEFERRED values
const nonDeferredContainers = useMemo(() => {
  return heavyProjection(containerEntities, imageEntities)  // ✅ raw, not deferred
}, [buildContainerProjections, containerEntities, imageEntities])
```

**Why split**: `useDeferredValue` defers a value by one render. The ref that the fetch callback reads MUST have the fresh data immediately — otherwise the table shows empty forever.

### Stable References for Heavy Children

When passing callbacks/objects to memoized children (DataTable, etc.), stabilize them:

```typescript
// ✅ Stable callback (only re-created when deps change)
const getDataTableColumns = useCallback(() => containerColumns, [containerColumns])

// ✅ Stable config (empty deps, never re-created)
const dataTableConfig = useMemo(() => ({
  enableRowSelection: true,
  enableSearch: true,
  // ...
}), [])

// ✅ Stable export config
const exportRows = useMemo(() => filteredContainers.map(toExportRow), [filteredContainers])
```

### Modal/Dialog Components

**Always** split heavy modals into two components:

1. **Trigger** (tiny): owns `useState(false)`, renders a button + conditionally mounts the content.
2. **Content** (heavy): owns all state, queries, and JSX. Only mounted when `open === true`.

This avoids running 20+ `useState` and ~10 `useQuery` hooks per row when the modal is closed.

```typescript
export function MyModalTrigger({ id, children }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>{children}</button>
      {open ? <MyModalContent id={id} open={open} onOpenChange={setOpen} /> : null}
    </>
  )
}

function MyModalContent({ id, open, onOpenChange }: MyModalContentProps) {
  // 20+ useState, 10 useQuery, 2k lines of JSX
  // Only runs when open === true
}
```

### React Compiler

This project does **not** have React Compiler enabled (verified by absence of `"react-compiler"` in build configs). All memoization is manual. Be deliberate about `useCallback`/`useMemo`.

### Audit Checklist for SSE/Stream Pages

Before committing a page that consumes a stream:

- [ ] `useDeferredValue` on the heavy derived state
- [ ] Stable callbacks for memoized children (`useCallback` with sensible deps)
- [ ] Stable configs/objects (`useMemo` with `[]` for never-changing values)
- [ ] Heavy modals split into trigger + content
- [ ] Refs for data that must be fresh (not deferred)

---

## 🔴 Bun Runtime Rule (Mandatory)

**Always use `bun --bun run <script>`** — never bare `bun run`, never `bun build`/`bun test`. The `--bun` flag forces the entire process tree to use Bun's runtime.

**Required for**:

- `bun:sqlite` / `bun:` protocol imports
- Consistent module resolution for `zod/v4` and other ESM packages
- Avoiding `Error: Only URLs with a scheme in: file, data, and node are supported`

```bash
# ✅ Correct
bun --bun run test
bun --bun run build
bun --bun run dev
bun --bun run web -- dr:build

# ❌ Wrong
bun run test
bun --bun build
bun test
```

---

## 🔴 MCP-First Workflow

**Before any change**, load repo context via MCP:

1. `repo://summary` — overview
2. `repo://apps` and `repo://packages`
3. `repo://agents` — index of all AGENTS.md files
4. Resource templates for the targets:
   - `repo://app/{name}/package.json`
   - `repo://app/{name}/dependencies`
   - `repo://package/{name}/package.json`
   - `repo://package/{name}/dependencies`
   - `repo://graph/uses/{name}`
   - `repo://graph/used-by/{name}`

### Error Recovery Protocol

When an MCP action returns an error:

1. **Attempt fix immediately** (smallest corrective action first).
2. Examples: add missing script via `add-script`, add missing dependency via `add-dependency`, start required service with `docker-up`.
3. Retry up to 2 times before escalating.
4. Surface the exact tool call + parameters + error.

### Mandatory MCP Tools by Area

| Area | Tool | Purpose |
|------|------|---------|
| Repo-wide | `docker-up { mode: dev\|prod, target: api\|web\|all }` | Start dev stack |
| API | `auth-generate` | Regenerate auth schema/types after `src/auth.ts` change |
| API | `api-db { action: "generate"\|"push"\|"migrate"\|"seed"\|"reset"\|"studio" }` | DB lifecycle |
| Web | `run-script` for `dr:build`/`dr:build:watch` | Regenerate declarative routes |
| UI | `ui-add { components: [...] }` | Add Shadcn components to `@repo/ui` |
| Packages | `run-script`, `bump-version`, `list-internal-dependencies` | Impact analysis |

### Local vs Docker Execution

- **Local** (host): `auth-generate`, `api-db generate/push/migrate`, `ui-add`, `run-script` (type-check/lint/build).
- **Docker** (container): `api-db seed`, anything needing `api:3001` container networking (e.g. `bun --bun run dev:api:run` then `bun --bun run db:seed`).

---

## 🔴 Documentation Maintenance Protocol

When you introduce ANY new concept, pattern, technology, or significant implementation approach, you MUST create comprehensive documentation.

### What Constitutes a "New Concept"

Document whenever you add or implement:

1. **New Technologies or Libraries**: Any new dependency, framework, or tool
2. **New Design Patterns**: Architectural patterns, coding conventions, or structural approaches
3. **New Development Workflows**: Build processes, deployment strategies, or development procedures
4. **New API Patterns**: Endpoint structures, authentication methods, or data handling approaches
5. **New UI/UX Patterns**: Component structures, styling approaches, or interaction patterns
6. **New Configuration Systems**: Environment setups, build configurations, or deployment configs
7. **New Testing Approaches**: Testing strategies, tools, or methodologies
8. **New Performance Optimizations**: Caching strategies, bundling approaches, or optimization techniques
9. **New Security Implementations**: Authentication flows, authorization patterns, or security measures
10. **New Integration Methods**: Third-party service integrations or inter-service communication patterns

### Creation Process

1. **Determine Documentation Scope**
   - **Minor Enhancement**: Update existing MDX page in `apps/doc/content/docs/`
   - **Major Feature**: Create a dedicated MDX file in the appropriate `apps/doc/content/docs/<section>/` subdirectory
   - **Cross-cutting Concern**: Update multiple related MDX pages
2. **Create/Update Documentation** (use the template below)
3. **Update Reference Systems** (this file + architecture + tech-stack)

**Documentation Template:**

```markdown
# [Concept Name]

## Overview
Brief description of what this concept is and why it was added.

## Implementation
How it's implemented in this project.

## Usage Examples
Practical examples with code snippets.

## Configuration
Any configuration required.

## Best Practices
Recommended approaches and patterns.

## Troubleshooting
Common issues and solutions.

## Related Documentation
Links to related concepts and documentation.
```

### When NOT to Add a New Doc Page

If the change is a minor tweak to an existing concept, just update the existing MDX page — don't create a new one.

---

## 🔴 Git Workflow

### Commit Policy (from root `AGENTS.md`)

Use **conventional commits** with feature-area scopes:

```text
feat(mcpRepoManager): Add list-agents tool
fix(webRouting): Resolve route gen race
refactor(dockerEntity): Enforce Zod validation at stream boundary
docs(copilot): Add strict typing rules
chore(deps): Bump zod to 4.5
test(api): Add coverage for entity stream validation
```

**Keep commits focused and logically grouped.** A PR for a new feature should have:

- 1 commit for the contract
- 1 commit for the API implementation
- 1 commit for the web consumption
- 1 commit for the documentation

### Safety Boundaries

- **Never** remove or rename workspace packages without explicit instruction.
- **Never** make direct edits to generated files (`src/routes/index.ts`, `src/routes/openapi.ts`, Drizzle generated files).
- **In `v3/`**: **no temporary compatibility layers** (no legacy files, no alias exports, no shim wrappers, no duplicate entrypoints).
- **Structural changes**: update all affected imports/tests/docs in the same change set. Remove old files immediately.
- **Never** commit `.env`, secrets, or generated bundle files.

### Branch Naming

- `feat/<scope>` for new features
- `fix/<scope>` for bug fixes
- `refactor/<scope>` for internal refactors
- `docs/<scope>` for documentation only
- `chore/<scope>` for maintenance

---

## 🔴 Change Order & Validation

### Standard Change Order (API + Web)

When changing a contract or its consumer, work in this order:

1. **Contract first** (`packages/contracts/api/modules/<domain>/<op>.ts`):
   - Update the Zod input/output schemas
   - Update the `xxxContract` builder
   - Add the route to the module index
2. **API implementation** (`apps/api/src/modules/<domain>/`):
   - Update the controller (handler signature)
   - Update the service (returns the new shape)
   - Add `z.parse` if external data is involved
3. **Route regeneration** (web):
   - `bun --bun run web -- dr:build`
4. **Web implementation** (`apps/web/src/domains/<domain>/`):
   - Update the hook to use the new contract
   - Update the consuming component
5. **Documentation** (in the same PR):
   - Update `apps/doc/content/docs/dev/orpc.mdx` or relevant page
   - Update this file if the rules change
   - Update the architecture docs if the structure changes
6. **Validation** (before commit):
   - `bun --bun run web -- type-check`
   - `bun --bun run api -- type-check`
   - `bun --bun run test`
   - Manual smoke test of the affected flow

### Validation Rules

- **Every commit must type-check** on both apps. No `// @ts-ignore` to bypass.
- **Every commit must pass tests**. New behavior = new test.
- **No silent type weakening**. If a type doesn't fit, fix the type, not the contract.
- **Audit before commit**:
  ```bash
  grep -rn "as unknown as\|@ts-ignore" apps/ packages/
  ```
  Zero results expected for new code.

---

## 🔴 Engineering Mindset & Operating Posture

> This section codifies the **engineering culture** of this repository. These are not aspirations — they are rules. The LLM working on this repo has **unlimited time, context, and tool-call budget**. The ONLY goal is to **perfectly finish the work the user intended**, nothing less. Anything less is a failure.

### No Budget

- **You have unlimited time, context, and tool calls.** The cost of being thorough is always lower than the cost of being wrong or leaving half-finished work. The user has explicitly stated: there is no budget — keep working until the work is perfect.
- **Never take shortcuts to "save effort".** No "this is good enough" — perfect is the bar. No "I should stop here" — keep going. No "this is out of scope" — if it's related to the task and improves the result, it's in scope.
- **The "perfect finish" includes cleanup.** If the task forces touching 3 files, but you discover 2 more that should also be touched, touch them. If a refactor would prevent 5 future bugs, do it now. If a doc is now wrong, fix it. The work isn't done until the codebase is in a *better* state than before you started.

### Goal: Finish the Work the User *Intended*, Not Just the Work They Asked For

- The user said: "the only goal is to perfectly finish the work the user intended."
- This is a crucial distinction. The user **asks** for things in terms of immediate symptoms, but their **intent** is the deeper outcome.
- **Example**: User says "the docker page crashes when status is undefined". The *task* is "fix the crash". The *intended work* is "make the docker page robust against missing data, period — at the contract level, at the producer level, at the consumer level, with no defensive guards, with full type safety, with tests, with docs updated."
- If the user asks to fix a bug, the work isn't done when the bug stops crashing — it's done when the *class of bug* is impossible to write again.

### Ask When Uncertain

- **If you lack context, don't have enough information, or are unsure about user intent — STOP and ask.** Don't guess. Don't assume. Don't fabricate a default and run with it.
- **Surface 2-3 specific questions with concrete options.** "Do you want A or B?" is better than "What do you want?" Always give the user something to react to.
- **Re-read the user's message multiple times** before deciding you don't need to ask. The answer is often in the wording.
- **When in doubt about a principle, follow the stricter option.** When in doubt between two valid approaches, ask. When in doubt about scope, do more (within "no bridges" / "no YAGNI" / "no temp code" constraints).

### Never Silently Degrade

- **Don't downgrade a strict type to a loose one to make code compile.** Fix the type, fix the schema, or write a `to*` function.
- **Don't swallow an error.** Empty catch blocks are a lie.
- **Don't add a defensive `?? ""` to silence a warning.** If the field can be empty, fix the schema. If the schema says non-null, the type is non-null — don't question it.
- **Don't disable an ESLint rule to make it pass.** Fix the code, refactor the abstraction, or (rarely) propose a config change.
- **Don't use `// eslint-disable-next-line` to silence a real problem.** Same as above.
- **Every degradation is a lie the runtime will eventually expose.** Types are documentation that the runtime can check. Bypassing types = bypassing the check.

### Development Project, Not Production

- **The user said: "this is not well a production app... the llm should see this like a developpement project where all changes are non breaking and should be check for workness and not for backward compatibility unless requested by the user"**
- **Breaking changes are FINE here.** Renaming a function, deleting a column, restructuring a module — all fine, all expected, all part of the work.
- **No backward-compat layers unless explicitly asked.** If you replace `oldThing` with `newThing`, delete `oldThing`. Don't keep it. Don't add a `legacyAdapter`. Don't add `@deprecated` JSDoc and keep the code. Just delete it. Update all call sites in the same change set.
- **Workness over compatibility.** Does the code work correctly NOW? That's the bar. Does it work the same as the old code? Doesn't matter.
- **"The codebase is in active development" is the default assumption.** Refactor freely, rename freely, restructure freely. The work isn't done until the result is the best version of itself.

---

## 🔴 Pre-Work Investigation Protocol

> **Before writing a single line of code, you MUST investigate.** Skipping this step is the #1 source of bad code in this codebase.

### Read Relevant AGENTS.md First

- Always read the **root** `AGENTS.md` first.
- Then read the **nearest scoped** `AGENTS.md` (e.g. `apps/web/AGENTS.md` for web code, `apps/api/src/system/AGENTS.md` for system code).
- If a local `AGENTS.md` contradicts root, **the local one wins** for that scope.

### Check If the Implementation Already Exists

- **Before writing a new utility / type / component / hook / service, search for existing implementations.**
  - `grep_search` for the function, component, type, schema name.
  - `semantic_search` for the concept ("where is X handled?", "how do we do Y?").
  - Look in the obvious places: `packages/utils/`, `packages/ui/`, `packages/contracts/`, `packages/nest/`, `apps/api/src/modules/<domain>/services/`, `apps/web/src/domains/<domain>/`.
- **If you find it — USE it, don't re-implement.** Re-import. Re-export. Wrap if needed. Never duplicate.
- **If you find something similar but not identical — read it carefully.** Maybe what you need is already there with a slightly different name. Maybe extending it is the right move.

### Find All Call Sites

- **Before changing the signature, name, or behavior of anything, find every place it's used.**
  - `grep_search` for the symbol, type, function name across `apps/` and `packages/`.
  - Use the LSP rename preview (`vscode_renameSymbol` with no new name) to see the full impact.
  - List usages (`vscode_listCodeUsages`) to enumerate callers.
- **Read each call site.** Note what behavior they depend on. If a caller relies on the old shape, it must be updated.
- **If a call site can be improved, improve it in the same change set.** Don't leave a half-updated codebase.

### Check the Related Code

- **What imports the thing you're changing? What does it import?** Check the dependency graph.
- **What depends on the same data structure?** If you change a Zod schema, every consumer is affected.
- **What uses the same pattern?** If you're introducing a new pattern, check whether existing code should be migrated to it.
- **What is adjacent to what you're changing?** Read the sibling files. Read the parent file. Read the test file. Read the docs page.

### Check for Dead Code

- **Use `knip`** (configured in `knip.config.ts`) to detect unused files, exports, dependencies, types, etc. Run it before any non-trivial change.
- **For each thing `knip` reports as unused**: delete it. Don't preserve "just in case." The "just in case" defense is a lie — if no one uses it, no one will use it.
- **Also do manual greps** for things `knip` might miss:
  - `grep -rn "TODO\|FIXME\|XXX\|HACK" apps/ packages/` — each one is a candidate for resolution or deletion.
  - `grep -rn "as unknown as\|@ts-ignore\|@ts-expect-error" apps/ packages/` — each one is a bug in disguise.
  - `grep -rn "console\.\(log\|debug\|info\|warn\|error\)" apps/api/ apps/web/` — each one is a logging primitive bypass.

### When Implementing a New Concept, Check Everywhere

- **The user said**: "when implementing a new concept it should check everywhere to see if this context can not be applied else where."
- **When you introduce a new pattern, ask: "Where else does this apply?"** If you add a new Zod-based type-safety pattern, find every place that does the same thing without Zod. If you add a new error builder, find every place that throws plain `Error`. Migrate them.
- **When you fix a bug, ask: "Where else could this bug exist?"** The same mistake often appears in 3-5 sibling files. Find them all. Fix them all.

---

## 🔴 DRY — Don't Repeat Yourself

> Every piece of knowledge in the system must have a **single, authoritative, unambiguous representation**. Duplication is the root of all inconsistency bugs.

### The Three Strikes Rule

- **Two similar implementations**: tolerate, but add a `// TODO: extract if a third appears` comment.
- **Three occurrences**: extract to a function, type, hook, or constant. No exceptions.
- **Never "extract prematurely"** (see YAGNI), but **never let two copies exist long-term**. Two is the trigger to start looking; three is the trigger to extract.
- **Already-extracted function in 2+ files**: extract to a shared package (see Monorepo Package Boundaries).

### DRY at Every Layer in This Monorepo

| Duplication type | Where it must live | What to do |
|------------------|--------------------|------------|
| Zod entity schema | `packages/contracts/entities/` | Re-import, never re-declare |
| Zod input/output schema for a contract | `packages/contracts/api/modules/<domain>/` | Re-import in the contract, never re-declare in handler |
| ORPC error definition | `packages/utils/orpc` (`error()` builder) | Re-import, never redefine inline |
| ORPC mesh error contracts | `meshDomainErrorContracts(error)` from `@repo/utils-orpc` | Always spread into contract `.errors(...)` |
| Shadcn component | `packages/ui/base/` | `ui-add { components: [...] }` to add, then re-import via `@repo/ui` |
| Custom hook | `apps/web/src/hooks/` (app-specific) or `packages/utils/` (shared) | Re-import |
| Service / Repository | `apps/api/src/modules/<domain>/services/`, `repositories/` | Re-import via NestJS module exports |
| Logger | `AppLogger` from `@repo/utils-logger` | Re-import, never use `console.log` |
| Auth helper | `packages/utils/auth/` (Better Auth factories) | Re-import |
| Env var access | `apps/api/src/config/`, `apps/web/src/lib/config.ts` | Re-import the parsed config, never `process.env.X` scattered |
| Route | `apps/web/src/routes/index.ts` (auto-generated) | Use the typed `<Route>.Link` and `<Route>.fetch` |
| Magic number / string | `packages/types/` or `_constants.ts` in the feature | Extract to a named constant |

### Anti-Patterns

- ❌ Copy-paste from one file to another (the most common DRY violation).
- ❌ "I'll just duplicate it for now and refactor later" — you won't. Refactor now.
- ❌ Slight variations of the same logic (e.g. `formatDate` and `formatDateShort` and `formatDateLong` — pick one, parameterize it).
- ❌ Two files that both "own" the same concept (a schema in two places, a config in two places).

---

## 🔴 KISS — Keep It Simple, Stupid

> The simplest solution that works is the best solution. Complexity is a cost, not a feature.

### Principles

- **Prefer the simpler solution that works.** Don't introduce abstractions, patterns, or libraries unless the current code forces it.
- **One function = one job.** If a function does two things, split it. If a function does three things, it should be three functions.
- **One file = one concept.** If a file has 3 unrelated exports, split it into 3 files.
- **One module = one responsibility.** If a module has services for 2 unrelated domains, split it into 2 modules.
- **No "clever" code.** Cleverness is a code smell. Boring code is good code. If you need a comment to explain the cleverness, the code is too clever.
- **Reduce cyclomatic complexity.** If a function has 5+ nested ifs, refactor it:
  - Extract functions for each branch.
  - Use early returns (`if (!valid) return null`).
  - Use lookup tables (`{ "running": handleRunning, "stopped": handleStopped }`).
  - Use polymorphism via discriminated unions.
- **Boring is good.** The best code is the code that the next developer reads and immediately understands.

### Anti-Patterns

- ❌ Over-engineered abstractions for hypothetical flexibility.
- ❌ Generic-everything (`<T>` for one concrete type, `Factory<Factory<Factory<T>>>` for one use case).
- ❌ "We might need this flexibility later" (that's YAGNI; see next section).
- ❌ Design patterns applied where they don't fit (Strategy for one branch, Decorator for one method).
- ❌ Metaprogramming / codegen when a simple type/function would do.

---

## 🔴 YAGNI — You Aren't Gonna Need It

> Don't add functionality until it's needed. **Speculative code is a debt, not an asset.**

### Principles

- **Don't add features, parameters, options, or fields that aren't needed right now.** "We might need it later" is **forbidden**. Add it when the need arises, not before.
- **Don't add "future-proof" abstractions.** If you have one implementation and one consumer, don't introduce an interface. If you have one branch, don't make it a switch.
- **Don't keep "temporary" code.** "Temporary" code lives forever. Either:
  - Commit to it: refactor it to be production-quality, document it, test it.
  - Delete it: it's temporary, after all — so it's safe to remove.
- **Don't add commented-out code.** Git remembers. `git log -p` will find it. Delete it.
- **Don't add `@deprecated` JSDoc and keep the code.** `@deprecated` is a roadmap to deletion, not a tombstone. Either:
  - Delete the code now and fix all call sites.
  - Keep using the code without `@deprecated` until you have a plan to delete it.
- **Don't add "TODO: refactor later" comments.** They never happen. Either refactor now, or don't add the TODO. If you must add a TODO, give it a tracking issue ID and a deadline.

### The "Just In Case" Trap

- ❌ "I'll add a `defaultValue` parameter in case we need to override it later." — YAGNI. Add the parameter when the second use case appears.
- ❌ "I'll add a try/catch around this just in case." — If the catch is empty, it's a lie. If it's not empty, it should log + rethrow.
- ❌ "I'll add a `validate` function we might need." — Delete it. Add it when you actually need to validate.
- ❌ "I'll add a config option for this in case ops needs to tweak it." — YAGNI. Add it when ops actually asks.

### Anti-Patterns

- ❌ Speculative generality (paraphrasing Fowler): "A class with abstract methods that no one calls."
- ❌ Defensive code that protects against impossible cases.
- ❌ Configuration for things that have one value.
- ❌ Feature flags without a rollout plan.

---

## 🔴 SSOT — Single Source of Truth

> Every concept has exactly one definition. Every value has exactly one origin. The codebase is a tree of references, not a forest of duplicates.

### Principles

- **One definition per concept.** A type has one definition. A constant has one definition. A function has one definition.
- **One origin per value.** A URL has one constant. A timeout has one constant. A magic string has one constant.
- **One source of truth per external dependency.** `process.env.X` is read in one place. `fetch` is called through one client. `PrismaClient` is instantiated once.

### Single Sources in This Monorepo

| Concept | Source of truth | NEVER duplicate by... |
|---------|-----------------|------------------------|
| Zod entity schemas | `packages/contracts/entities/src/entities/<domain>/` | Re-declaring in `apps/` or `packages/contracts/api/` |
| ORPC contract definitions | `packages/contracts/api/modules/<domain>/<op>.ts` | Inlining into a controller |
| Env vars | `apps/api/src/config/`, `apps/web/src/lib/config.ts` | `process.env.X` in business code |
| App config | `bunfig.toml`, `turbo.json`, per-app `package.json` | Re-declaring in code |
| Routes | `apps/web/src/routes/index.ts` (auto-generated) | Hardcoded `href="/foo"` strings |
| Database schema | `apps/api/src/db/drizzle/schema/` | Re-declaring column types in TS |
| Auth | `apps/api/src/auth.ts` | Re-implementing auth checks in handlers |
| Logger | `AppLogger` from `@repo/utils-logger` | `console.log` |
| ORPC client | `apps/web/src/lib/orpc.ts` | Re-creating the client per request |

### Anti-Patterns

- ❌ Two Zod schemas that describe the same shape (use one, re-import).
- ❌ Two constants for the same value (`MAX_RETRIES = 3` in two files).
- ❌ Two type definitions for the same concept (`UserId = string` in two files).
- ❌ Two ways to do the same thing (`getUser` and `fetchUser` and `loadUser`).

---

## 🔴 Separation of Concerns

> Each unit of code should have **one reason to change**. Mixing concerns creates the need to change the same file for unrelated reasons, which causes merge conflicts, hidden coupling, and surprise bugs.

### Layered Architecture

| Layer | Responsibility | Knows about | Knows NOTHING about |
|-------|----------------|-------------|---------------------|
| **Controller** (`apps/api/src/modules/<domain>/controllers/`) | HTTP boundary, ORPC, auth middleware, status codes, request correlation | ORPC, NestJS, `@Implement()`, `implement()`, `requireAuth()` | Business rules, database, external services |
| **Service** (`apps/api/src/modules/<domain>/services/`) | Business logic, orchestration, domain validation, transaction management | Domain types, repositories, other services, `AppError` | HTTP, ORPC, status codes |
| **Repository** (`apps/api/src/modules/<domain>/repositories/`) | Data access, external IO, query construction | Drizzle, `dockerode`, external APIs, Zod | Business rules, ORPC, controllers |
| **Schema** (`packages/contracts/entities/`) | Data shape, runtime validation | Zod | Runtime behavior, side effects |
| **Component** (`apps/web/src/app/<feature>/_components/`) | Presentation, UI, props, callbacks | React, Tailwind, Shadcn | Data fetching, business logic |
| **Hook** (`apps/web/src/app/<feature>/_hooks/` or `domains/<domain>/hooks.ts`) | Reusable stateful logic, query subscriptions | React, TanStack Query, ORPC | UI rendering, layout |
| **Route** (`apps/web/src/app/<feature>/page.tsx`) | Composition of components, hooks, data | Everything in the feature | Nothing in sibling features |

### The Rule of "One Reason to Change"

- A controller changes because ORPC changed. Not because the business rule changed.
- A service changes because the business rule changed. Not because the database changed.
- A repository changes because the storage changed. Not because the business rule changed.
- A component changes because the UI changed. Not because the API changed.

If a file changes for multiple unrelated reasons, **split it**.

### Anti-Patterns

- ❌ Business logic in a controller.
- ❌ SQL in a service.
- ❌ `fetch()` in a component.
- ❌ "God service" that handles 5 unrelated domains.
- ❌ "God component" that renders 4 unrelated UI sections.

---

## 🔴 Type-Driven Development — Make Illegal States Unrepresentable

> The best validation is the type system itself. **The compiler should reject code that would crash at runtime.**

### Principles

- **Parse, don't validate.** A type that distinguishes "loading" / "success" / "error" is better than a nullable + a flag.
- **Make illegal states unrepresentable.** If two values can't both be present, use a discriminated union. If a value can never be empty, use `z.string().min(1)`.
- **The type IS the spec.** Read the Zod schema and you know exactly what the data looks like. Read the TS type and you know exactly what the function accepts and returns.

### Examples

```typescript
// ❌ Validated at runtime, fails at runtime
type Container = {
  status: "running" | "stopped"
  pid: number | null      // null when stopped, but compiler doesn't know
  exitCode: number | null // null when running, but compiler doesn't know
}

if (container.status === "running" && container.pid === null) {
  // runtime crash — the type allowed it
}

// ✅ Discriminated union, impossible to misread
type Container =
  | { status: "running"; pid: number }
  | { status: "stopped"; exitCode: number }

if (container.status === "running") {
  // compiler narrows: container.pid is number, container.exitCode is impossible
  process.kill(container.pid)
}
```

### In This Monorepo

- **Zod discriminated unions** for: stream chunks (`kind: "container" | "image" | "network" | "volume"`), ORPC errors (`code: "NOT_FOUND" | ...`), query states (`status: "loading" | "success" | "error"`).
- **Zod `.refine()` and `.superRefine()`** for cross-field validation.
- **Zod `.brand()`** for nominal types (e.g. `UserId`, `ContainerId` — same shape as `string`, but not interchangeable).
- **`as const` + Zod** for literal enums (`z.enum(["running", "stopped"])`).
- **Zod `.default()` for required-with-default fields** (e.g. `ports: z.array(...).default([])`). The default is applied at parse time, so the inferred type is non-nullable.

### Anti-Patterns

- ❌ Nullable fields where one branch is always present.
- ❌ Boolean flags that imply state (`isLoading: true, isError: false, data: null` — use a discriminated union).
- ❌ Throwing at parse time for "validation" (parse means the data is valid; throw means it isn't).
- ❌ Validating in business code what the type system could enforce.

---

## 🔴 Error Handling Philosophy

> Errors are values, not strings. **An error is data: code, message, context, cause, request-id.** Treat them as first-class.

### Principles

- **Throw typed errors at the right layer.**
  - **Service layer**: throw `AppError` subclasses (`NotFoundError`, `ConflictError`, `ValidationError`, ...). Services don't know about HTTP.
  - **Controller layer**: throw ORPC errors (`throw new ORPCError("NOT_FOUND", { data: { id } })`). The global filter maps to HTTP.
  - **Repository layer**: let the underlying error propagate (don't catch+rewrap unless adding context). Wrap with the operation name when re-throwing.
- **Never throw `new Error(...)`.** Bypasses the error code + context pipeline. Use `AppError` or a subclass.
- **Never swallow errors.** Empty catch blocks are a lie. At minimum: log + rethrow or return an error value.
- **Never `catch (e) { console.log(e) }`.** Use the structured logger with the operation name, the failing input, the request-id.
- **Errors should be informative.** Include the failing input, the operation, the resource identifier, the request-id. Generic "Something went wrong" is not acceptable.
- **Fail fast.** Detect errors as early as possible. Validate at the boundary. Don't let bad data flow through 5 layers before crashing.
- **No silent degradation.** If a function can't do its job, it must surface that. Don't return `null` when the operation failed — return an error value or throw.

### When to Throw vs Return

- **Throw**: exceptional conditions that the caller can't reasonably handle (network failure, validation failure, not-found).
- **Return**: expected outcomes that the caller must handle (a list might be empty, a search might return no results).
- **Never return `null` to mean "error"**. Use a discriminated union (`{ kind: "ok", data } | { kind: "error", error }`) or a Result type.

### Anti-Patterns

- ❌ `try { ... } catch (e) { /* nothing */ }` — silent failure.
- ❌ `try { ... } catch (e) { console.log(e) }` — no context, no correlation, lost stack.
- ❌ `throw new Error("Something went wrong")` — no code, no context, no recovery path.
- ❌ Return `null` on error — caller has to know to check.
- ❌ Return `-1` or `0` to mean "not found" — magic numbers.

---

## 🔴 Composition & Open/Closed Principle

> **Compose behavior from small, focused pieces.** **Extend without modifying.**

### Composition Over Inheritance

- **Prefer composition.** A `DockerContainer` is composed of `dockerPortBinding[]`, `dockerNetwork[]`, `dockerVolume[]`, etc. — not inherited from.
- **Use composition for shared behavior.** Wrapping a function in a higher-order function is usually better than extending its class.
- **No `extends` in service code.** Use interfaces + DI tokens, not class inheritance.
- **Mixins / hooks / HOCs for shared behavior** in React, not class inheritance.

### Open/Closed Principle

- **Open for extension, closed for modification.** When adding a new variant (e.g. a new docker entity type: container, image, network, volume), add a new branch to the discriminated union — don't modify existing branches.
- **Discriminated unions enforce exhaustiveness.** `switch (kind) { case "container": ...; case "image": ...; default: assertNever(kind) }`.
- **Polymorphism via discriminated unions, not via `instanceof`.** `if (entity instanceof Container)` couples you to the class. `if (entity.kind === "container")` couples you to the type.

### Patterns to Know (and When to Use Them)

| Pattern | When to use | When NOT to use |
|---------|-------------|-----------------|
| **Builder** (`buildXxx(input)`) | Constructing a value that must satisfy a discriminated union or complex invariant | Simple object literals |
| **Factory** (`createXxx()`) | Choosing an implementation at runtime based on input | When there's only one implementation |
| **Strategy** (passing a function) | Swapping algorithms at runtime | When there's only one algorithm |
| **Adapter** (wrapping a third-party API) | When a library's API doesn't match your domain types | When the library already matches |
| **Facade** (a single class that exposes a simple API over a complex subsystem) | When the subsystem is large and used from many places | When the subsystem is small |
| **Decorator** (wrapping a function with extra behavior) | Cross-cutting concerns (logging, retry, cache) | Single-call-site code |
| **Observer** (event emitters) | Decoupling producers from consumers | Direct call is fine |
| **Repository** | Abstracting data access | Direct calls are fine for one-off scripts |
| **Service** | Encapsulating business logic that spans multiple repositories | Logic that fits in one function |
| **Value Object** | Domain concept with no identity (Money, DateRange, EmailAddress) | Plain primitives work fine |

---

## 🔴 Dependency Inversion (DI Tokens)

> High-level modules should not depend on low-level modules. Both should depend on abstractions. **Abstractions should not depend on details. Details should depend on abstractions.**

### Principles

- **Depend on abstractions, not concretions.** Use string-based DI tokens for repositories and external services.
- **Inject, don't import.** A service should not `import { PrismaClient }` directly — it should `inject(DATABASE_TOKEN)`.
- **The DI token is the contract.** The interface (and the abstract base class, if any) defines what callers can rely on.

### Examples

```typescript
// ❌ Direct import — couples service to the database
import { PrismaClient } from "@prisma/client"

@Injectable()
export class UserService {
  private prisma = new PrismaClient()  // ❌ new, not injected
  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } })
  }
}

// ✅ DI token — service depends on the abstraction
export const USER_REPOSITORY = "USER_REPOSITORY" as const

export interface UserRepository {
  findById(id: string): Promise<User | null>
  create(input: CreateUserInput): Promise<User>
}

@Injectable()
export class UserService {
  constructor(@Inject(USER_REPOSITORY) private users: UserRepository) {}
  async findById(id: string) {
    return this.users.findById(id)
  }
}
```

### When to Use DI Tokens

- **Always for repositories.** `DOCKER_REPOSITORY`, `USER_REPOSITORY`, `MESH_CLIENT`.
- **Always for external service clients.** `DOCKER_SOCKET_CLIENT`, `MESH_CLIENT`, `REDIS_CLIENT`.
- **Always for shared infrastructure.** `LOGGER`, `CONFIG`, `DATABASE`.
- **Rarely for one-off utilities.** If a class has one implementation and one consumer, you can use a direct import — but lean toward DI for consistency.

### NestJS Wiring

```typescript
@Module({
  providers: [
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: LOGGER, useValue: new AppLogger("api") },
    UserService,
  ],
  exports: [USER_REPOSITORY, UserService],
})
export class UserModule {}
```

### Anti-Patterns

- ❌ `new SomeService()` inside another service (skipping the DI container).
- ❌ Direct `import { DbClient }` in a service file.
- ❌ Singleton state held by a module (not by a class).
- ❌ Implicit dependencies via global variables or `process.env` scattered in services.

---

## 🔴 Monorepo Package Boundaries

> The monorepo is a **tree of packages**, not a soup of files. **Packages have boundaries. Dependencies cross boundaries explicitly. If two things are shared by 2+ apps, they must live in a package.**

### When to Create a Package

| Situation | Action |
|-----------|--------|
| Used in 1 file in 1 app | Keep there. No extraction. |
| Used in 2+ files in 1 app | Extract to a local module (`apps/<app>/src/lib/<thing>.ts` or `<area>/<thing>.ts`). |
| Used in 2+ apps | Extract to a **shared package** in `packages/`. |
| Used in 1 app and 1 package | Extract to a shared package. |
| Used in 3+ packages (including apps) | Extract to `packages/utils/` or `packages/contracts/`. |
| A new external dependency is needed | Discuss with the user before adding — must be lightweight, well-maintained, and TypeScript-native. |

### The Packages That Already Exist (Know These Before Adding a New One)

| Package | Purpose | When to add a new export here |
|---------|---------|--------------------------------|
| `packages/utils/orpc` | ORPC builder helpers (`standard.zod`, error builders, mesh errors) | Adding a new error type, a new standard operation, or a new contract helper |
| `packages/utils/logger` | Pino + `ContextFilterLogger` | Adding a new logger method, env-var-gated feature, or log channel |
| `packages/utils/auth` | Better Auth factories | Adding a new auth provider, session helper, or permission check |
| `packages/utils/use-safe-query-param-states-from-zod` | URL state from Zod | Adding new URL-state helpers |
| `packages/contracts/entities` | All Zod entity schemas (docker, mesh, etc.) | Adding a new entity schema — never re-declare elsewhere |
| `packages/contracts/api` | All ORPC contracts (input/output/error definitions) | Adding a new ORPC contract |
| `packages/ui/base` | Shadcn components + project-specific UI primitives | Adding a new shared component via `ui-add` |
| `packages/types` | Shared TypeScript types (no runtime) | Adding a shared type that has no runtime representation |
| `packages/configs/{eslint,typescript,vitest,prettier,tailwind}` | Shared configs | Adding a new shared config |
| `packages/nest` | NestJS shared modules, decorators, guards | Adding a new shared NestJS primitive |
| `packages/bin` | Internal CLI binaries | Adding a new internal CLI |

**Before creating a new package**, exhaustively check whether one of the above already serves the purpose. If not, use the `create-package` MCP tool.

### Package Boundary Rules

- **No circular dependencies.** Use the dependency graph (`repo://graph/uses/{name}`) to verify.
- **Lower-level packages must not import from higher-level packages.** `packages/contracts/entities` must not import from `apps/api`. `packages/utils/logger` must not import from `packages/contracts/api`.
- **Apps depend on packages; packages depend on packages; never the other way around.** `apps/*` is the top of the dependency graph.
- **Public API of a package is its `index.ts`.** Don't reach into deep paths from outside (`import { foo } from "packages/utils/logger/src/internal/foo"`).
- **Tests are colocated.** App code: `*.spec.ts` next to source. Package code: `__tests__/*.test.ts` next to source module. Don't put tests in a separate `test/` package.

### Anti-Patterns

- ❌ Copy-pasting a util from one app to another instead of extracting to a package.
- ❌ Two apps each implementing the same auth check.
- ❌ Two apps each defining the same Zod schema.
- ❌ Reaching into a package's internals from another package.
- ❌ Circular dependencies between packages.

---

## 🔴 Code Smell Catalog

> A "code smell" is a surface-level indicator that **something is wrong deeper**. Most smells have a known fix. Look them up in Fowler's *Refactoring* when you see them.

### Common Smells and Fixes

| Smell | Indicator | Fix |
|-------|-----------|-----|
| **Long Function** | >50 lines | Extract Function. One job per function. |
| **Long File** | >500 lines | Split by concept. One file = one concept. |
| **Long Parameter List** | >4 params | Introduce Parameter Object. Or use a discriminated union input. |
| **Deep Nesting** | >3 levels of indentation | Use early returns. Replace Conditionals with Polymorphism. |
| **Boolean Parameters** | `doThing(x, true, false)` | Split into two functions, or use a discriminated union option. |
| **Comments Explaining "What"** | `// loop through users` above a `for` loop | Delete the comment — the code says what it does. Comment the *why* instead. |
| **Commented-Out Code** | `// const x = ...` | Delete it. Git remembers. |
| **Dead Code** | Unused exports, unused imports, unreachable branches | Delete it. No "just in case." |
| **Magic Numbers/Strings** | `if (retries > 3)` | Named constant: `MAX_RETRIES = 3`. |
| **Speculative Generality** | `// might need this later` | Delete it. YAGNI. |
| **Duplicate Code** | Same logic in 2+ files | Extract Function. Or extract to a shared package. |
| **Alternative Classes with Different Interfaces** | `UserRepoV1`, `UserRepoV2` | Pick one. Delete the other. Update all callers. |
| **Inappropriate Intimacy** | A class reaches into another's private state | Move Method/Field. Or use composition. |
| **Feature Envy** | A method uses another class's data more than its own | Move Method. |
| **Refused Bequest** | A subclass overrides most of the parent's methods | Replace Inheritance with Delegation. |
| **Lazy Class** | A class that does almost nothing | Inline Class. |
| **Data Class** | A class with only fields and getters | Move behavior to it. Or delete it. |
| **Primitive Obsession** | `string` for a UserId, `string` for an Email | Value Object. Or Zod brand. |
| **Switch Statements** | `switch (kind) { case "x": ... }` | Replace Conditional with Polymorphism. Or keep the switch but make it exhaustive. |
| **Parallel Inheritance Hierarchies** | Adding a subclass in one place requires adding one elsewhere | Move Method/Field. Or restructure. |
| **Speculative Generality** | Abstract methods no one calls | Delete them. |
| **Temporary Field** | An instance variable that's only set in some cases | Extract Class. Or use a discriminated union. |
| **Message Chains** | `a.getB().getC().getD().getE()` | Hide Delegate. Or use a Law of Demeter check. |
| **Middle Man** | A class whose only job is to delegate to another | Remove Middle Man. Inline the call. |
| **Inappropriate Placement** | A class in a package that doesn't fit its concept | Move Class. |
| **Incomplete Library Class** | A library doesn't quite do what you need | Introduce Foreign Method. Or wrap with an Adapter. |

### The "Leave It Better Than You Found It" Loop

- **For every file you open:** scan for smells. If you find one, fix it in the same change set.
- **For every function you read:** if it's too long, split it (if it's in scope).
- **For every import you see:** if the import is unused, delete it.
- **For every type you touch:** if the type is too loose, tighten it.

---

## 🔴 The Boy Scout Rule

> **"Always leave the code cleaner than you found it."** — Robert C. Martin

### Application

When you touch a file for **any reason**:
- **If you see a smell, fix it (in the same change set).** Don't open a separate PR for cleanup. Don't add a `// TODO: clean up later`. Fix it now.
- **If you see dead code, delete it.** If you see a `// TODO` you can address, address it.
- **If you see a duplicated pattern, extract it.** (Three strikes rule, see DRY.)
- **If you see a defensive `?? ""` that shouldn't be needed, fix the contract** and remove the guard.
- **If you see an `as unknown as X` that shouldn't be needed, fix the type** and remove the assertion.
- **If you see a `console.log`, replace it with the logger.**
- **If you see a hardcoded `href`, replace it with the typed route.**

### Scope Discipline

- **Bundle cleanup with the task.** A PR that adds a feature AND removes 3 dead-code instances AND extracts 1 utility is a **good** PR. A separate "cleanup PR" is fine if the cleanup is large, but most cleanup should ride along with the work that touched the file.
- **Don't expand scope beyond what's necessary.** If a file has 10 smells and you only need to fix 1 for the task, fix 1, but mention the others so the user knows. Don't fix all 10 silently.
- **Don't fix things in unrelated files.** Stay focused. A bug fix in `apps/api/src/modules/docker/` shouldn't also touch `apps/web/src/app/dashboard/projects/`.

### Anti-Patterns

- ❌ "I'll just open a cleanup PR later" — you won't. Do it now.
- ❌ "I'll add a TODO and someone else can clean it up" — TODOs never get done. Either fix it now or don't add the TODO.
- ❌ "This is out of scope" — if it's in the file you're touching, it's in scope.
- ❌ Cleaning up things the user didn't ask for in files unrelated to the task (over-reach).

---

## 🔴 Ripple Effect Analysis

> **Every change has a ripple.** Before making the change, predict the ripple. After making the change, verify it.

### Before Implementing

1. **Find all references.** `grep_search` for the symbol, type, function name across `apps/` and `packages/`. Use `vscode_listCodeUsages` to enumerate callers. Use `vscode_renameSymbol` with no new name to preview the rename.
2. **Read each call site.** Note what behavior they depend on. If a caller relies on the old shape, the change is breaking — it must be updated in the same change set.
3. **Identify the ripple zone.** Which files, which tests, which docs are affected? List them.
4. **Decide the change set.** Is this a "fix the contract" change (caller updates) or a "add a new feature" change (no caller updates)? If the former, plan the caller updates now.

### After Implementing

1. **Type-check both apps.** Catches most broken callers.
2. **Grep for stragglers.** `grep_search` for the old API still in use. Find any that the type-check missed.
3. **Run the tests.** Both unit and e2e.
4. **Manual smoke test.** For UI changes, click through the affected flow. For API changes, hit the affected endpoint.
5. **Check the docs.** If the public API changed, the docs are wrong. Update them.
6. **Check the dependent code.** If the change introduces a new pattern, find other places that should use it.

### The "Check Everywhere Related" Discipline

- **The user said**: "when the llm do somthings it should not only focus on the taks but also check everywhere related to this to see if there change will not affect other part and if so can these part be refactored as well."
- **Rule**: when a task forces a change that has a 1+ improvement opportunity in adjacent code, **do the improvement in the same change set**.
- **Examples**:
  - You change a Zod schema to add a field → also update all consumers that should use the new field.
  - You rename a function → also rename all call sites in the same PR.
  - You discover the contract was wrong → also fix the producer, the consumer, the tests, the docs.
  - You discover an unused export → delete it.
  - You notice a pattern duplicated in 3 places → extract it.
  - You find a defensive `?? ""` in the web code → fix the API to guarantee non-null, remove the guard.
- **When to NOT do it** (out of scope):
  - A 2000-line refactor in a file you didn't touch for your task → make a separate task/PR.
  - A new architectural pattern that affects 20+ files → propose it to the user first.
  - A new dependency → discuss with user first.

---

## 🔴 No Bridges, No Compatibility Layers

> **Replace, don't bridge.** A v1 → v2 bridge is a debt that compounds. Bridges prevent the codebase from ever converging on the right design.

### The Rule

The user said: *"the llm should never let bridge for like v1->v2 unless explicitly tell so the llm should always try to replace code and structure when things are needed instead of letting two variant of code."*

If you're replacing `oldThing` with `newThing`:
- **Delete `oldThing` in the same change set.** No "we'll delete it next sprint."
- **Update all call sites in the same change set.** No "we'll migrate callers later."
- **Don't keep `oldThing` "for backward compat"** unless the user explicitly asks.
- **Don't add `legacyAdapter(oldThing)` to make `newThing` work with old callers.** Update the callers.
- **Don't add `@deprecated` JSDoc and keep the old code.** `@deprecated` is a tombstone, not a roadmap. Delete the code, fix the callers.

### This Applies To

- **Functions / types / constants** — rename or delete. Don't keep both.
- **Modules / files / packages** — delete the old, update the imports.
- **ORPC contracts** — delete the old contract, don't add `v2` suffix. If the contract changes shape, that's a contract version bump via the schema, not a parallel contract.
- **API routes** — delete the old route, don't add `v2` prefix. If the route changes shape, that's a breaking change — update all clients in the same change set.
- **Database columns / tables** — use a migration. Don't keep both old and new columns. Drop the old column in the same migration that adds the new.
- **Config keys** — delete the old key, don't alias. Update all readers.
- **HTTP status codes / error codes** — use the new code, don't keep the old as a "fallback".

### The Exception (Rare)

- **External API consumers** (e.g. a published package used by other repos) — if you can't update all consumers in the same change set, the user must explicitly opt into a deprecation cycle. Default to: don't.
- **Stored data in the database that would be lost on schema change** — write a migration. But the schema change happens in the same change set; the data migration is a separate concern.

### Anti-Patterns

- ❌ `oldFunc` and `newFunc` both exist; `oldFunc` calls `newFunc` with a transform.
- ❌ `legacyAdapter.ts` that converts old shapes to new shapes.
- ❌ `@deprecated` JSDoc with no deletion date and no migration plan.
- ❌ Two config keys that mean the same thing (`MAX_RETRIES` and `RETRY_LIMIT`).
- ❌ Two database columns that store the same data.
- ❌ Two endpoints that do the same thing.

---

## 🔴 Refactor Incrementalism & Atomic Refactors

> **Big refactors happen in one atomic change, not in a series of half-migrated states.**

### The Atomic Refactor

- A "rename" is one PR: type-check fails → fix all callers → type-check passes → done. **No intermediate state.** No `v1` and `v2` coexisting. No `@deprecated` window.
- A "schema change" is one PR: schema updated → producer updated → consumer updated → tests updated → docs updated → migration written. **All in one change set.**
- A "module restructure" is one PR: new file created → old code moved → callers updated → old file deleted. **No "we'll move it later."**

### The "Migration Commit" Anti-Pattern

- ❌ **Step 1**: Add `newThing` next to `oldThing`. `oldThing` still works.
- ❌ **Step 2**: Add `legacyAdapter` that makes `newThing` work for old callers.
- ❌ **Step 3**: Migrate callers to `newThing` "as time permits".
- ❌ **Step 4** (never happens): Delete `oldThing` and `legacyAdapter`.
- **This is a bridge.** The user explicitly forbade bridges. Don't do this.

### The Right Pattern

- ✅ **One commit (or one PR)**: rename `oldThing` to `newThing` everywhere. The PR might be large, but it's atomic. The type-check fails, then passes. The tests fail, then pass. The diff is "rename" + "update callers". Done.
- ✅ **For schema changes**: one PR. Schema migration + producer update + consumer update + tests + docs. The database is migrated, the code is migrated, the test suite proves it.

### When You CANNOT Do It Atomically

- **External consumers** (a published package, an API with 3rd-party clients): break the rule, but only with explicit user approval. Default: don't break external consumers. Default: do break internal consumers.
- **Database with millions of rows**: write a backfill migration in the same change set, but the schema change is still atomic.
- **Long-running deprecation in a published package**: only with explicit user approval. Add `@deprecated` to the public API, bump major version, ship a release. But this repo doesn't have a published package — every consumer is internal. So you can always do the atomic refactor.

### Incrementalism Done Right

- "Incremental" doesn't mean "half-done." It means **small atomic changes, each fully complete**.
- A refactor of 50 files happens as 50 atomic commits, each of which keeps type-check + tests green. Not 50 half-done commits.
- If a refactor is too big for one PR, **break it into atomic sub-PRs, each a complete unit**.

---

## 🔴 "Scream" Test for Architecture

> *"The architecture should scream the domain."* — Robert C. Martin. **A new developer should be able to tell what the app does by looking at the directory structure alone.**

### Application

- `apps/api/src/modules/docker/` is obviously about docker.
- `apps/api/src/modules/mesh/` is obviously about mesh networking.
- `apps/web/src/app/dashboard/docker/containers/` is obviously about docker containers in the dashboard.
- `packages/contracts/entities/src/entities/docker/` is obviously the docker entity schemas.

### Anti-Patterns

- ❌ `services/`, `utils/`, `helpers/`, `misc/` — generic folders that hide the domain. **Name folders after the domain**, not after the role.
- ❌ A single `services/` folder with 30 unrelated services. **Group by domain**: `docker/services/`, `mesh/services/`, `auth/services/`.
- ❌ Generic names like `BaseEntity`, `CommonType`, `HelperFunction`. **Use domain names**: `Container`, `MeshPeer`, `formatBytes`.

### Screaming Architecture Principles

- **Feature-first, not layer-first.** Organize by what the code *does* (docker, mesh, auth), not by what *kind* of code it is (services, controllers, repositories).
- **Hexagonal / Ports & Adapters**: the domain is the center. The infrastructure (DB, HTTP, external APIs) is the outer layer. The domain doesn't know about the infrastructure.
- **Vertical slicing**: each feature is a self-contained vertical slice from the schema to the UI.
- **Bounded contexts**: each domain module has its own vocabulary, types, and boundaries. No shared mutable state.

---

## 🔴 Self-Review Checklist (Before Any Commit)

> **Review your own work before submitting.** The reviewer is you, and you have the context. Use it.

### Pre-Commit Checklist

Run this checklist mentally (or write it down for non-trivial changes):

- [ ] **Does the code compile?** `bun --bun run type-check` on both `apps/web` and `apps/api`. Zero errors.
- [ ] **Do the tests pass?** `bun --bun run test` for unit, `bun --bun run test:e2e` for e2e (when applicable).
- [ ] **Did I introduce type assertions?** `grep -rn "as unknown as\|as Record<string" apps/ packages/`. Should be **zero** in new code.
- [ ] **Did I introduce `@ts-ignore` or `@ts-expect-error`?** `grep -rn "@ts-ignore\|@ts-expect-error" apps/ packages/`. Should be **zero**.
- [ ] **Did I add a defensive guard that shouldn't be needed?** If yes, **fix the contract, remove the guard**. Don't ship defensive code that papers over a contract bug.
- [ ] **Did I leave dead code?** `knip`. Should be **zero** new dead code introduced.
- [ ] **Did I leave commented-out code?** Delete it.
- [ ] **Did I leave a `TODO`?** Either address it now, or delete it. No `// TODO` without a tracking issue.
- [ ] **Did I duplicate code?** If a pattern appears 3 times, extract it.
- [ ] **Did I add a "just in case" feature or parameter?** Delete it. YAGNI.
- [ ] **Did I add a bridge / compat layer?** Remove it. Replace don't bridge.
- [ ] **Did I update the docs?** Both `apps/doc/content/docs/` and this file (if rules changed).
- [ ] **Did I update the AGENTS.md files?** If the change affects a scope (web, api, system, etc.), update the nearest scoped AGENTS.md.
- [ ] **Did I update the related code?** If a sibling file has the same bug, fix it in the same change set.
- [ ] **Did I run the linter?** `bun --bun run lint`. Zero warnings.
- [ ] **Did I follow the commit policy?** Conventional commit. Scoped. One logical change.
- [ ] **Is the change set focused?** One logical change, not 5 unrelated tweaks.
- [ ] **Did I add a logger call for the lifecycle event?** For new services/repositories, add a startup log.
- [ ] **Did I handle errors with the right error type?** `AppError` subclasses in services, `ORPCError` in handlers, never `Error`.
- [ ] **Did I use Bun runtime?** `bun --bun run <script>`, never bare `bun run`.
- [ ] **Did I use the right paths?** `import { X } from "@/..."` aliases, not `../../..` deep paths.
- [ ] **Did I use the typed routes?** `<Route>.Link`, not raw `href`. `<Route>.fetch`, not raw `fetch`.

### Pre-Commit Grep Audit (Mandatory)

```bash
# Type assertions — should be zero in new code
grep -rn "as unknown as\|as Record<string" apps/ packages/

# Type escapes — should be zero
grep -rn "@ts-ignore\|@ts-expect-error" apps/ packages/

# Console logs — should be zero (use the logger)
grep -rn "console\.\(log\|debug\|info\|warn\|error\)" apps/api/ apps/web/

# TODO without ticket — should be zero
grep -rn "TODO\|FIXME\|XXX\|HACK" apps/ packages/

# Commented-out code — should be zero
grep -rn "^[[:space:]]*//.*= \|^[[:space:]]*//.*const \|^[[:space:]]*//.*function " apps/ packages/

# Defensive nullish — suspicious
grep -rn "?? ''\|?? \"\"\|?? 0\|?? false\|?? \[\]\|?? {}" apps/

# Hardcoded href — bypasses declarative routing
grep -rn 'href="/' apps/web/src/

# Hardcoded fetch — bypasses ORPC
grep -rn 'fetch("/api\|fetch("/v1\|fetch("/v2' apps/web/src/

# Process env scattered in business code
grep -rn "process\.env\." apps/ packages/ | grep -v "config/"
```

Any result is a candidate for cleanup. New code MUST have zero results.

---

## 🔴 Anti-Pattern Catalog (Always Reject)

> **A non-exhaustive list of patterns that are always wrong in this codebase.** Reject PRs that contain them. Refactor existing code that contains them.

### Type Lies

- ❌ **`as unknown as X`** — type lies, runtime crash waiting to happen. Fix the type, fix the schema, or write a `to*` function.
- ❌ **`as any`** — disables type checking entirely. Same fix.
- ❌ **`as Record<string, unknown>`** — pretends a typed object is untyped. Use Zod parse instead.
- ❌ **`@ts-ignore` / `@ts-expect-error`** — silences real errors. Same fix.
- ❌ **Non-null assertion `!`** — `value!.foo` lies. Use Zod parse or a type guard.
- ❌ **Type widening** — returning a `User | null` when the contract says `User`. Fix the contract, not the return type.

### Defensive Code That Hides Bugs

- ❌ **`?? defaultValue` where the schema guarantees the value** — defensive code that papers over a contract bug.
- ❌ **`value || fallback`** when `value` is typed as non-nullable — same lie.
- ❌ **Optional chaining where the field is required** — `obj?.foo` on a non-nullable `obj` is a lie.
- ❌ **try/catch with empty body** — silent failure.
- ❌ **try/catch with `console.log` only** — no context, no correlation.
- ❌ **Validating in business code what the type system could enforce** — re-validate what Zod already validated.

### Wrong Layer

- ❌ **`fetch()` instead of ORPC client** — bypasses type safety.
- ❌ **Hardcoded `href`** — bypasses declarative routing.
- ❌ **`process.env.X` scattered in business code** — should be in `config/`.
- ❌ **Business logic in a controller** — controllers should be thin.
- ❌ **SQL in a service** — services should call repositories.
- ❌ **Direct `import { DbClient }` in a service** — use DI tokens.
- ❌ **`new SomeService()` inside another service** — skip the DI container.

### Spec / API Bypasses

- ❌ **Commented-out code** — git remembers. Delete it.
- ❌ **`// TODO: refactor later`** — never happens. Do it now or delete the TODO.
- ❌ **Magic numbers** — name them.
- ❌ **Stringly-typed enums** — use `z.enum([...])` or `as const`.
- ❌ **Two variants of the same logic** — extract or pick one.
- ❌ **Bridges (v1 → v2)** — replace, don't bridge.
- ❌ **Production code with backward-compat layers** — delete unless asked.
- ❌ **`@deprecated` JSDoc without a deletion plan** — delete the code.

### Process Anti-Patterns

- ❌ **Premature optimization** — measure first, optimize the bottleneck. Don't add caches "for performance" without measurement.
- ❌ **Premature abstraction** — extract at the third strike, not the first.
- ❌ **"Just in case" features / parameters / fields** — YAGNI. Add when needed, not before.
- ❌ **Defensive programming everywhere** — fail fast, fix the root cause.
- ❌ **Speculative generality** — abstract for current needs, not hypothetical future needs.
- ❌ **Speculative configurability** — config for things that have one value.
- ❌ **Gold-plating** — adding more than what was asked.
- ❌ **Scope creep** — "while I'm at it" changes unrelated to the task.

### Logging / Observability Anti-Patterns

- ❌ **`console.log` instead of logger** — no filtering, no correlation, no request-id.
- ❌ **Logging inside hot loops without env-var gating** — floods production.
- ❌ **Logging full payloads** — PII risk, perf risk, log volume risk.
- ❌ **Logging credentials, tokens, or secrets** — security risk.
- ❌ **Throwing an error and logging the same message in the catch** — duplicates the noise.

### Testing Anti-Patterns

- ❌ **Tests that test the implementation, not the behavior** — break on refactor.
- ❌ **Tests with no assertions** — they always pass, they test nothing.
- ❌ **`expect.anything()`** — same problem.
- ❌ **Mocking the system under test** — defeats the purpose of the test.
- ❌ **Snapshot tests for behavior that should be explicit** — use `expect(x).toBe(y)`.
- ❌ **Tests that depend on test order or global state** — flaky.

---

## 🔴 MCP Tools Quick Reference

| Tool | When |
|------|------|
| `repo://summary` | Start of every task |
| `repo://apps` | When touching an app |
| `repo://packages` | When touching a package |
| `repo://agents` | When you need to find the nearest AGENTS.md |
| `repo://app/{name}/package.json` | Inspect app config |
| `repo://app/{name}/dependencies` | App deps |
| `repo://package/{name}/package.json` | Inspect package config |
| `repo://package/{name}/dependencies` | Package deps |
| `repo://graph/uses/{name}` | Who depends on this |
| `repo://graph/used-by/{name}` | What this depends on |
| `repo://commit/plan` | Lint → type-check → build before commit |
| `repo://changes` | Inspect pending changes |
| `repo://diff-summary/{path}` | Diff for a file |
| `list-apps` | List all apps |
| `list-packages` | List all packages |
| `add-dependency` | Add a dep (use `*` for internal workspace) |
| `remove-dependency` | Remove a dep |
| `add-script` | Add a script to a package.json |
| `bump-version` | Bump a package version |
| `run-script` | Run a package script (type-check, lint, build, test) |
| `create-app` | Create a new app |
| `create-package` | Create a new package |
| `auth-generate` | Regenerate auth schema/types (api) |
| `api-db { action: "generate"\|"push"\|"migrate"\|"seed"\|"reset"\|"studio" }` | DB lifecycle |
| `ui-add { components: [...] }` | Add Shadcn components to `@repo/ui` |
| `docker-up { mode: "dev"\|"prod", target: "api"\|"web"\|"all" }` | Start dev stack |

---

## Quick Command Reference

```bash
# Development
bun --bun run dev                    # Full stack
bun --bun run dev:api                # API + DB
bun --bun run dev:web                # Web only (needs running API)
bun --bun run web -- dr:build        # Regenerate declarative routes
bun --bun run web -- dr:build:watch  # Watch mode
bun --bun run api -- db:studio       # DB admin UI

# Building & Testing
bun --bun run build                  # Build all
bun --bun run test                   # Run all tests
bun --bun run test:coverage          # Coverage
bun --bun run test:e2e               # E2E (requires --bun for bun:sqlite)

# Database
bun --bun run api -- db:generate     # Generate migrations
bun --bun run api -- db:push         # Push schema (dev)
bun --bun run api -- db:migrate      # Run migrations
bun --bun run api -- db:seed         # Seed dev data

# Debugging
bun --bun run dev:api:logs           # Tail API container logs
bun --bun run dev:web:logs           # Tail web container logs
docker exec -it <container> sh        # Shell into container
```

---

## Architectural Layers at a Glance

```text
┌─────────────────────────────────────────────────────────────┐
│  Web (Next.js)                                               │
│  apps/web/src/app/<feature>/{page,layout}.tsx              │
│  apps/web/src/domains/<domain>/hooks.ts                     │
│  apps/web/src/lib/orpc.ts                                   │
└────────────────────────┬────────────────────────────────────┘
                         │ ORPC client (typed)
┌────────────────────────▼────────────────────────────────────┐
│  API (NestJS)                                                │
│  apps/api/src/modules/<domain>/ (product)                   │
│  apps/api/src/system/<domain>/ (control plane)              │
│  apps/api/src/core/ (foundational, app-* wiring)             │
└────────────────────────┬────────────────────────────────────┘
                         │ Internal: Mesh / Drizzle / etc.
┌────────────────────────▼────────────────────────────────────┐
│  Contracts (Zod → ORPC)                                      │
│  packages/contracts/api/modules/<domain>/<op>.ts            │
│  packages/contracts/entities/src/entities/...                │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│  Shared Utilities                                            │
│  packages/utils/orpc/        — ORPC builder helpers         │
│  packages/utils/logger/       — Pino + ContextFilterLogger   │
│  packages/utils/auth/         — Better Auth factories       │
│  packages/configs/eslint/     — Shared ESLint configs       │
│  packages/configs/typescript/ — Shared TS configs          │
│  packages/configs/vitest/     — Shared Vitest configs       │
└─────────────────────────────────────────────────────────────┘
```

---

**Remember**: This file is the source of truth for all AI development on this project. When patterns evolve, update this file **in the same change set** as the code change. Outdated instructions are worse than no instructions.

---

## 🔍 Deep Debugging Protocol

> When something doesn't work, **never take the easy way out**. The easy fix (a `// @ts-ignore`, a defensive `?? ""`, a try/catch that swallows) is usually a lie that hides the real problem. **Find the root cause, not a workaround.**

### The Investigation Order (Always Follow)

When you hit a problem, investigate in this order BEFORE proposing a fix:

1. **Local context** — read the file, read the function, read the test.
2. **Call sites** — `grep_search` for all callers. Read each one. What's the actual usage pattern?
3. **Recent changes** — `git log -p <file>` to see what changed. The bug is often in a recent edit.
4. **Related code** — sibling files, parent files, the same pattern in other modules.
5. **Dependency source** — read the library's TypeScript declarations. Read its source. Read its CHANGELOG.
6. **Dependency issues** — search GitHub issues for the library. Someone may have hit this.
7. **Runtime evidence** — actual logs, actual traces, actual stack traces, not "I think it's this."
8. **Reproduction** — write a minimal repro. If you can't repro, you don't understand the bug.

### The 5 Whys

For every symptom, ask "why" 5 times:

- **Symptom**: `TypeError: container.Ports is undefined`.
- **Why?** The docker entity has no `Ports` field.
- **Why?** The dockerode library returns it as undefined when no ports are bound.
- **Why?** The schema uses `.default([])` but the value was set before parsing.
- **Why?** The producer code does `{ ...entity, kind, action } as unknown as Chunk` — bypassing the schema.
- **Why?** The producer was written before Zod validation was added to the stream.
- **Root cause**: missing server-side Zod parse in the SSE stream producer.

The fix is at the root: parse at the producer. Not at the consumer with a `?? []`.

### The "I Don't Know" Rule

- **It's OK to not know.** "I don't know, let me investigate" is honest and correct.
- **It's NOT OK to fake understanding.** "It's probably X, let me just add a guard" is a lie.
- **It's NOT OK to take the easy way.** "I'll just add `?? ''` and ship it" is a lie.
- **When you don't know, say so.** Then investigate. Then propose.

### The "Why Does This Work?" Check

For every fix, ask: **"Why does this fix the symptom?"**. If you can't answer in 1 sentence, you don't understand the fix. If your answer is "I don't know, but the warning is gone", you have a workaround, not a fix.

### Forbidden Easy-Way Fixes

- ❌ `as any` to silence a type error.
- ❌ `as unknown as X` to bypass a contract.
- ❌ `// @ts-ignore` / `// @ts-expect-error` to silence the compiler.
- ❌ `?? defaultValue` to silence a "possibly undefined" warning.
- ❌ `try { ... } catch (e) {}` to silence a runtime error.
- ❌ `eslint-disable` to silence a lint warning.
- ❌ `// eslint-disable-next-line` ditto.
- ❌ "Just don't validate that" / "Just don't check this edge case".
- ❌ "I'll add a test that demonstrates the bug, then ship a fix that doesn't address the bug" — lying to yourself.

### When You Hit a Wall

If after deep investigation you can't find the root cause:
1. **State the gap**: "I investigated X, Y, Z, but couldn't determine the cause."
2. **Propose a theory**: "My best guess is that <X>, because <Y>."
3. **Propose how to validate**: "We could verify this by <running Z / adding logging / writing a repro>."
4. **Ask the user for input** if the answer affects the architecture.

---

## 🔍 Proposing Structural Changes

> When a fix requires a **fundamental structural change** — a new package, a rename across many files, a breaking API change, a new dependency, an architecture pivot — **STOP and tell the user**. Don't silently do it. Don't take a tactical shortcut to avoid the conversation.

### The Principle

**Structural changes deserve a conversation, not a silent commit.** A 30-line tactical fix in one file is fine to do inline. A 30-file refactor across 5 packages is not.

### What Counts as "Structural"

A change is structural (and needs a proposal) if it:

- [ ] **Adds a new package** to `packages/` or `apps/`.
- [ ] **Renames** a type, function, module, or package used in 3+ files.
- [ ] **Splits or merges modules** at any layer.
- [ ] **Changes the public API** of a package (its `index.ts` exports).
- [ ] **Introduces a new external dependency** (npm package).
- [ ] **Changes the architecture pattern** (e.g. switching from class-based service to functional service, or from ORPC to REST, or from Drizzle to Prisma).
- [ ] **Breaks the contract** of a public API (changes Zod schema in a way that breaks consumers).
- [ ] **Requires a database migration** with non-trivial data backfill.
- [ ] **Affects 5+ files** in different packages.
- [ ] **Takes more than ~30 minutes of work** to complete.

### What Does NOT Count as Structural

- A bug fix in 1-2 files.
- A new Zod field with a `.default()`.
- A new ORPC contract (additive).
- A new component in an existing module.
- A rename within a single file.
- A new test or spec.
- A documentation update.

These you can do inline.

### The Proposal Template

When you hit a structural change, write a proposal. Use this template:

```markdown
## Problem
What is broken or missing? One paragraph. Cite the file/line.

## Why It's Structural
Why can't this be fixed with a tactical 1-2 file change? What's the root cause?

## Options
### Option A: <name>
- Pros: ...
- Cons: ...
- Effort: X hours / X files

### Option B: <name>
- Pros: ...
- Cons: ...
- Effort: X hours / X files

## Recommendation
<Option X>, because <reason>. Tie back to the codebase's principles (DRY, SSOT, type-safety, etc.).

## Impact
- Files affected: N
- Tests affected: N
- Docs affected: N
- Migration needed: yes/no, plan
- External dependencies: list

## Open Questions
- <things I need to know from the user>
```

### When to Stop and Propose

- **Before** writing the first commit of a structural change.
- **Before** spending more than ~15 minutes on a non-trivial change.
- **Before** introducing a new external dependency.
- **Before** deleting a "legacy" file that's still imported.
- **Before** renaming a type, function, or module used in 3+ files.

### When NOT to Stop and Propose

- **Small bug fixes** (1-2 files, no API change).
- **Adding a new field with a `.default()`** (additive, safe).
- **Refactoring inside a single file** (no external impact).
- **Adding a new test** (always safe).
- **Updating documentation** (always safe).

### The "Show, Don't Tell" Rule

When you propose, **show your work**. Don't say "this is structural". Show:
- The 3 files that would need to change.
- The 5 callers that would break.
- The contract that's violated.
- The alternative (a tactical fix) and why it's worse.

This makes it easy for the user to make the call.

---

## 🔍 Developer Experience Standards

> DX is code. The "feel" of working in this codebase is engineered, not accidental. Every friction point is a bug to fix. Every missing shortcut is documentation to write. Every unclear error message is a paper cut.

### Editor Setup (VS Code)

**Required extensions** (already configured in `.vscode/extensions.json`):
- **ESLint** (`dbaeumer.vscode-eslint`)
- **Prettier** (`esbenp.prettier-vscode`)
- **TypeScript** (`ms-vscode.vscode-typescript-next`) or built-in TS
- **Biome** (if used)
- **Tailwind IntelliSense** (`bradlc.vscode-tailwindcss`)
- **Error Lens** (`usernamehw.errorlens`) — inline error display
- **Pretty TypeScript Errors** (`yoavbls.pretty-ts-errors`) — human-readable TS errors
- **Console Ninja** (`wallabyjs.console-ninja`) — inline `console.log` output

**Recommended settings** (in `.vscode/settings.json`):
```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
  "editor.inlineSuggest.suppressSuggestions": false,
  "editor.minimap.enabled": false,
  "files.trimTrailingWhitespace": true,
  "files.insertFinalNewline": true
}
```

### TypeScript Path Aliases (Already Configured)

Every package and app has path aliases. **Use them, never use `../../../`**:

| App / Package | Aliases |
|---------------|---------|
| `apps/web` | `@/*` → `src/*` |
| `apps/api` | `@/*` → `src/*` |
| `apps/doc` | `@/*` → `src/*` |
| `packages/ui` | `@repo/ui` |
| `packages/contracts/entities` | `@repo/contracts-entities` |
| `packages/contracts/api` | `@repo/contracts-api` |
| `packages/utils/orpc` | `@repo/utils-orpc` |
| `packages/utils/logger` | `@repo/utils-logger` |
| `packages/utils/auth` | `@repo/utils-auth` |
| `packages/utils/use-safe-query-param-states-from-zod` | `@repo/use-safe-query-param-states-from-zod` |
| `packages/nest` | `@repo/nest` |
| `packages/types` | `@repo/types` |

### Common Dev Workflows

```bash
# Start the full stack (Docker-orchestrated)
bun --bun run dev

# Start just the API
bun --bun run dev:api

# Start just the web app
bun --bun run dev:web

# Regenerate declarative routes (after adding a route or page)
bun --bun run web -- dr:build

# Watch mode for routes
bun --bun run web -- dr:build:watch

# Type-check a single app
bun --bun run web -- type-check
bun --bun run api -- type-check

# Lint a single app
bun --bun run web -- lint
bun --bun run api -- lint

# Run tests for a single app
bun --bun run web -- test
bun --bun run api -- test

# Run a single test file
bun --bun run web -- test path/to/foo.spec.ts

# Run a single test by Name
bun --bun run web -- test -t "should foo when bar"

# Run tests in watch mode
bun --bun run web -- test:watch

# Open a shell inside the API dev container
bun --bun run dev:api:run

# Tail API logs
bun --bun run dev:api:logs

# Tail web logs
bun --bun run dev:web:logs
```

### Debugging Tips

#### TypeScript
- **"Why is this type wrong?"** — hover the variable, click "Go to Type Definition" (F12). Read the source.
- **"Why is `X` not assignable to `Y`?"** — check the actual return type. Is your function returning what you think?
- **"The type is `any` somewhere"** — find the source of `any` and fix the upstream.

#### NestJS / API
- **"The provider isn't being injected"** — check the module's `providers` array. Is the class listed?
- **"The dependency cycle is breaking"** — use `forwardRef(() => OtherModule)` as a last resort. Better: refactor to break the cycle.
- **"The middleware isn't running"** — check the order in `AppModule.configure(consumer)`. Order matters.

#### React / Next.js
- **"Component renders twice in dev"** — React strict mode. Normal. Don't optimize for it.
- **"Hydration mismatch"** — the server-rendered HTML doesn't match the client. Check date formatting (server vs client locale), random IDs, `Date.now()`.
- **"Infinite re-render"** — a `useEffect` with a missing dep, or a `useState` initializer that returns a new object every render.

#### ORPC / Network
- **"The contract validates client-side but the server returns 500"** — the server-side error is being masked. Check the API logs with `bun --bun run dev:api:logs`.
- **"The SSE stream is always 'connecting'"** — the status logic. Check `useDockerRuntimeSseState` (or equivalent) — `fetchStatus === 'fetching'` means the stream is open.

### Test Running Strategies

```bash
# All tests
bun --bun run test

# Single file
bun --bun run test path/to/foo.spec.ts

# Single test by Name pattern
bun --bun run test -t "should do X"

# Watch mode (re-runs on file change)
bun --bun run test:watch

# With coverage
bun --bun run test:coverage

# E2E tests
bun --bun run test:e2e
```

**Always run Tests in watch mode during development.** Saves time.

---

## 🔍 UI/UX Standards

> UX is code. Every interaction is engineered, not accidental. Every state the user can be in (loading, success, error, empty) is a code path that must be designed. Every element has an accessibility story.

### Accessibility (WCAG 2.1 AA Minimum)

- **Keyboard navigation**: every interactive element must be reachable and operable with keyboard alone. No `onClick` on a `<div>` — use `<button>`.
- **Focus indicators**: never `outline: none` without a replacement. Use `focus-visible:` for keyboard-only focus.
- **ARIA labels**: every icon-only button needs `aria-label`. Every form input needs a `<label>` (or `aria-label` / `aria-labelledby`).
- **Color contrast**: text ≥ 4.5:1 against background. Large text (≥18pt or ≥14pt bold) ≥ 3:1.
- **Don't rely on color alone**: a red error without an icon is inaccessible. Add an icon + text.
- **Alt text**: every `<img>` needs `alt` (empty `alt=""` for decorative images).
- **Skip links**: a "Skip to main content" link at the top of every page.
- **Screen reader testing**: use VoiceOver (macOS), NVDA (Windows), or Orca (Linux) to test critical flows at least once.

### Loading States (Three Patterns)

| Pattern | Use when | Example |
|---------|----------|---------|
| **Skeleton** | Loading content that has a known shape (cards, rows, lists) | `<Skeleton className="h-4 w-32" />` |
| **Spinner** | Loading content with unknown duration (button action, save) | `<Loader2 className="animate-spin" />` |
| **Optimistic** | Mutation with very high success rate (toggle, like) | Update UI immediately, roll back on error |

**Every async operation must have a visible loading state.** A button that says "Save" must say "Saving..." or show a spinner while in flight.

### Error States (Three Patterns)

| Pattern | Use when | Example |
|---------|----------|---------|
| **Inline** | Form field validation | `<p className="text-destructive">Email is required</p>` |
| **Toast** | Background action failure (save, fetch) | `toast.error("Failed to save", { description: error.message })` |
| **Page-level** | Page can't render at all | `<ErrorPage error={error} />` with retry button |

**Every error must be informative.** "Something went wrong" is not acceptable. Include:
- What went wrong (human-readable)
- What the user can do (retry, contact support, check their input)
- An error reference ID for support

### Empty States (Three Patterns)

| Pattern | Use when | Example |
|---------|----------|---------|
| **First-time** | User just signed up, no data yet | Big illustration + "Get started" CTA |
| **Filtered** | User filtered, no results | "No containers match these filters" + "Clear filters" button |
| **After delete** | User deleted the last item | "No containers" + "Add a container" button |

**Every list needs an empty state.** A blank screen is not an empty state.

### Form UX

- **Autofocus** the first field on mount (but only if the form is the main content).
- **Native autocomplete** (`autoComplete="email"`, `autoComplete="current-password"`, etc.) — use the right token for the right field.
- **Validation timing**: validate on blur, not on every keystroke. Re-validate on submit. Show success state after a correct value.
- **Submit button state**: disabled while submitting, shows spinner, says "Saving..." or similar.
- **Preserve on error**: don't clear the form on submit failure. The user must not lose their input.
- **Enter submits**: `<form onSubmit>` not `<div onClick>`. Enter key in a field submits the form.
- **Required fields**: mark with `*` and a screen-reader-friendly `aria-required="true"`.

### Responsive Design (Mobile-First)

- **Mobile-first**: write the mobile CSS first, then add breakpoints for larger screens.
- **Breakpoints** (already configured in Tailwind): `sm: 640px`, `md: 768px`, `lg: 1024px`, `xl: 1280px`, `2xl: 1536px`.
- **Touch targets**: minimum 44x44px. Use `min-h-11 min-w-11` on tap targets.
- **Test on real devices**: don't trust Chrome DevTools' device emulation. Test on a phone.
- **No horizontal scroll** on mobile. If a table is too wide, use horizontal scroll INSIDE the table, not on the page.

### Dark Mode / Light Mode

- **Use CSS variables** for all colors (already configured in `packages/ui/base/`).
- **Test both modes** for every UI change. Don't ship a light-mode-only fix.
- **No hardcoded colors**: `bg-white` is wrong. `bg-background` is right.
- **System preference**: respect `prefers-color-scheme` by default. Let users override.

### Microinteractions / Animations

- **Purposeful, not decorative**: every animation should communicate (state change, transition, focus).
- **Fast**: 150-300ms for most transitions. 50ms for micro-interactions. 500ms+ is too slow.
- **Don't animate during loading**: the user is waiting. Animate the result, not the wait.
- **Respect `prefers-reduced-motion`**: users with vestibular disorders can disable animations.
  ```typescript
  // ✅ Respect reduced motion
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.2 }}
    // shadcn/ui handles this automatically via the `tailwindcss-animate` plugin
  />
  ```

### Focus Management

- **After a dialog closes**, return focus to the trigger button.
- **After navigation**, focus the main heading or the first interactive element.
- **Don't trap focus** outside a dialog unintentionally.
- **`tabindex={0}` only when needed** (rare, for custom widgets). Most elements don't need it.

---

## 🔍 Code Perfection Standards

> "Code that works" is the bar. "Code that works perfectly" is the goal. This section catalogs the non-obvious standards that take code from "shippable" to "excellent".

### Performance

#### Lists
- **Virtualize long lists** (>50 rows): use `@tanstack/react-virtual` or `react-window`. Don't render 1000 DOM nodes.
- **Stable keys**: every `.map(...)` needs a stable, unique `key`. Never use the array index for items that can be reordered/added/removed.
- **Pagination over infinite scroll** for data tables. Infinite scroll is for feeds (Twitter, Reddit), not for data exploration.

#### Heavy computations
- **`useMemo` for expensive derivations** (sorting large arrays, complex filters, projections). Don't memoize trivial expressions.
- **`useCallback` for handlers passed to memoized children**. The child re-renders if the handler reference changes.
- **`useDeferredValue` for non-urgent derived state** (search-as-you-type, SSE-driven tables). See SSE Performance section.

#### Network
- **Debounce** search inputs (200-300ms). Throttle scroll handlers (16ms). Don't fire requests on every keystroke.
- **Batch requests** when possible. Don't fire 10 separate fetches when 1 batched call would do.
- **Optimistic updates** for mutations with high success rate. Roll back on error.
- **Cache aggressively** with TanStack Query. Default `staleTime: 5*60*1000` (5 min) for most query.

#### Bundle size
- **Lazy-load** heavy components: `const HeavyChart = lazy(() => import('./HeavyChart'))`.
- **Tree-shake** imports: `import { foo } from 'bar'` not `import * as bar from 'bar'`.
- **Avoid large libraries** when a small alternative exists. Don't add `lodash` for one function; use the native equivalent.

### Memory Leaks

- **Clean up event listeners** in `useEffect`:
  ```typescript
  useEffect(() => {
    const handler = () => { ... }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  ```
- **Unsubscribe from observables**:
  ```typescript
  useEffect(() => {
    const sub = stream$.subscribe(...)
    return () => sub.unsubscribe()
  }, [])
  ```
- **Clear timers and intervals**:
  ```typescript
  useEffect(() => {
    const id = setInterval(...)
    return () => clearInterval(id)
  }, [])
  ```
- **Abort in-flight requests** on unmount:
  ```typescript
  useEffect(() => {
    const controller = new AbortController()
    fetch(url, { signal: controller.signal })
    return () => controller.abort()
  }, [])
  ```
- **Don't capture stale closures** in `useEffect` — use refs or include deps.

### Security

#### Input Validation
- **Validate at the trust boundary** (API entry point), not deep in the code. Use Zod.
- **Sanitize user input** that ends up in HTML. Use DOMPurify for `dangerouslySetInnerHTML`.
- **Escape user input** that ends up in SQL. Drizzle parameterizes by default, but be careful with raw queries.

#### Secrets
- **Never** commit secrets. `.env` is gitignored.
- **Never** log secrets. The logger redaction list is the source of truth.
- **Never** put secrets in URLs. Use headers (Authorization, X-Api-Key).
- **Rotate secret** that have been exposed. Don't "just remove the commit" — the secret is in git history.

#### HTTP
- **CORS**: only the configured origins can call the API. Never `Access-Control-Allow-Origin: *` in production.
- **CSP**: configure a strict Content-Security-Policy. `default-src 'self'`, no `unsafe-inline` for scripts.
- **HTTPS only** in production. Redirect HTTP → HTTPS.
- **Rate limiting** on public endpoints. Brute-force protection on auth endpoints.

#### Auth
- **Session tokens** in httpOnly cookies, not localStorage. XSS protection.
- **CSRF tokens** for cookie-based auth. SameSite=Lax or SameSite=Strict.
- **Token refresh** on expiration. Don't make the user re-login every hour.

### i18n / l10n

- **Use `Intl.DateTimeFormat`** instead of `moment` or hand-rolled formatting:
  ```typescript
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
  ```
- **Use `Intl.NumberFormat`** for currency, percentages, large numbers:
  ```typescript
  new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(1234.56)
  ```
- **Use `Intl.RelativeTimeFormat`** for "2 hours ago":
  ```typescript
  new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-2, 'hour')
  ```
- **Don't hardcode locale** — pass it from a config or context. Default to the user's browser locale.
- **Externalize all user-facing strings** to a translation file from day one. Don't wait for "real" i18n to refactor later.

### Dates & Timezones

- **Store in UTC** in the database. Convert to local time in the UI.
- **Use ISO 8601 strings** for JSON serialization. `Date` objects in JSON are ambiguous.
- **Use `date-fns-tz` or `Temporal`** for timezone math. Don't write your own.
- **Show timezones** to the user when relevant: "Last updated 2024-01-15 14:30 UTC" or use their local timezone.

### URL Design

- **Path is the resource**: `/containers/abc123` not `/containers?id=abc123`.
- **Query is the filter**: `?status=running&page=2`.
- **Stable URLs**: don't change a route's shape for cosmetic reasons. Renames break links and bookmarks.
- **No user-visible IDs** that leak business data (`/users/123` → `/users/me` if the user is the subject).

### SEO (Web)

- **`<title>` and `<meta description>`** for every page. Use Next.js Metadata API.
- **Open Graph tags** for social sharing. `og:title`, `og:description`, `og:image`.
- **Semantic HTML**: `<h1>` for the page title, `<h2>` for sections, etc. Don't use `<div>` for everything.
- **`<link rel="canonical">`** to prevent duplicate content issues.
- **Sitemap.xml** generated automatically (Next.js can do this).

### Logging Hygiene

- **Never log PII** (email, name, IP) without redaction. The logger has a redaction list — extend it when needed.
- **Never log secrets** (tokens, passwords, keys). The logger redaction list is the contract.
- **Log at the right level**: error / warn / info / debug. See the Logging section.
- **Include context**: the operation, the input ID, the request ID. A log without context is a string.

