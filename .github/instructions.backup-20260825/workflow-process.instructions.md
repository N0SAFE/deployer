---
applyTo: "**"
description: "Process: documentation protocol, git workflow, change order & validation, investigation before work, MCP-first tooling, bun runtime rules, command reference"
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
