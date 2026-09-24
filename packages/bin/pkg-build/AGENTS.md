# pkg-build — shared configurable package builder

One build pipeline for every workspace package. Behaviour is declared in each
package's own `package.json` under a `pkgBuild` block, so a package with unusual
needs overrides configuration instead of forking a script.

## Why

Packages are consumed as **built output** (`dist/esm/**`, `dist/cjs/**`), never as
raw TypeScript. That is what makes the `@/*` path alias usable *inside* package
sources: `paths` aliases are resolved from the **consumer's** tsconfig, so raw
source importing `@/x` would resolve against the app's `src/` and fail. Publishing
bundles keeps the alias an internal detail.

`bun build` is the bundler because it resolves `tsconfig.paths` and — with
`experimentalDecorators` + `emitDecoratorMetadata` — emits legacy decorators with
`design:paramtypes`, which NestJS DI requires.

## Usage

```json
{
    "scripts": {
        "build": "bun --bun ../../bin/pkg-build/index.ts",
        "dev": "bun --bun ../../bin/pkg-build/index.ts --watch"
    }
}
```

With no `pkgBuild` block, defaults apply:

- `root`: `src`
- entries: every `src/**/*.{ts,tsx}` except tests
- `formats`: `esm` → `dist/esm/*.mjs`, `cjs` → `dist/cjs/*.js`
- `target`: `bun`
- `splitting`: on for esm only (bun refuses splitting for cjs)
- dts: **not emitted** — `exports.types` points at `./src/*.ts`

## Config reference

| Key | Type | Default | Purpose |
|---|---|---|---|
| `root` | `string` | `"src"` | Source directory. `"."` means the package root. |
| `entries` | `string[]` | — | Explicit entry files, relative to `root`. |
| `include` | `string[]` | — | Narrow the glob to these sub-paths of `root`. |
| `formats` | `("esm"\|"cjs")[]` \| `false` | `["esm","cjs"]` | Formats to emit. `false` emits none. |
| `outDir` | `string` | `"dist"` | Base output directory. |
| `flat` | `boolean` | `false` | Emit into `outDir` directly instead of `outDir/<format>`. |
| `target` | `"bun"\|"node"\|"browser"` | `"bun"` | Build target. |
| `splitting` | `boolean` | esm-only | Override code splitting. |
| `minify` | `boolean` | `false` | Minify output. |
| `sourcemap` | `"linked"\|"external"\|"inline"\|"none"` | `"linked"` | Sourcemap mode. |
| `external` | `string[]` | `[]` | Extra specifiers to leave unbundled. |
| `copy` | `{from,to}[]` | `[]` | Extra assets copied into the output. |
| `keepEnv` | `boolean` | `true` | Keep `process.env.X` a runtime lookup. |

`entries` and the glob are a **union**: explicit entries are always built, and
`include` narrows the scan. When only `entries` is given the glob does not run, so
unrelated root files are not dragged in.

Every source file is an entry, so `dist/` mirrors the source tree — which is what
makes subpath exports such as `./react/session/client` resolve to a real file.

## `keepEnv` and `process.env`

bun inlines `process.env.NODE_ENV` at build time unless disabled. That silently
changes behaviour: code reading it per request, or a test assigning it in
`beforeEach`, would see the build-time value. `keepEnv: true` (the default) passes
`define: {}` and `env: 'disable'` so the lookup stays dynamic. Set `keepEnv: false`
only when a package genuinely wants build-time substitution.

## Worked examples

**Nested packages with root export** — `@repo/ui`:

```json
"pkgBuild": {
    "root": "src",
    "include": ["components", "hooks", "lib"],
    "entries": ["index.ts"],
    "copy": [{ "from": "src/styles", "to": "dist/styles" }]
}
```

**Bundled CLI** — `@repo/cli-declarative-routing` emits one flat CJS file for Node:

```json
"pkgBuild": {
    "root": "src",
    "entries": ["index.ts"],
    "formats": ["cjs"],
    "flat": true,
    "target": "node",
    "splitting": false,
    "external": ["@parcel/watcher"],
    "sourcemap": "external"
}
```

**Root-entry library** — `@repo/api-contracts` has no `src/`, so `root` is `"."`:

```json
"pkgBuild": {
    "root": ".",
    "entries": ["index.ts"],
    "formats": ["esm"],
    "flat": true,
    "minify": true,
    "external": ["@orpc/contract", "@orpc/shared", "zod"]
}
```

## Watch mode

`--watch` rebuilds on any change under `root`, with coalescing so a burst of writes
triggers one rebuild. Declarations are not involved (none are emitted). Requires
`chokidar` in the package's devDependencies.

In dev, packages are built by the Docker dev image
(`turbo run build --filter=api... --filter=!api`), and `turbo run dev` starts the
watchers, so a source edit in a package is picked up without a manual build.

## The one exception

`@repo/config-eslint` keeps its own `build.ts`. It bundles a **pinned TypeScript 6**
alongside the ESLint toolchain and redirects every `typescript` /
`typescript/*` import to that copy via a custom esbuild plugin, so a consumer's
TypeScript 7 can never be used by the bundled lint toolchain. That redirect is
plugin logic `pkg-build` does not model; forcing it through the shared pipeline
would mean adding a plugin-extension point for a single caller.

## Conventions

- **Do not emit declarations.** `exports.types` points at `./src/*.ts` so a
  consumer type-checks from source and never needs a local package build.
- **Keep the `exports` shape uniform** across packages (see
  `scripts/normalize-package-exports.ts`): `"."` and `"./*"` both expose
  `types` from source and `import`/`require` from `dist`.
- **`types` must point at source files that avoid `@/`** in any module reachable
  through `exports` subpaths, because those files become part of the consumer's
  program. Package-internal imports must use the package's own name
  (`@repo/<pkg>/<path>`) so resolution goes through `exports`, which is
  per-package and therefore portable.
- **Bundled apps/CLIs keep relative imports.** A single-entry bundle that imports
  itself by package name makes every internal module an *external* dependency,
  which the bundle cannot satisfy at runtime.
