import type { NextConfig } from 'next'
import { createMDX } from 'fumadocs-mdx/next'
import path from 'node:path'

// When this file is loaded as a CJS module by Next.js, `__dirname` is the
// directory of this config file (apps/doc/). Going up two levels reaches the
// monorepo root where `next` is hoisted in node_modules.
//
// `__dirname` is used rather than `import.meta.url` for a reason that no longer
// applies: Bun 1.4.2 threw "Expected CommonJS module to have a function wrapper"
// when `import.meta.url` appeared in a `.ts` file loaded as CJS. Verified fixed
// on Bun 1.4.3, so either form would work now — `__dirname` is kept because it
// is what Next.js documents for a CJS-loaded config.

const withMDX = createMDX({})

// Repository root (`apps/doc/../..`), which holds the hoisted `next`.
const workspaceRoot = path.join(__dirname, '../..')

// Bun's package cache. Under `linker = "isolated"` this holds the real files
// that apps/doc/node_modules symlinks point at, so Turbopack's root has to
// contain it — see the `turbopack.root` comment below.
const bunCacheRoot = process.env.BUN_INSTALL
  ? path.join(process.env.BUN_INSTALL, 'install', 'cache')
  : path.join(
      process.env.HOME ?? process.env.USERPROFILE ?? '/',
      '.bun',
      'install',
      'cache',
    )

// Longest shared leading path of two absolute paths, as a filesystem root.
function commonAncestor(a: string, b: string): string {
  const left = a.split(path.sep).filter(Boolean)
  const right = b.split(path.sep).filter(Boolean)
  const shared: string[] = []
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) break
    shared.push(left[i] as string)
  }
  return path.sep + shared.join(path.sep)
}

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
  // Monorepo + Bun's isolated linker.
  //
  // Turbopack needs a root that is an ancestor of `next` (hoisted at the repo
  // root, not in apps/doc) — but the repo root alone is NOT enough here. With
  // `linker = "isolated"` (bunfig.toml) every dependency in apps/doc/node_modules
  // is a symlink whose real target lives in Bun's global cache, outside the
  // repo:
  //
  //   apps/doc/node_modules/react
  //     -> ~/.bun/install/cache/links/react@19.3.0-<hash>/node_modules/react
  //
  // Turbopack refuses to follow a symlink whose target escapes `turbopack.root`.
  // Left at the repo root, every package resolves to "Module not found" even
  // though it exists on disk — 444 such errors across mermaid, radix, d3, react.
  // The root must therefore also contain the package cache.
  //
  // The common ancestor is computed rather than hardcoded so this keeps working
  // wherever Bun installs its cache (Docker sets BUN_INSTALL, a host dev box
  // usually does not). `src/app` lives under apps/doc/src, so the project dir is
  // still inside the root.
  turbopack: {
    root: commonAncestor(workspaceRoot, bunCacheRoot),
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
