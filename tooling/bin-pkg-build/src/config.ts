/**
 * Public configuration surface for `@repo/pkg-build`.
 *
 * Every package declares its build in `pkg-build.config.ts` at the package root
 * through the `defineConfig()` helper:
 *
 * ```ts
 * import { defineConfig } from '@repo/pkg-build/config'
 *
 * export default defineConfig({
 *     root: 'src',
 *     include: ['components'],
 * })
 * ```
 *
 * The schema below is the single source of truth: the runtime validator the
 * builder applies and the parameter type `defineConfig()` accepts are both
 * derived from it, so they cannot drift.
 *
 * A runtime import is safe even for the builder's own config: from inside this
 * package the `@repo/pkg-build/config` specifier resolves through tsconfig
 * `paths` to this file, and from a consuming package it resolves through the
 * installed workspace link to `dist/` — which already has to exist, because the
 * package's `build` script invokes the built CLI.
 */

import zod from 'zod/v4'

/** Emitted module formats. `false` emits no JavaScript at all (types only). */
export const formatSchema = zod.enum(['esm', 'cjs'])

/**
 * JSX variants. A JSX package must ship both, because the React JSX runtime
 * (`jsx` vs `jsxDEV`) is chosen by `NODE_ENV` at the consumer's build time.
 */
export const variantSchema = zod.enum(['development', 'production'])

/** Sourcemap emission. `'none'` writes no `.map` files. */
export const sourcemapSchema = zod.enum([
    'linked',
    'external',
    'inline',
    'none',
])

/** Bundle target: which globals/builtins the emitted code may assume. */
export const targetSchema = zod.enum(['bun', 'node', 'browser'])

/** An asset tree copied verbatim into the output. */
export const copyRuleSchema = zod.object({
    /** Source path, relative to the package root. */
    from: zod.string().min(1),
    /** Destination path, relative to `outDir`. */
    to: zod.string().min(1),
})

/**
 * The build configuration for one package.
 *
 * Every key is optional; the defaults are what a package gets with no config
 * file at all. They are tuned for the common case (a library consumed by
 * Next.js and NestJS), so most packages need only `root`/`include`/`entries`.
 *
 * `strict` so a misspelled key (`minfy`) fails the build instead of being
 * silently ignored — the whole point of moving config out of `package.json`.
 */
export const pkgBuildConfigSchema = zod
    .object({
        /**
         * Source directory, relative to the package root. `.` means the package
         * root itself (packages whose entry sits beside `package.json`).
         *
         * @default 'src'
         */
        root: zod.string().optional(),

        /**
         * Explicit entry files, relative to `root`. Always built, in addition to
         * whatever `include` globs to.
         *
         * When `entries` is the only key set, the glob does not run, so
         * unrelated files at the root (configs, scripts) are not dragged in.
         */
        entries: zod.array(zod.string().min(1)).optional(),

        /**
         * Sub-paths of `root` to glob for entries. Defaults to the whole `root`.
         * Narrows the scan; it never removes an explicit `entries` hit.
         */
        include: zod.array(zod.string()).optional(),

        /**
         * Formats to emit. `false` emits no JavaScript (declarations only).
         *
         * @default ['esm', 'cjs']
         */
        formats: zod
            .union([zod.array(formatSchema), zod.literal(false)])
            .optional(),

        /**
         * JSX variants to emit. Omit to derive: a package whose sources contain
         * `.tsx` ships both, anything else ships `production` alone.
         */
        variants: zod.array(variantSchema).min(1).optional(),

        /**
         * Base output directory.
         *
         * @default 'dist'
         */
        outDir: zod.string().min(1).optional(),

        /**
         * Emit directly into `outDir` instead of `outDir/<format>`.
         *
         * @default false
         */
        flat: zod.boolean().optional(),

        /**
         * Build target.
         *
         * @default 'bun'
         */
        target: targetSchema.optional(),

        /**
         * Code splitting. Defaults to on for `esm` and off for `cjs` (bun
         * refuses splitting in CJS). Leaving it on keeps shared modules in one
         * chunk instead of duplicating them into every entry.
         */
        splitting: zod.boolean().optional(),

        /**
         * Minify the emitted JavaScript.
         *
         * Defaults to off unless the build is a **production** build *and* the
         * variant being emitted is `production`. A development build (the mode a
         * dev container uses, from `NODE_ENV`) stays readable everywhere, and the
         * development *variant* stays readable even in a production build — only
         * the variant a production consumer actually loads is minified.
         *
         * Identifier mangling is deliberately NOT enabled: several packages
         * reflect on `constructor.name` (NestJS loggers, error classes), and
         * bun's `minify.keepNames` does not preserve it under `identifiers` in
         * 1.4.2 — the class name is renamed regardless.
         */
        minify: zod.boolean().optional(),

        /**
         * Sourcemap emission.
         *
         * Defaults to `'linked'` except on a production build of the
         * `production` variant, so maps aid local debugging in development
         * without shipping with the artifact a production consumer loads.
         */
        sourcemap: sourcemapSchema.optional(),

        /**
         * Extra specifiers to leave unbundled, in addition to the package's own
         * name (always external, so self-imports keep their module boundary).
         *
         * @default []
         */
        external: zod.array(zod.string().min(1)).optional(),

        /**
         * Asset trees to copy into the output, variant-independent.
         *
         * @default []
         */
        copy: zod.array(copyRuleSchema).optional(),

        /**
         * Keep `process.env.X` a runtime lookup. When `false` (opt-in), bun
         * inlines the value at build time, which is almost never what a library
         * wants.
         *
         * @default true
         */
        keepEnv: zod.boolean().optional(),

        /**
         * Emit declarations to `<outDir>/types`. Set `false` only for a package
         * that must not ship declarations.
         *
         * @default true
         */
        types: zod.boolean().optional(),
    })
    .strict()

/** Emitted module formats. `false` emits no JavaScript at all (types only). */
export type Format = zod.infer<typeof formatSchema>

/**
 * JSX variants. A JSX package must ship both, because the React JSX runtime
 * (`jsx` vs `jsxDEV`) is chosen by `NODE_ENV` at the consumer's build time.
 */
export type Variant = zod.infer<typeof variantSchema>

/**
 * Which build target a process is producing.
 *
 * Deliberately **not** `'development' | 'production'`: those are the `Variant`
 * values, and the two axes are independent — a production build emits both JSX
 * variants. Sharing literal values would make the two silently interchangeable at
 * call sites like `minifyFor(mode, variant)`.
 */
export type BuildMode = 'dev' | 'prod'

/** Sourcemap emission. `'none'` writes no `.map` files. */
export type SourcemapMode = zod.infer<typeof sourcemapSchema>

/** Bundle target: which globals/builtins the emitted code may assume. */
export type BuildTarget = zod.infer<typeof targetSchema>

/** An asset tree copied verbatim into the output. */
export type CopyRule = zod.infer<typeof copyRuleSchema>

/** The authored shape of a package's `pkg-build.config.ts`. */
export type PkgBuildConfig = zod.infer<typeof pkgBuildConfigSchema>

/**
 * Type a package's build config.
 *
 * The explicit parameter type is what makes this worth importing: an object
 * literal passed here is excess-property checked, so a misspelled key fails
 * `type-check` instead of being silently ignored at build time. A plain
 * `export default { … }` would accept anything.
 *
 * Validation is intentionally not repeated here. The builder parses the default
 * export with `pkgBuildConfigSchema` and reports the offending key with a path,
 * so the failure lands where the file is actually read.
 */
export function defineConfig(config: PkgBuildConfig): PkgBuildConfig {
    return config
}

/** Config file basenames probed at the package root, in priority order. */
export const CONFIG_FILE_NAMES = [
    'pkg-build.config.ts',
    'pkg-build.config.mts',
    'pkg-build.config.js',
    'pkg-build.config.mjs',
] as const

/** The legacy in-`package.json` key, still honoured (and deprecated). */
export const LEGACY_CONFIG_KEY = 'pkgBuild'
