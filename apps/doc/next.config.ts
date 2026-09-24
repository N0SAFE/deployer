import type { NextConfig } from 'next'
import { createMDX } from 'fumadocs-mdx/next'
import path from 'node:path'

// When this file is loaded as a CJS module by Next.js, `__dirname` is the
// directory of this config file (apps/doc/). Going up two levels reaches the
// monorepo root where `next` is hoisted in node_modules.
// NOTE: do NOT use `import.meta.url` here — Bun 1.4.2 has a transpiler bug
// that throws "Expected CommonJS module to have a function wrapper" when
// `import.meta.url` is used inside a `.ts` file loaded as CJS.

const withMDX = createMDX({})

const config: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    turbopackRustReactCompiler: true,
    // Turbopack filesystem cache — persists compilation work under `.next`
    // between runs (dev: `.next/dev`, build: `.next/cache`).
    //
    // Set explicitly because the resolved Next version is `^16.1.2`:
    // dev caching became default-on in 16.1.0 but BUILD caching only in
    // 16.3.0, so relying on the default would silently lose the build cache
    // on any 16.1.x/16.2.x resolution.
    //
    // The cache only pays off if the directory survives the container:
    // compose mounts a named volume over `.next/dev` (dev) and
    // `.next/cache` (prod). See docker/compose/common/doc/.
    turbopackFileSystemCacheForDev: true,
    turbopackFileSystemCacheForBuild: true,
  },
  // React Compiler: automatic memoization.
  reactCompiler: true,
  // Cache Components: `use cache` + Partial Prerendering.
  cacheComponents: true,
  partialPrefetching: true,
  // Fumadocs ships untranspiled ESM, so Next must compile it.
  transpilePackages: ['fumadocs-core', 'fumadocs-ui', 'fumadocs-mdx'],
  // Monorepo: tell Turbopack the workspace root so it can resolve `next` from
  // the hoisted `node_modules` at the repo root. Without this, Next.js 16+ with
  // Turbopack errors with "could not find next/package.json" in Docker
  // (project dir: /app/apps/doc/src/app, but `next` is hoisted at /app/node_modules).
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
  output: 'export'
}

export default withMDX(config)
