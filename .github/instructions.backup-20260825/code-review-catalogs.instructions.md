---
applyTo: "**"
description: "Code smells, anti-patterns to reject, code perfection and developer-experience standards"
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

### Architecture & Boundary Anti-Patterns

- ❌ **`src/system/*` importing from `src/modules/*`** — system is the internal control plane and must NOT depend on product modules. If a system endpoint needs a module, extract shared logic to `core/`.
- ❌ **`core/` depending on `modules/`** — core modules must NOT import product modules. Extract shared repositories to `core/modules/common/`.
- ❌ **Duplicate contract definitions** — a contract lives in ONE place: `packages/contracts/api/modules/<domain>/`. Never copy it to `apps/api/src/contracts/`. If you need local modifications, re-export from the shared package.
- ❌ **Cross-feature coupling** — `modules/docker/` must NOT import from `modules/deployment/`. If two features share logic, extract to `core/` or a shared package.
- ❌ **Circular dependency hub** — a single repository imported by 3+ modules creates a cycle risk. Extract hub repositories to a shared location (`core/modules/common/`) when they have 3+ consumers from different modules.
- ❌ **`common/` importing from `domains/`** within a module — the `common/` layer must NOT reach into `domains/`. Shared logic must be at the `common/` level or above.
- ❌ **`@Module({})` empty modules** — a NestJS module with no imports, providers, controllers, or exports is dead weight. Either implement it or remove it.
- ❌ **`@Injectable()` empty class** — a service class with no methods, no constructor deps, and no logic registered in DI is an architectural shell. Implement it or delete it.
- ❌ **Stub implementation registered in production** — a class whose methods always return `[]`, `null`, or throw "not implemented" must NOT be wired into the main module. Use conditional providers or feature flags for work-in-progress code.

### Error Handling Anti-Patterns (Expanded)

- ❌ **`throw new Error("message")` instead of `AppError` subclass** — bare `Error` has no code, no context, no recovery path. Use `NotFoundError`, `ValidationError`, `ConflictError`, etc.
- ❌ **Custom error classes that extend `Error` directly instead of `AppError`** — `MeshBaseDomainError extends Error` bypasses the `AppError` hierarchy and the global exception filter. Extend `AppError` so your error goes through the 3-tier pipeline.
- ❌ **Re-implementing library error types locally** — defining a local `OrpcError` class when `ORPCError` from `@orpc/server` already exists creates a parallel error hierarchy that the global filter doesn't catch.
- ❌ **Empty catch block** — `catch {}` or `catch { // ignore }` silently swallows errors. At minimum, log the error with context. If the error is truly ignorable, add a comment explaining WHY.
- ❌ **Catch block with `return null` / `return []` fallback** — returning a falsy fallback from a catch hides the failure. Log the error, then either rethrow or return a discriminated union / Result type.
- ❌ **Catch block with `console.log` only** — use the structured logger (`this.logger.warn(...)`) instead of `console.log`. Include the operation name and failing input.
- ❌ **Contract error definitions inconsistent between duplicates** — when contracts are duplicated, error definitions drift. Always use `meshDomainErrorContracts(e)` instead of inlining error definitions manually.
- ❌ **Error definitions missing on contracts** — every ORPC contract that can throw domain errors MUST declare them via `.errors(...)`. Without this, typed client error handling is impossible.

### Package & Dependency Anti-Patterns

- ❌ **Package with zero consumers** — every package in `packages/` must have at least one consumer (imported by another package or app). Zero-consumer packages are dead weight. Either wire them in or delete them.
- ❌ **Wildcard exports exposing internals** — `"./*": "./*.ts"` exposes every `.ts` file in the package root as a public import path, including build scripts, configs, and internal helpers. Use explicit subpath exports instead.
- ❌ **Hardcoded version instead of catalog reference** — root `package.json` catalogs define canonical versions. Every app/package must use `"catalog:<name>"` instead of hardcoded versions. Hardcoded versions drift silently.
- ❌ **Same dependency in both `dependencies` AND `peerDependencies`** — this creates version ambiguity. If a package is a peer dependency, remove it from `dependencies`. If it's a direct dependency, remove it from `peerDependencies`.
- ❌ **Tooling in `peerDependencies`** — `concurrently`, `rimraf`, and similar build tools belong in `devDependencies`, not `peerDependencies`. Peer deps are for runtime libraries consumers must provide.
- ❌ **Nested package directory without `package.json`** — a directory like `packages/nest/` with no `package.json` that only contains `packages/nest/auth/` is an artifact. Flatten it to `packages/nest-auth/`.

### Configuration & Environment Anti-Patterns

- ❌ **`bun run` without `--bun`** — the `--bun` flag is mandatory for all scripts. Bare `bun run` uses Node.js runtime and breaks `bun:sqlite`, `zod/v4`, and other Bun-native features. Never write `bun run X` — always `bun --bun run X`.
- ❌ **`process.env.X` scattered in business code** — every `process.env` read must go through a config service or the centralized `EnvService`. Direct reads in services, repositories, or middleware create scattered configuration sources that can't be validated or tracked.
- ❌ **Mesh/feature env vars not in `turbo.json` `globalEnv`** — any env var consumed at build time must be declared in `turbo.json`'s `globalEnv` or per-task `env` list. Undeclared env vars cause incorrect cache hits and hard-to-debug build differences.
- ❌ **Phantom port in `.env` file** — a port value in `.env` that doesn't match any Docker Compose or default configuration creates silent connection failures. Every port in `.env` must have a corresponding service in at least one docker-compose file.
- ❌ **No `.dockerignore`** — without `.dockerignore`, the entire monorepo is sent to the Docker daemon as build context, slowing builds. Add a `.dockerignore` that excludes `node_modules`, `.git`, `dist`, and `.turbo` at minimum.
- ❌ **Missing Docker healthcheck on web/doc services** — every service in docker-compose must have a `healthcheck` block. Without it, Docker can't detect when the service is broken for automated restart or `depends_on` gating.
- ❌ **Dev/prod port drift** — if dev defaults to port `3005` but prod defaults to `3001`, and `.env.example` says `3001`, developers running the API locally will connect to the wrong port. All environments must agree on default ports, or the drift must be explicitly documented.

### Documentation Anti-Patterns

- ❌ **README points to a nonexistent directory** — if the root `README.md` references `.docs/` or `docs/README.md` as a documentation hub, that directory must exist. Broken doc links are worse than no links.
- ❌ **AGENTS.md file that doesn't reflect `.github/copilot-instructions.md` rules** — every AGENTS.md must at minimum reference the relevant CI sections. Key rules (type assertions ban, Zod-as-truth, error handling, Bun runtime, self-review checklist) must be repeated or linked.
- ❌ **Embedded documentation islands in source code** — a `docs/` folder inside `apps/api/src/core/modules/domain/` is invisible to readers. If documentation belongs inside the module, link it from the main docs index. Otherwise, keep it in `docs/` or `apps/doc/`.
- ❌ **AGENTS.md with inconsistent structure** — all app-level AGENTS.md files should follow the same template (Scope Rules, Quick Context, Workflows, Boundaries, Rules). Config package stubs can be compact, but must at least state their purpose and key constraints.
- ❌ **Design docs tagged as "finalized" with no implementation** — a design doc marked "Design finalized, implementation pending" that has been pending for months is stale. Either implement it, re-scope it, or mark it as deprecated.
- ❌ **Documentation hub duality** — two places claiming to be "the canonical documentation source" (`apps/doc/content/docs/` and `docs/`) creates confusion. Either merge them or establish a clear priority rule with cross-references.

### Web (Next.js / React) Anti-Patterns

- ❌ **Component > 1000 lines** — a component with 30+ `useState`, 20+ `useEffect`, 10+ `useQuery`, and 2000+ lines of JSX is untestable and unmaintainable. Split into smaller components. If the trigger/content pattern is used but content is still >1000 lines, split content further.
- ❌ **`export const metadata` or `generateMetadata` missing on page** — every route in `app/` must export metadata (title, description) for SEO and accessibility. Root layout metadata is not a substitute for per-page metadata.
- ❌ **`any` in shared type definitions** — a shared type utility that uses `any` as a boundary leaks type unsafety to every consumer. Constrain generics properly or use `unknown` with type guards.
- ❌ **Zero page.info.ts files for declarative routing** — every route that needs typed navigation links should have a co-located `page.info.ts` file. Zero such files means the declarative routing system is not being used for any page.
- ❌ **Hardcoded `fetch("/api/...")` instead of ORPC client in production code** — raw `fetch()` bypasses the typed ORPC contract, losing input/output validation and auto-completion. Use the ORPC client everywhere, even for auth endpoints.
- ❌ **Inline `key={index}` for dynamic lists** — using the array index as a React key for dynamic, sortable, or filterable lists causes incorrect re-renders and lost state. Use stable unique IDs from the data.
- ❌ **Missing `<select>` `aria-label`** — select elements in forms must have an `aria-label` or associated `<label>` for screen reader accessibility.

### Infrastructure Anti-Patterns

- ❌ **No pre-commit hook** — a pre-push hook alone is not enough. Developers should catch lint/type errors before committing, not after. Add a pre-commit hook that runs `bun --bun run lint-staged` or at minimum `bun --bun run type-check` on changed files.
- ❌ **Route regeneration (`dr:build`) is a manual step** — forgetting to run `dr:build` after route changes silently breaks navigation. Automate it via a pre-commit hook that checks if any `route.info.ts` changed and auto-regenerates.
- ❌ **Missing `.vscode/extensions.json`** — without a recommended extensions list, new developers miss critical extensions (ESLint, Prettier, Tailwind IntelliSense, Error Lens, Pretty TS Errors). Add one to reduce onboarding friction.
- ❌ **Missing `.vscode/launch.json`** — debug profiles for the API and web apps should be pre-configured so developers can attach a debugger without manual setup.
- ❌ **`it.todo()` tests without a linked tracking issue** — pending tests that have no issue number or planned sprint are TODO dead ends. Either implement the test, delete the todo, or link it to a tracking issue.

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
