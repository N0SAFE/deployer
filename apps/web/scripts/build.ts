#!/usr/bin/env -S bun

import { spawn } from 'child_process'

/**
 * Run generate and build commands sequentially
 * - Generate: bun generate (creates routes and OpenAPI docs)
 * - Build: next build --turbopack, under the Bun runtime (see build() below)
 */
async function runCommand(
  command: string,
  args: string[],
  description: string,
): Promise<number> {
  console.log(`\n📦 ${description}...`)

  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'production' },
    })

    childProcess.on('exit', (code: number | null) => {
      if (code === 0) {
        console.log(`✅ ${description} completed`)
        resolve(code || 0)
      } else {
        reject(new Error(`${description} failed with exit code ${code}`))
      }
    })

    childProcess.on('error', reject)

    // Handle signals
    const handleSignal = (signal: NodeJS.Signals) => {
      console.log(`\n⚠️  Received ${signal}, shutting down...`)
      childProcess.kill(signal)
      process.exit(1)
    }

    process.once('SIGINT', () => handleSignal('SIGINT'))
    process.once('SIGTERM', () => handleSignal('SIGTERM'))
  })
}

async function build(): Promise<void> {
  console.log('🚀 Starting sequential build process...')

  try {
    // First, generate routes and OpenAPI docs (skip next-sitemap, it needs the build manifest)
    await runCommand('bun', ['--bun', 'openapi'], 'Generate routes and OpenAPI docs')

    // Then, build the Next.js app.
    //
    // This MUST run under Bun, not Node. Every `@repo/*` package emits CJS
    // bundles produced by `bun build` (they open with a `// @bun @bun-cjs`
    // marker and an IIFE wrapper that only Bun completes). Under Node,
    // `require('@repo/env')` resolves to an empty object — so `next.config.ts`
    // reads `envSchema.shape` off `undefined` and the build dies with
    // `TypeError: Cannot read properties of undefined (reading 'shape')`.
    // `bun --bun` forces the Bun runtime for this process.
    await runCommand(
      'bun',
      ['--bun', 'run', 'next', 'build', '--turbopack'],
      'Build Next.js application',
    )

    // next-sitemap needs the build manifest produced by `next build`
    await runCommand('bun', ['run', 'build:static-only'], 'Generate sitemap')

    console.log('\n✅ Build completed successfully!')
  } catch (error) {
    console.error(
      '\n❌ Build failed:',
      error instanceof Error ? error.message : error,
    )
    process.exit(1)
  }
}

build()
