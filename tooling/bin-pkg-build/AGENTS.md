# pkg-build — shared configurable package builder

One build pipeline for every workspace package. Behaviour is declared in each
package's own `pkg-build.config.ts`, and that file **is the build's entry point**:
it calls `build()` from `@deployer/pkg-build/config`, which declares the config and
runs the pipeline. A package with unusual needs overrides configuration instead of
forking a script.

## Why

Packages are consumed as **built output** (`dist/esm/**`, `dist/cjs/**`), never as
raw TypeScript. That is what makes the `@/*` path alias usable _inside_ package
sources: `paths` aliases are resolved from the **consumer's** tsconfig, so raw
source importing `@/x` would resolve against the app's `src/` and fail. Publishing
bundles keeps the alias an internal detail.

Declarations are generated too, into `dist/types/**`, and `exports.types` points
there. Before that, `types` pointed at the package's raw `.ts` sources, so every
consumer (and every editor session) re-compiled every package implementation as
part of its own program — the main driver of multi-gigabyte `tsc` runs in this
repo.

`bun build` is the bundler because it resolves `tsconfig.paths` and — with
`experimentalDecorators` + `emitDecoratorMetadata` — emits legacy decorators with
`design:paramtypes`, which NestJS DI requires. `bun build` does not emit
declarations, so the types pass runs `tsc` (the native TypeScript 7 binary every
package already has) against a generated config.

## Usage

Consumers run the config, by the builder's `bin` name, not a path into `dist/`.
`@deployer/pkg-build` is a workspace devDependency, so the bin is linked into the
package's `node_modules/.bin` and `bun --bun pkg-build` resolves it:

```json
{
    "scripts": {
        "build": "bun --bun pkg-build",
        "build:types": "bun --bun pkg-build --types",
        "dev": "bun --bun pkg-build --watch"
    }
}
```

The **mode** is inferred from `NODE_ENV`; `--mode=dev|prod` overrides it. An
unqualified `build` therefore leaves `NODE_ENV` alone, and the prod images get
minified output because they set `NODE_ENV=production` before `turbo run build`.

Why a config entry point and not a bare flag-only CLI? The config is where the
build is declared, so naming `build()` in it makes the intent explicit and gives
the builder one execution path — no guessing which files at the package root are
a build. The bin is a tiny committed launcher (`bin/pkg-build.mjs`, `node:*`
imports only) so the link always resolves; it lazy-imports the NestJS CLI, which
reads the config.

Bun resolves `tsconfig.json` from the **process cwd**, and the build target is
also the cwd, so the launcher passes the builder's own tsconfig with
`--tsconfig-override` instead of moving the cwd. That gives bun the decorator
settings and the `paths` map back to `src/config.ts` — without it, a config
cannot resolve `@deployer/pkg-build/config` before the package is built — while
leaving the build pointed at the consumer that asked. `--cwd` would hijack the
target and silently rebuild the builder itself.

Ordering is turbo's job, and it is declared, not incidental: every consumer lists
`@deployer/pkg-build` in devDependencies (the normalizer enforces it), so `^build`
and `^build:types` order the builder ahead of its consumers.

pkg-build builds itself through the same path: its `build`/`build:types`/`dev`
scripts run `pkg-build.config.ts` (cwd is the package itself).

- `build` — JS bundles + declarations.
- `build:types` — declarations only (`dist/types/**`); the JS output is left
  untouched, which is what makes the task independently watchable. Turbo task is
  `build:types` (`dependsOn: ["^build:types", "@deployer/pkg-build#build"]`, outputs
  `dist/types/**`).
- `dev` — watch JS + declarations.
- Root `watch:types` = `turbo watch build:types` keeps declarations current while
  editing. It is a root `package.json` script, not a turbo task.

## Structure

The CLI is NestJS + nest-commander, one root command so call sites stay
flag-only. `main.ts` owns the process and imports the command graph lazily,
because the same pipeline is reached three ways: from the bin, from a config's
`build()` call, and from the variant child.

```
bin/
  pkg-build.mjs                  committed launcher: lazy-imports the CLI
src/
  main.ts                        process entry: main(argv) + `run`
  app.module.ts                  command graph for the cwd's package
  cli.ts                         command graph for a config already in hand
  cli-runtime.ts                 shared options + argv-install-and-run
  commands/
    pkg-build.command.ts         @RootCommand + -w/--watch, -t/--types, -m/--mode
  config.ts                      public surface: schema, types, defineConfig, build
  services/
    pkg-config.service.ts        package.json + config -> effective config, entries, layout
    pkg-builder.service.ts       bun build passes, tsc declarations, watch
  variant-child.ts               NODE_ENV-specific entry, spawned per JSX variant
  utils/                         colors, die, JSONC reader, fs walker
```

Two modules rather than one with a conditional provider: the two ways to run
differ only in where the config comes from (this process loaded it, or the cwd is
named by it), and two providers for one token is the ambiguity NestJS resolves by
declaration order. `AppModule` builds the config from the cwd; `RunBuildModule`
receives one already resolved.

`build()` runs only when the config file IS the process entry point, and it
detects that by comparing `Bun.main` against the config basenames — not
`import.meta.main`, which reports on the module it is written in (`config.ts`)
and is therefore always `false` for a config calling it. The check must be
per-process rather than per-module because the **variant child re-imports the
config** to read the declaration; an import that re-ran the build would recurse.
That import is also why `build()` pulls the CLI in with a dynamic `import()`: the
module every config imports must not drag in NestJS.

`src/variant-child.ts` is a dedicated entry (`bun build` samples `NODE_ENV` at
process start to pick the React JSX runtime, so each variant needs a fresh
process) but only needs one service call, so it builds the services directly
rather than booting Nest. It resolves as a sibling of the current module in
source and in the built trees.

Why the CLI is built, not run from source: NestJS relies on
`emitDecoratorMetadata`, which a source file only gets from a tsconfig carrying
`experimentalDecorators`. The launcher prefers `dist/cjs/main.js` and falls back
to `src/main.ts` under `--tsconfig-override` so a cold checkout still builds.

**Runtime output is ASCII-only.** The CLI's own markers (`>`, `ok`, `x`) are
deliberate and stay that way: they are stable under any terminal, any locale, and
any redirection. (The reason this was once mandatory is gone — bun 1.4.2
mis-decoded non-ASCII string literals in files carrying its `// @bun` internal
marker, so `▶`/`✔`/`✖` printed as mojibake. Verified fixed in 1.4.3: a minified
bundle with the marker prints them correctly. ASCII remains a style choice, not a
constraint.)

## Config defaults

A package with no `pkg-build.config.ts` gets the defaults — but every package
ships the file anyway, because it is where the build surface is discoverable and
the type-check proves it:

- `root`: `src`
- entries: every `src/**/*.{ts,tsx}` except tests
- `formats`: `esm` → `dist/esm/*.mjs`, `cjs` → `dist/cjs/*.js`
- `target`: `bun`
- `splitting`: on for esm only (bun refuses splitting for cjs)
- `variants`: derived — a package containing `.tsx` ships both JSX variants,
  anything else ships `production` alone
- `minify` / `sourcemap`: see **mode × variant** below
- dts: `dist/types/**`, mirroring the source tree

### Mode × variant

Two independent axes decide what a given output file looks like:

| Axis | Values | Source |
| --- | --- | --- |
| **mode** | `dev` \| `prod` | `NODE_ENV` at process start, or `--mode` |
| **variant** | `development` \| `production` | the JSX runtime the file targets |

They are not the same thing, and conflating them is a bug: a non-JSX package
emits a single `production` variant, so a variant-only rule would minify every
dev-container build and drop the maps that make local debugging possible.

| mode | variant | minified | sourcemap |
| --- | --- | --- | --- |
| `dev` | either | no | `linked` |
| `prod` | `development` | no | `linked` |
| `prod` | `production` | yes | `none` |

The rule is "what a production consumer actually loads is minified and carries no
maps; everything else stays debuggable". `dev` is the default, so an unqualified
`bun --bun pkg-build` never minifies; only the prod images (which set
`NODE_ENV=production` before `turbo run build`) do.

`modeFromEnv` reads `process.env['NODE_ENV']` with **bracket** access on purpose.
bun statically folds the dot-form `process.env.NODE_ENV` to a string literal at
build time — even with `define: {}` and `env: 'disable'` (measured) — which would
bake this package's own build-time value into the shipped CLI and freeze every
consumer's mode.

## Config reference

| Key         | Type                                     | Default         | Purpose                                                                               |
| ----------- | ---------------------------------------- | --------------- | ------------------------------------------------------------------------------------- |
| `root`      | `string`                                 | `"src"`         | Source directory. `"."` means the package root.                                       |
| `entries`   | `string[]`                               | —               | Explicit entry files, relative to `root`.                                             |
| `include`   | `string[]`                               | —               | Narrow the glob to these sub-paths of `root`.                                         |
| `formats`   | `("esm"\|"cjs")[]` \| `false`            | `["esm","cjs"]` | Formats to emit. `false` emits none.                                                  |
| `variants`  | `("development"\|"production")[]`        | derived         | JSX variants to emit.                                                                 |
| `outDir`    | `string`                                 | `"dist"`        | Base output directory.                                                                |
| `flat`      | `boolean`                                | `false`         | Emit into `outDir` directly instead of `outDir/<format>`.                             |
| `target`    | `"bun"\|"node"\|"browser"`               | `"bun"`         | Build target.                                                                         |
| `splitting` | `boolean`                                | esm-only        | Override code splitting.                                                              |
| `minify`    | `boolean`                                | mode × variant  | Minify output. Default: only prod mode × production variant.                          |
| `sourcemap` | `"linked"\|"external"\|"inline"\|"none"` | mode × variant  | Sourcemap mode. Default: everything except prod mode × production variant.            |
| `external`  | `string[]`                               | `[]`            | Extra specifiers to leave unbundled.                                                  |
| `plugins`   | `BunPlugin[]`                            | `[]`            | Bundler plugins, applied to every `bun build` pass. See "Bundler plugins".            |
| `copy`      | `{from,to}[]`                            | `[]`            | Extra assets copied into the output.                                                  |
| `keepEnv`   | `boolean`                                | `true`          | Keep `process.env.X` a runtime lookup.                                                |
| `types`     | `boolean`                                | `true`          | Emit `dist/types/**`. Set `false` only for a package that must not ship declarations. |

`entries` and the glob are a **union**: explicit entries are always built, and
`include` narrows the scan. When only `entries` is given the glob does not run, so
unrelated root files are not dragged in.

Identifier mangling is deliberately not enabled. Several packages reflect on
`constructor.name` (NestJS loggers, error classes), and bun's `minify.keepNames`
does not preserve it under `identifiers` (measured: the class name is renamed
regardless, on 1.4.2 and still on 1.4.3).

Every source file is an entry, so `dist/` mirrors the source tree — which is what
makes subpath exports such as `./react/session/client` resolve to a real file.

## Declaration emit (`dist/types`)

The types pass runs `tsc -p .pkg-build-types.<pid>.tsconfig.json` (per process, so the concurrent `compile` and `build:types` turbo tasks never share one), a config generated
beside `package.json` and deleted when the compiler exits. It extends the
package's own `tsconfig.json` (same `paths`, decorators, JSX settings) and
overrides only output:

- `declaration: true`, `declarationMap: true`, `emitDeclarationOnly: true`,
  `noEmit: false`
- `outDir: dist/types`, `rootDir: <root>`
- `files`: the same entry set as the JS build, plus authored `.d.ts` files under
  `root` (ambient declarations are inputs, never emitted — they are copied to
  `dist/types` afterwards)
- `include: []`: the base config's `include` globs must not union in tests

Layout is the source tree mirrored under `dist/types`, one tree shared by every
format/variant: `src/a/b.ts` → `dist/types/a/b.d.ts`. `build:types` clears only
that subtree, so running it alone never touches the JS output (and a symlinked
`dist` — dependency-builder — is preserved).

**Source aliases are rewritten to relative paths.** `tsc` writes import
specifiers verbatim, so `@/entities/foo` — which resolves perfectly in source
because the package's own `paths` maps it — would land in `dist/types` as a
specifier no consumer can resolve: `paths` is per-project, and the consumer has
no `@/` mapping. The declarations tree mirrors the source tree, so the repair is
mechanical, and `rewriteDeclarationAliases` does it after the compiler exits:

```text
dist/types/entities/foo.d.ts     from '@/entities/foo'  ->  from './foo'
dist/types/index.d.ts            from '@/entities/foo'  ->  from './entities/foo'
```

- The alias set comes from the package's own `tsconfig.json` — the same file the
  declaration pass extends — and only entries whose `*` maps **inside** the
  package's source root are used. An alias pointing outside the package is
  resolved through `exports` and is left as authored.
- Every specifier form `tsc` emits is covered: `from`, `import type … from`,
  `export * from`, `typeof import(…)` and `import(…)`.
- A JSDoc example (`* import { x } from '@/client/options'`) is prose, not a
  specifier, and is left alone.
- An alias that names no emitted file is reported as a warning rather than
  failing the build: it is usually a type-only helper outside the entry set, and
  failing would break a build that used to succeed.

This is why `packages/auth` can keep `"@deployer/auth/*": ["./src/*"]` — a
self-name alias, so its internal imports resolve through `exports` — and still
ship declarations a consumer can read.

**A cross-package import must use the package name.** `@/` is a *within-package*
alias; using it to reach another workspace (`@/entities/…` from
`@deployer/fleet-contracts`) is a source error the compiler reports as TS2307,
because that package's tsconfig has no such mapping. Write
`@deployer/contracts-entities` instead — resolution then goes through `exports`,
which is portable.

**Recursive types must be named.** TypeScript's declaration emitter cannot name
an anonymous self-referential type; it replaces the self-reference with `any`
(visible in emitted output as `ZodObject</*elided*/ any>`). Zod schemas that
recurse through the v4 `get` accessor therefore MUST annotate the schema with
explicitly named recursive interfaces:

```ts
export interface ServiceCreateInput extends ServiceCreateInputBase {
    children?: ServiceCreateInput[]
}

export const serviceCreateInputSchema: z.ZodType<
    ServiceCreateInput,
    ServiceCreateInputInput
> = serviceCreateInputBaseSchema.extend({
    get children() {
        return z.array(serviceCreateInputSchema).optional()
    },
})
```

Without the annotation, every consumer sees `children: Record<string, unknown>[]`
instead of the recursion. The trade-off: the annotated schema exposes the
`ZodType` surface, so it cannot be re-`.extend()`ed afterwards. `z.lazy()`
recursion emits as `ZodLazy<ZodType<unknown>>` and degrades the same way.

**Declaration-serialization limits (TS7056/TS2883).** A package whose exported
value has a type larger than the compiler's serialization cap cannot emit
declarations from inference. Two fixes, both used in this repo:

- Split the value: `@deployer/contracts-entities` no longer exports a combined
  `appContract`; each app composes the router locally where `declaration` is
  false (`apps/api/bff/src/orpc/app-contract.ts`).
- Annotate the return type: `@deployer/auth` annotates plugin wrappers and factories
  with `ReturnType<typeof …>` / `Auth<ReturnType<typeof createAuthConfig<…>>>`
  so declarations reference names instead of expanding the inference.

## `keepEnv` and `process.env`

bun inlines `process.env.NODE_ENV` at build time unless disabled. That silently
changes behaviour: code reading it per request, or a test assigning it in
`beforeEach`, would see the build-time value. `keepEnv: true` (the default) passes
`define: {}` and `env: 'disable'` so the lookup stays dynamic. Set `keepEnv: false`
only when a package genuinely wants build-time substitution.

## Worked examples

**Nested packages with root export** — `@deployer/ui`:

```ts
// packages/ui/base/pkg-build.config.ts
import { build } from '@deployer/pkg-build/config'

export default build({
    root: 'src',
    include: ['components', 'hooks', 'lib'],
    entries: ['index.ts'],
    copy: [{ from: 'src/styles', to: 'dist/styles' }],
    variants: ['development', 'production'],
})
```

**Bundled CLI** — `@deployer/cli-declarative-routing` emits one flat CJS file for Node:

```ts
// tooling/bin-declarative-routing/pkg-build.config.ts
import { build } from '@deployer/pkg-build/config'

export default build({
    root: 'src',
    entries: ['index.ts'],
    formats: ['cjs'],
    flat: true,
    target: 'node',
    splitting: false,
    external: ['@parcel/watcher'],
    sourcemap: 'external',
})
```

**Root-entry library** — `@deployer/contracts-entities` has no `src/`, so `root` is `"."`:

```ts
// packages/contracts/api/pkg-build.config.ts
import { build } from '@deployer/pkg-build/config'

export default build({
    root: '.',
    entries: ['index.ts'],
    formats: ['esm'],
    flat: true,
    minify: true,
    external: ['@orpc/contract', '@orpc/shared', 'zod'],
})
```

**CMS migration assets** — `@deployer/nest-schema` copies a tree, and has JSX nowhere,
so it ships the `production` variant alone:

```ts
// packages/nest/schema/pkg-build.config.ts
import { build } from '@deployer/pkg-build/config'

export default build({
    root: 'src',
    copy: [{ from: 'migrations', to: 'dist/migrations' }],
})
```

## Watch mode

`--watch` rebuilds on any change under `root`, with coalescing so a burst of writes
triggers one rebuild; declarations are regenerated on the same pass. Requires
`chokidar` in the package's devDependencies. `--types --watch` watches the
declarations alone.

The canonical declarations watcher is the root `watch:types` script
(`turbo watch build:types`), which only rebuilds packages whose inputs changed.

In dev, packages are built into the image once
(`turbo run build --filter=@deployer/api... --filter=!@deployer/api`), and the container then runs
`turbo watch dev --filter=<app>`. Watch mode reruns the `build` task of any
workspace dependency whose sources change, keeping `dist/` current.

Note the filter has **no trailing `...`**: `--filter=@deployer/api` selects the app alone,
so exactly one `dev` process runs. The trailing-dot form would add a `dev`
watcher inside every dependency instead. Packages therefore do not need to be
watched individually — `^build` builds them, `turbo watch` keeps them current.

## Bundler plugins

`plugins` in the config is the escape hatch for the one thing a declarative
config cannot express: **rewriting how a module resolves**.

`@deployer/config-eslint` is the only package that needs it. It bundles a pinned
TypeScript 6 alongside the ESLint toolchain and redirects every `typescript` /
`typescript/*` import to that copy
(`tooling/eslint/src/plugins/bundle-ts6-island.ts`), because `typescript-eslint@8`
peer-requires `typescript <6.1.0` while every app in this repo compiles against
TypeScript 7. A consumer's TS7 must never reach the bundled lint toolchain.

Plugins are values, so they can only be set from `pkg-build.config.ts` (never
from data), and they are applied to **every** `bun build` pass — a resolution
rule that ran for one pass and not another would produce output that resolves two
different TypeScripts.

## Conventions

- **Declarations are emitted.** `exports.types` points at `./dist/types/*.d.ts`
  so a consumer type-checks declarations instead of re-compiling package sources.
  `type-check` and `lint` (type-aware) depend on `^build:types` in `turbo.json`.
- **Keep the `exports` shape uniform** across packages (see
  `scripts/normalize-package-exports.ts`): `"."` and `"./*"` both expose
  `types` from `dist/types` and `import`/`require` from `dist`.
- **`types` points at emitted declarations, and aliases in them are rewritten.**
  `exports.types` points at `./dist/types/*.d.ts` so a consumer type-checks
  declarations instead of re-compiling package sources. `type-check` and `lint`
  (type-aware) depend on `^build:types` in `turbo.json`. Any `@/…` a declaration
  carries is made relative by the build (see *Declaration emit* above), so a
  package-internal alias is free to appear in source.
- **Package-internal imports may use the package's own name**
  (`@deployer/<pkg>/<path>`) so resolution goes through `exports`, which is
  per-package and therefore portable. A cross-package import **must** use that
  form — `@/` names nothing outside the package that declares it.
- **Bundled apps/CLIs keep relative imports.** A single-entry bundle that imports
  itself by package name makes every internal module an _external_ dependency,
  which the bundle cannot satisfy at runtime.
