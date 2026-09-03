---
applyTo: "packages/contracts/**, packages/types/**, packages/utils/**, apps/api/**, apps/web/**"
description: "Type safety, Zod schemas as source of truth, ORPC contract patterns, monorepo package boundaries"
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
