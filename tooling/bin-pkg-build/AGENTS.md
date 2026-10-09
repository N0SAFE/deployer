# pkg-build — shared configurable package builder

One build pipeline for every workspace package. Behaviour is declared in each
package's own `pkg-build.config.ts`, type-checked through `defineConfig()` from
`@repo/pkg-build/config`, so a package with unusual needs overrides
configuration instead of forking a script.

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

Consumers execute the **built CLI**, by its `bin` name, not a path into
`dist/`. `@repo/pkg-build` is a workspace devDependency, so the bin is linked
into the package's `node_modules/.bin` and `bun --bun pkg-build` resolves it —
no `../../../tooling/bin-pkg-build/dist/cjs/main.js` in any manifest:

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

Why the built artifact and not `src/main.ts`? Bun resolves `tsconfig.json` from
the **process cwd**, and the CLI runs with the consuming package as cwd. A
consumer tsconfig without `experimentalDecorators` makes the CLI's
`@RootCommand()`/`@Option()` decorators run through the TC39 path
(`descriptor.value` is `undefined`). `--tsconfig-override` does not fix it
(measured). The built bundle has the decorators already transformed, so it is
cwd-independent.

Ordering is turbo's job, and it is declared, not incidental:

- every consumer lists `@repo/pkg-build` in devDependencies (the normalizer
  enforces it), so `^build` builds the CLI first;
- the `build:types` task additionally depends on `@repo/pkg-build#build`, because
  its own `^build:types` edge only produces declarations.

pkg-build builds itself: its `build`/`build:types`/`dev` scripts run
`src/main.ts` (cwd is the package itself, so its own tsconfig applies).

- `build` — JS bundles + declarations.
- `build:types` — declarations only (`dist/types/**`); the JS output is left
  untouched, which is what makes the task independently watchable. Turbo task is
  `build:types` (`dependsOn: ["^build:types", "@repo/pkg-build#build"]`, outputs
  `dist/types/**`).
- `dev` — watch JS + declarations.
- Root `watch:types` = `turbo watch build:types` keeps declarations current while
  editing. It is a root `package.json` script, not a turbo task.

## CLI architecture

NestJS + nest-commander, one root command so call sites stay flag-only:

```
src/
  main.ts                        bootstrap: CommandFactory.run(AppModule)
  app.module.ts                  providers: config service, builder, command
  commands/
    pkg-build.command.ts         @RootCommand + -w/--watch, -t/--types
  services/
    pkg-config.service.ts        package.json -> effective config, entries, layout
    pkg-builder.service.ts       bun build passes, tsc declarations, watch
  variant-child.ts               NODE_ENV-specific entry, spawned per JSX variant
  utils/                         colors, die, JSONC reader, fs walker
```

`src/variant-child.ts` deliberately does not boot Nest: `bun build` samples
`NODE_ENV` at process start to pick the React JSX runtime, so each variant needs
a fresh process, but the child only needs one service call. It resolves as a
sibling of the current module in source and in the built trees.

**Runtime output is ASCII-only.** Bun 1.4.2 mis-decodes non-ASCII string literals
at runtime for files carrying its `// @bun` internal marker (a built bundle), so
`▶`/`✔`/`✖` print as mojibake even though the file bytes are correct. Keep CLI
output ASCII until that upstream behavior is fixed; the colored `>`/`ok`/`x`
markers are deliberate.

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
| `copy`      | `{from,to}[]`                            | `[]`            | Extra assets copied into the output.                                                  |
| `keepEnv`   | `boolean`                                | `true`          | Keep `process.env.X` a runtime lookup.                                                |
| `types`     | `boolean`                                | `true`          | Emit `dist/types/**`. Set `false` only for a package that must not ship declarations. |

`entries` and the glob are a **union**: explicit entries are always built, and
`include` narrows the scan. When only `entries` is given the glob does not run, so
unrelated root files are not dragged in.

Identifier mangling is deliberately not enabled. Several packages reflect on
`constructor.name` (NestJS loggers, error classes), and bun's `minify.keepNames`
does not preserve it under `identifiers` in 1.4.2 — the class name is renamed
regardless (measured).

Every source file is an entry, so `dist/` mirrors the source tree — which is what
makes subpath exports such as `./react/session/client` resolve to a real file.

## Declaration emit (`dist/types`)

The types pass runs `tsc -p .pkg-build-types.tsconfig.json`, a config generated
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

- Split the value: `@repo/api-contracts` no longer exports a combined
  `appContract`; each app composes the router locally where `declaration` is
  false (`apps/api/src/core/orpc/app-contract.ts`).
- Annotate the return type: `@repo/auth` annotates plugin wrappers and factories
  with `ReturnType<typeof …>` / `Auth<ReturnType<typeof createAuthConfig<…>>>`
  so declarations reference names instead of expanding the inference.

## `keepEnv` and `process.env`

bun inlines `process.env.NODE_ENV` at build time unless disabled. That silently
changes behaviour: code reading it per request, or a test assigning it in
`beforeEach`, would see the build-time value. `keepEnv: true` (the default) passes
`define: {}` and `env: 'disable'` so the lookup stays dynamic. Set `keepEnv: false`
only when a package genuinely wants build-time substitution.

## Worked examples

**Nested packages with root export** — `@repo/ui`:

```ts
// packages/ui/base/pkg-build.config.ts
import { defineConfig } from '@repo/pkg-build/config'

export default defineConfig({
    root: 'src',
    include: ['components', 'hooks', 'lib'],
    entries: ['index.ts'],
    copy: [{ from: 'src/styles', to: 'dist/styles' }],
    variants: ['development', 'production'],
})
```

**Bundled CLI** — `@repo/cli-declarative-routing` emits one flat CJS file for Node:

```ts
// tooling/bin-declarative-routing/pkg-build.config.ts
import { defineConfig } from '@repo/pkg-build/config'

export default defineConfig({
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

**Root-entry library** — `@repo/api-contracts` has no `src/`, so `root` is `"."`:

```ts
// packages/contracts/api/pkg-build.config.ts
import { defineConfig } from '@repo/pkg-build/config'

export default defineConfig({
    root: '.',
    entries: ['index.ts'],
    formats: ['esm'],
    flat: true,
    minify: true,
    external: ['@orpc/contract', '@orpc/shared', 'zod'],
})
```

**CMS migration assets** — `@repo/nest-schema` copies a tree, and has JSX nowhere,
so it ships the `production` variant alone:

```ts
// packages/nest/schema/pkg-build.config.ts
import { defineConfig } from '@repo/pkg-build/config'

export default defineConfig({
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
(`turbo run build --filter=api... --filter=!api`), and the container then runs
`turbo watch dev --filter=<app>`. Watch mode reruns the `build` task of any
workspace dependency whose sources change, keeping `dist/` current.

Note the filter has **no trailing `...`**: `--filter=api` selects the app alone,
so exactly one `dev` process runs. The trailing-dot form would add a `dev`
watcher inside every dependency instead. Packages therefore do not need to be
watched individually — `^build` builds them, `turbo watch` keeps them current.

## The one exception

`@repo/config-eslint` keeps its own `build.ts`. It bundles a **pinned TypeScript 6**
alongside the ESLint toolchain and redirects every `typescript` /
`typescript/*` import to that copy via a custom esbuild plugin, so a consumer's
TypeScript 7 can never be used by the bundled lint toolchain. That redirect is
plugin logic `pkg-build` does not model; forcing it through the shared pipeline
would mean adding a plugin-extension point for a single caller.

## Conventions

- **Declarations are emitted.** `exports.types` points at `./dist/types/*.d.ts`
  so a consumer type-checks declarations instead of re-compiling package sources.
  `type-check` and `lint` (type-aware) depend on `^build:types` in `turbo.json`.
- **Keep the `exports` shape uniform** across packages (see
  `scripts/normalize-package-exports.ts`): `"."` and `"./*"` both expose
  `types` from `dist/types` and `import`/`require` from `dist`.
- **`types` must point at emitted declarations that avoid `@/`** in any module
  reachable through `exports` subpaths, because those files become part of the
  consumer's program. Package-internal imports must use the package's own name
  (`@repo/<pkg>/<path>`) so resolution goes through `exports`, which is
  per-package and therefore portable.
- **Bundled apps/CLIs keep relative imports.** A single-entry bundle that imports
  itself by package name makes every internal module an _external_ dependency,
  which the bundle cannot satisfy at runtime.
