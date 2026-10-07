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
    // `.next/cache` (prod). See infra/infra/docker/compose/common/doc/.
    turbopackFileSystemCacheForDev: true,
    turbopackFileSystemCacheForBuild: true,
  },
  // React Compiler: automatic memoization.
  reactCompiler: true,
  // NOTE: `cacheComponents` and `partialPrefetching` are deliberately absent.
  // This app is a static export (`output: 'export'`): there is no server to
  // render a dynamic hole or stream a partial shell into, so Cache Components
  // buys nothing here. It also actively conflicts with the export:
  //   - `partialPrefetching` requires `cacheComponents` (next/server/config.js)
  //   - `output: 'export'` requires `dynamic = 'force-static'` on every route
  //     handler, and `cacheComponents` rejects that segment config
  // Fumadocs ships untranspiled ESM, so Next must compile it.
  transpilePackages: ['fumadocs-core', 'fumadocs-ui', 'fumadocs-mdx'],
  // Monorepo: tell Turbopack the workspace root so it can resolve `next` from
  // the hoisted `node_modules` at the repo root. Without this, Next.js 16+ with
  // Turbopack errors with "could not find next/package.json" in Docker
  // (project dir: /app/apps/doc/src/app, but `next` is hoisted at /app/node_modules).
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
  // Static export for S3/CloudFront.
  //
  // `trailingSlash: true` is what makes the export S3-servable: it emits
  // `docs/intro/getting-started/index.html` instead of
  // `docs/intro/getting-started.html`, so a plain object store resolves
  // `/docs/intro/getting-started/` via its normal directory-index lookup.
  // Without it the export produces `foo.html` files, which S3 cannot serve for
  // `/foo` — that needs a routing layer (CloudFront Function) rewriting every
  // extensionless path.
  output: 'export',
  trailingSlash: true,
}

export default withMDX(config)
