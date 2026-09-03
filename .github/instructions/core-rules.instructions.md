---
applyTo: "**"
description: "Core engineering principles, workflow/process, code-review catalogs, and testing/performance rules (always applied)"
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

## 🔴 Self-Review Checklist (Before Any Commit)

> **Review your own work before submitting.** The reviewer is you, and you have the context. Use it.

### Pre-Commit Checklist

Run this checklist mentally (or write it down for non-trivial changes):

- [ ] **Does the code compile?** `bun --bun run type-check` on both `apps/web` and `apps/api`. Zero errors.
- [ ] **Do the tests pass?** `bun --bun run test` for unit, `bun --bun run test:e2e` for e2e (when applicable).
- [ ] **Did I introduce type assertions?** `grep -rn "as unknown as\|as Record<string" apps/ packages/`. Should be **zero** in new code.
- [ ] **Did I introduce `@ts-ignore` or `@ts-expect-error`?** `grep -rn "@ts-ignore\|@ts-expect-error" apps/ packages/`. Should be **zero**.
- [ ] **Did I introduce `as any`?** `grep -rn "as any" apps/ packages/`. Should be **zero** in production code.
- [ ] **Did I add a defensive guard that shouldn't be needed?** If yes, **fix the contract, remove the guard**. Don't ship defensive code that papers over a contract bug.
- [ ] **Did I leave dead code?** `knip`. Should be **zero** new dead code introduced.
- [ ] **Did I leave commented-out code?** Delete it.
- [ ] **Did I leave a `TODO`?** Either address it now, or delete it. No `// TODO` without a tracking issue.
- [ ] **Did I duplicate code?** If a pattern appears 3 times, extract it.
- [ ] **Did I create a stub/empty implementation?** Empty `@Module({})`, empty `@Injectable()` classes, or methods returning `[]`/`null` that are wired into production DI are architectural debt. Implement or remove.
- [ ] **Did I add a "just in case" feature or parameter?** Delete it. YAGNI.
- [ ] **Did I add a bridge / compat layer?** Remove it. Replace don't bridge.
- [ ] **Did I update the docs?** Both `apps/doc/content/docs/` and this file (if rules changed).
- [ ] **Did I update the AGENTS.md files?** If the change affects a scope (web, api, system, etc.), update the nearest scoped AGENTS.md.
- [ ] **Did I update the related code?** If a sibling file has the same bug, fix it in the same change set.
- [ ] **Did I run the linter?** `bun --bun run lint`. Zero warnings.
- [ ] **Did I follow the commit policy?** Conventional commit. Scoped. One logical change.
- [ ] **Is the change set focused?** One logical change, not 5 unrelated tweaks.
- [ ] **Did I add a logger call for the lifecycle event?** For new services/repositories, add a startup log.
- [ ] **Did I handle errors with the right error type?** `AppError` subclasses in services, `ORPCError` in handlers, never `Error`. Check I didn't create a new Error subclass that extends `Error` directly instead of `AppError`.
- [ ] **Did I check for empty catch blocks?** `grep -rn "catch\s*{" apps/ packages/`. Every non-empty catch block must log and/or rethrow.
- [ ] **Did I use Bun runtime?** `bun --bun run <script>`, never bare `bun run`.
- [ ] **Did I use the right paths?** `import { X } from "@/..."` aliases, not `../../..` deep paths.
- [ ] **Did I check for package boundary violations?** If I created or modified a package, verify it has consumers. If I added a wildcard export (`"./*"`), replace with explicit subpaths.
- [ ] **Did I check for cross-feature imports?** `modules/<a>/` must not import from `modules/<b>/`. Extract shared logic to `core/`.
- [ ] **Did I use a catalog version instead of hardcoded?** No `"zod": "^X.Y.Z"` — use `"catalog:utils"` instead. Check that new dependencies reference the catalog.
- [ ] **Did I use the typed routes?** `<Route>.Link`, not raw `href`. `<Route>.fetch`, not raw `fetch`.
- [ ] **Did I verify contract is not duplicated?** A contract must live in ONE place. If I touched a contract file, verify there's no duplicate copy elsewhere that needs updating or deletion.
- [ ] **Did I add error definitions to new ORPC contracts?** Every contract that can throw domain errors must declare `.errors(...)`.
- [ ] **Did I check for web page metadata?** New routes in `apps/web/src/app/` must export `metadata` or `generateMetadata`.

### Pre-Commit Grep Audit (Mandatory)

```bash
# Type assertions — should be zero in new code
grep -rn "as unknown as\|as Record<string" apps/ packages/

# Type escapes — should be zero
grep -rn "@ts-ignore\|@ts-expect-error" apps/ packages/

# Any type escape in production — should be zero
grep -rn "as any" apps/ packages/ | grep -v "\.spec\.\|__tests__\|node_modules"

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

# Empty catch blocks — silent failure risk
grep -rn "catch\s*{" apps/api/src/ packages/

# Empty Injectable classes or modules — architectural debt
grep -rn "}\n\s*export class.*Module {}\|}\n\s*export class.*Service {}" apps/api/src/

# Duplicate contract check — if touching contracts dir
ls apps/api/src/contracts/ 2>/dev/null && echo "CHECK: Could this live in packages/contracts/api/modules/ instead?"
```

Any result is a candidate for cleanup. New code MUST have zero results.

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
- ❌ **Zero route.info.ts files for declarative routing** — every route that needs typed navigation links should have a co-located `route.info.ts` file. Zero such files means the declarative routing system is not being used for any page.
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
