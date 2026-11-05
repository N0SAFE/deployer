# AGENTS.md — @deployer/config-eslint

Centralized ESLint configuration for the monorepo.

## Build

Built through `@deployer/pkg-build` like every other package. Two pieces of the
package are unusual and both are covered here:

**The TypeScript 6 island.** `typescript-eslint@8` peer-requires
`typescript <6.1.0`, but every app in this repo compiles against TypeScript 7.
`src/plugins/bundle-ts6-island.ts` therefore redirects every `typescript` /
`typescript/*` import to THIS package's TS6 copy and bundles that plus the
`typescript-eslint` / `@darraghor/eslint-plugin-nestjs-typed` closure into
`dist`. A consumer's TS7 can never reach the lint toolchain. It is the only
`plugins` entry in the repo — see `tooling/bin-pkg-build/AGENTS.md`.

**The progress plugin.** `plugins/progress/` is a separate package
(`@deployer/config-eslint-plugins-progress`) holding the per-file progress
display. It is a normal `pkg-build` package: `src/` is TypeScript, and `dist/`
plus `dist/types/` are generated from that one source. It used to be a raw
`.js` file with a hand-written `.d.ts` beside it, which is why the types could
drift from the implementation — they no longer can.

Because the island is bundled, `dist/index.mjs` is large (≈12 MB) and `lint`
must run AFTER `@deployer/config-eslint#build:types`, which `turbo.json`
encodes.

## Rules

- Keep configs minimal and sharable. Avoid project-specific rules here.

### Import order

`src/base.ts` enables `import/order` (registered through `eslint-plugin-import`,
which `bun lint` runs natively after the plugin is present in the config).

Groups, in this order: `builtin` → `external` → **`@deployer/*`** → internal
(`@/`, `@<service>/`) → `parent` → `sibling` → `index` → `object` → `type`, with
one blank line between groups and alphabetical order inside a group.

- `@deployer/*` is a `pathGroup` on the `internal` group with
  `position: "before"`, not a custom group name: `bun lint` validates `groups`
  against a fixed enum, so a custom name (`deployer`) is rejected. The
  `pathGroups` entry still gives the workspace packages their own contiguous,
  blank-line-separated block ahead of app-internal aliases.
- Every tsconfig alias has to be listed in `pathGroups`. `import/order` does not
  resolve `paths`, so without an entry `@/foo` is classified as an npm package
  (anything starting with `@`). A new app alias means a new line there.
- Severity is `warn` on purpose: turning it to `error` fails every workspace
  until a `bun run lint:fix` pass has been committed. Promote it once that pass
  lands.
- When updating rules, run lint across repo and document notable changes.
- Prefer using MCP `run-script` to run lint tasks across targets or consult `repo://commit/plan` for sequencing.

## @shadcn/lint

`@shadcn/lint` is registered as the `shadcn` plugin in `src/react.ts` (and therefore in
`@deployer/config-eslint/nextjs`, which re-uses it). **No `shadcn/*` rules are enabled** — the plugin
is installed, discoverable, and inert until an app opts in.

Enable rules per app, in that app's own `eslint.config.ts` rules object, next to its files glob:

```ts
{ extends: [nextjsConfig.configs.base()], rules: { "shadcn/no-restyle": ["error", { allow: ["layout"] }] } }
```

Component discovery: `apps/web` and `packages/ui/base` use their local `components.json`; imports of
the shared package (`@deployer/ui/components/…`) are matched via `settings.shadcn.componentImports` set
in `src/react.ts`. Theme CSS comes from each `components.json` `tailwind.css` path.

Rule list: https://github.com/shadcn-ui/lint#rules

## Module-graph gate (`bun run lint:architecture`)

Two type-aware rules — `deployer-effect/requireModuleContext` and `deployer-effect/requirementFlow` — written in TypeScript
under `src/rules/`, shipped as the `architecture` entry (`dist/architecture.mjs`, `@deployer/config-eslint/architecture`).

```
src/architecture.ts                      the plugin (default export) — rules registered under "deployer-effect"
src/rules/require-module-context.ts      bare @Module  → bareModule
src/rules/requirement-flow.ts            unmet requirements, unknown export, duplicate provider
src/rules/architecture/ast.ts            ESTree helpers (entryName, staticNames, …)
src/rules/architecture/facts-schema.ts   zod contract between the facts process and the rules
src/rules/architecture/facts-client.ts   spawns the facts process, validates it, caches it, refreshes on save
src/rules/architecture/facts-collector.ts  THE type reading, on the TypeScript 7.1 async API
src/architecture-facts.ts                the facts process entry (`dist/architecture-facts.mjs`)
architecture.config.ts                   the monorepo config used by the script (imports the rules from source)
```

**Why a separate process.** `bun lint` hands rules no types (`program: null`) and a `typescript-eslint` program would be TS6, so
the types are read ONCE per run by `architecture-facts` through `typescript-7-1` (an alias of `typescript@7.1.0-beta`, separate
from the TS6 island) in one snapshot over every module file. The rules only look the result up. Run with `--threads=1`
(already in the script): the facts are memoised per process.

**A missing dependency is reported at both ends.** On the entry in the module's `providers`/`controllers`
(`missingDependency`), and in the file whose code uses the service — `yield* ReplicaStore` inside the provider —
(`missingDependencyHere`). So the rule must be enabled for provider files, not only `*.module.ts`; the config lints every
`src` file. Usage sites are matched by symbol, not by name.

**Nothing is skipped silently** — a gate that skips a file reads as a clean file:

- a file the compiler could not analyse (outside every tsconfig, a compiler error) → `analysisFailed`;
- a module declaration in a file outside the configured `globs` → `noFacts`; one the compiler and linter place differently → `unanalysedCall`;
- `unknownExport` / `duplicateProvider` need `providers` and `imports` to be fully static; a variable, spread, factory call or
  camelCase provider value makes the module "not analysable" and those two checks skip it (the type flow still runs).

**Editors.** Facts describe the DISK. They refresh when a file they were built from is saved; an unsaved buffer is left alone
(the rules stay quiet) rather than reported at the wrong place. Positions are `{ line, column }` in UTF-16, the same on both
sides, so non-ASCII text cannot shift a finding.

**Cost.** One 7.1 snapshot holds every project's program: ~3.1 GB peak in the Go compiler (the Bun side ~90 MB), ~13 s for
the whole monorepo. `GOMEMLIMIT`/`GOGC` do not help.

**Gotchas.** The async client is required; `typescript/sync` needs a Node-only handle and fails under Bun. `getTypeArguments`
panics the Go side on a non-reference type — guard with `isTypeReference()`. The 7.1 API is beta: keep `typescript-7-1` pinned
to an exact version and re-run `bun run test` (it pins exact positions over the requirements demo) when bumping it. Move the
rules onto `typescript-eslint` (and delete the TS6 island) only when it supports TS 7.

The demo, `samples/api-sample/requirements-demo`, has its own `eslint.config.mjs` importing `dist/architecture.mjs`
(Node ESLint cannot import TypeScript); rebuild with `bun run build` here after changing a rule.

## Nest roles: one rule per concept (`deployer-effect/*`, in `nestjs` → `nestRoles` / `effectConventions`)

The Effect + oRPC integration replaces every Nest role with code that carries its own types. The full guide — how to write each
replacement — is `docs/architecture/effect-orpc-conventions.md`; this section is how it is enforced.

| Rule                                                                                                                                                                      | Source                               | Flags                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `noInjectableService`                                                                                                                                                     | `src/rules/no-injectable-service.ts` | `@Injectable` on a class. **No exemptions.** Class-level, option `allow: [names]`                                                |
| `noNestLifecycleHook`, `noNestGuard`, `noPassport`, `noNestPipe`, `noNestInterceptor`, `noNestExceptionFilter`, `noNestMiddleware`, `noNestRequestScope`, `noNestGateway` | `src/rules/nest-roles.ts`            | an **import** of the role's decorator/interface/token from a Nest package (or of the whole package, for Passport and websockets) |

- All are syntactic, so they run natively under `bun lint` and the ESLint CLI. The import-based rules come from ONE factory
  (`createNestRoleRule(spec)`); a new role is a new entry in `NEST_ROLE_SPECS`, a test, and a line in the guide's table.
- Every message names the replacement and points at the guide. A rule's tests assert that, so a message cannot rot.
- **One `deployerEffect` plugin object** is shared by every config in `nestjs.ts`: flat config refuses to redefine a plugin name
  with a different object, so never build a second one.

### The ledger — an app's migration to-do list

`nestjsConfig.configs.nestRoles({ ledger: `${import.meta.dirname}/nest-roles.ledger.json` })` (and `effectConventions({ ledger })`, which includes it)
turns ALL the rules on for an app. The ledger is a JSON file `{ "<rule>": ["src/…/file.ts"] }` next to the app's
`eslint.config.ts`: the files that have **not** migrated yet, each exempt from that rule only.

- **Pass the ledger as an absolute path (`import.meta.dirname`), never `./…`**: the pre-commit hook lints staged files from the repository root, and a path resolved against the working directory worked inside an app and failed at the root. Entries are relative to the ledger's own directory (`src/rules/nest-roles-ledger.ts`, tested).
- Parsed with one zod schema; an unknown rule name is an error. An entry whose file **no longer exists fails the config load**, so
  a migrated or deleted file has to leave the list.
- `{}` means the app is done. Never add an entry for new code — fix the code.
- To migrate a file: fix it, delete its entry, run `bun lint`.
- `packages/nest/effect`'s ledger is permanent by design: it IS the Nest↔Effect bridge (`EffectRuntime`,
  `ServiceLifecycleRunner`).
