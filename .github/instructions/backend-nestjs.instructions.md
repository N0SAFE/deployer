---
applyTo: "apps/api/**, apps/load-balancer/**, apps/doc/**, packages/nest/**"
description: "NestJS server patterns, structured error handling and logging conventions"
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

**Throw ORPC errors in handlers via the typed `errors` parameter** — never raw
`HttpException`s in controllers. The thrown error only reaches the client as a
DEFINED (typed) error when its code exists in the contract's errorMap AND its
data validates against the declared data schema:

```typescript
import { domainErrorOptions, standardErrorOptions } from "@repo/orpc-utils"

.handler(async ({ input, errors }) => {
    if (!row) {
        throw errors.NOT_FOUND(standardErrorOptions("not_found", "GitHub App not found"))
    }
    // Non-standard codes (gateway errors, ...) — declare them on the contract first:
    throw errors.BAD_GATEWAY(domainErrorOptions("BAD_GATEWAY", 502, "Mesh node failed"))
})
```

Services may keep throwing NestJS `HttpException`s / `MeshBaseDomainError`;
the global `transformNestJSErrorToOrpcError()` interceptor converts them to
contract-compatible payloads (`{ statusCode, code, message, orpcCode }`).

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
