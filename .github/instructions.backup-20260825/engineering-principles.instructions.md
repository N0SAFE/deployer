---
applyTo: "**"
description: "Core engineering principles: mindset, DRY/KISS/YAGNI/SSOT/SoC, type-driven development, DI tokens, refactoring discipline"
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
