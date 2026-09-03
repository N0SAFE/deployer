#!/usr/bin/env -S bun

import { build, BuildConfig } from 'bun'
import { spawn } from 'child_process'
import { existsSync, rmSync, mkdirSync, cpSync } from 'fs'
import * as path from 'path'

// @ts-expect-error -- Bun provides import.meta.dir
const __dirname = import.meta.dir
const srcDir = path.join(__dirname, '..', 'src')
const distDir = path.join(__dirname, '..', 'dist')

/**
 * Cleanup function to remove dist directory
 */
function cleanup() {
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true })
  }
}

/**
 * Copy migrations folder to dist for production use
 */
function copyMigrations(): void {
  const migrationsSource = path.join(srcDir, 'config', 'drizzle', 'migrations')
  const migrationsDest = path.join(distDir, 'migrations')

  if (!existsSync(migrationsSource)) {
    console.warn('⚠️ Migrations folder not found at', migrationsSource)
    return
  }

  // Ensure dist directory exists
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true })
  }

  // Copy migrations folder recursively
  cpSync(migrationsSource, migrationsDest, { recursive: true })
  console.log('📁 Copied migrations to', migrationsDest)
}

/**
 * Run Bun build for NestJS application
 * Builds main.ts and cli.ts entry points with splitting and minification
 */
async function runBuild(): Promise<void> {
  // Main entrypoints with code splitting
  const mainEntrypoints = [
    path.join(srcDir, 'main.ts'),
    path.join(srcDir, 'cli.ts'),
  ]

  const mainConfig = {
    entrypoints: mainEntrypoints,
    outdir: distDir,
    minify: true,
    splitting: true,
    target: 'bun' as const,
    naming: {
      entry: '[dir]/[name].[ext]',
      chunk: 'chunk-[hash].[ext]',
    },
    external: [
      "class-transformer",
      "@nestjs/microservices",
      "@nestjs/platform-socket.io",
    ]
  } as BuildConfig

  console.log(`🔨 Building NestJS entry points...`)

  const mainResult = await build(mainConfig)

  if (!mainResult.success) {
    console.error('❌ Main build failed')
    process.exit(1)
  }

  console.log(`✅ Successfully built to ${distDir}`)
}

/**
 * Run the Vite SSR builds (client + server bundles consumed by
 * @nestjs-ssr/react in production).
 */
async function runSsrBuild(script: 'build:client' | 'build:server'): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`🎨 Building SSR bundle (${script})...`)
    const proc = spawn('bun', ['--bun', 'run', script], {
      stdio: 'inherit',
      shell: false,
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production' },
    })
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log(`✅ SSR bundle built (${script})`)
        resolve()
      } else {
        reject(new Error(`${script} exited with code ${code}`))
      }
    })
    proc.on('error', reject)
  })
}

/**
 * Run database generation using Drizzle Kit
 */
function runDbGenerate(): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log('📦 Generating database schema...')
    const proc = spawn('bun', ['run', 'db:generate'], {
      stdio: 'inherit',
      shell: true,
      cwd: path.join(__dirname, '..'),
    })

    proc.on('exit', (code) => {
      if (code === 0) {
        console.log('✅ Database schema generated')
        resolve()
      } else {
        reject(new Error(`db:generate exited with code ${code}`))
      }
    })

    proc.on('error', reject)
  })
}

/**
 * Main build function - runs Bun build + db:generate concurrently, then the
 * Vite SSR bundles (client + server).
 */
async function main(): Promise<void> {
  console.log('🚀 Starting concurrent build and database generation...\n')

  try {
    cleanup()

    // Run both build and db:generate concurrently
    await Promise.all([runBuild(), runDbGenerate()])

    // SSR bundles (after the Nest build — independent output dirs)
    await Promise.all([runSsrBuild('build:client'), runSsrBuild('build:server')])

    // Copy migrations folder to dist for production use
    copyMigrations()

    console.log('\n✅ Build completed successfully!')
  } catch (error) {
    console.error('\n❌ Build failed:', error)
    process.exit(1)
  }
}

// @ts-ignore
await main()
