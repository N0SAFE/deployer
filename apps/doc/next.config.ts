import type { NextConfig } from 'next'
import { createMDX } from 'fumadocs-mdx/next'
import path from 'node:path'

// When this file is loaded as a CJS module by Next.js, `__dirname` is the
// directory of this config file (apps/doc/). Going up two levels reaches the
// monorepo root where `next` is hoisted in node_modules.
// NOTE: do NOT use `import.meta.url` here — Bun 1.3.14 has a transpiler bug
// that throws "Expected CommonJS module to have a function wrapper" when
// `import.meta.url` is used inside a `.ts` file loaded as CJS.

const withMDX = createMDX({})

const config: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactCompiler: true, // disable react compiler because of errors with docker and new bun 1.3.0
  // Monorepo: tell Turbopack the workspace root so it can resolve `next` from
  // the hoisted `node_modules` at the repo root. Without this, Next.js 16+ with
  // Turbopack errors with "could not find next/package.json" in Docker
  // (project dir: /app/apps/doc/src/app, but `next` is hoisted at /app/node_modules).
  turbopack: {
    root: path.join(__dirname, '../..'),
  },
}

export default withMDX(config)
