#!/usr/bin/env bun

import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { execSync } from 'child_process'

// Type definitions
interface Colors {
  readonly reset: string
  readonly green: string
  readonly red: string
  readonly yellow: string
  readonly blue: string
  readonly cyan: string
}

type LogStatus = 'info' | 'success' | 'error' | 'warn'

interface DiagnosticReport {
  timestamp: string
  root: string
  sections: Record<string, unknown>
}

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

interface DirectoryListOptions {
  path: string
  maxDepth?: number
  currentDepth?: number
  prefix?: string
}

const ROOT = process.cwd()
const REPORT: DiagnosticReport = {
  timestamp: new Date().toISOString(),
  root: ROOT,
  sections: {},
}

// Colors for console output
const colors: Colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

/**
 * Log a message with status indicator
 * @param section - The section/category of the log
 * @param message - The message to display
 * @param status - The status type (info, success, error, warn)
 */
function log(section: string, message: string, status: LogStatus = 'info'): void {
  const statusColor: Record<LogStatus, string> = {
    info: colors.blue,
    success: colors.green,
    error: colors.red,
    warn: colors.yellow,
  }

  console.log(`${statusColor[status]}[${section}]${colors.reset} ${message}`)
}

/**
 * Check if a path exists and log its properties
 * @param path - The path to check
 * @param description - Description for logging
 * @returns Whether the path exists
 */
function checkPath(path: string, description: string): boolean {
  const fullPath = join(ROOT, path)
  const exists = existsSync(fullPath)
  const status = exists ? 'success' : 'error'

  log('PATH', `${description}: ${path}`, status)

  if (exists) {
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        log('PATH', `  └─ (directory)`, 'info')
      } else if (stat.isFile()) {
        log('PATH', `  └─ (file, ${(stat.size / 1024).toFixed(2)}KB)`, 'info')
      }
    } catch (e) {
      const error = e as Error
      log('PATH', `  └─ Error reading stats: ${error.message}`, 'error')
    }
  }

  return exists
}

/**
 * Recursively list directory contents
 * @param options - Options for directory listing
 * @returns Array of formatted directory entries
 */
function listDirectory(options: DirectoryListOptions | string, maxDepth?: number, currentDepth?: number, prefix?: string): string[] {
  // Handle backward compatibility with old function signature
  const opts: DirectoryListOptions = typeof options === 'string' 
    ? { path: options, maxDepth: maxDepth ?? 1, currentDepth: currentDepth ?? 0, prefix: prefix ?? '' }
    : options

  const { path, maxDepth: depth = 1, currentDepth: cDepth = 0, prefix: pfx = '' } = opts
  const fullPath = join(ROOT, path)

  if (!existsSync(fullPath)) {
    return []
  }

  if (cDepth >= depth) {
    return []
  }

  try {
    const items = readdirSync(fullPath)
    const results: string[] = []

    for (const item of items) {
      if (item.startsWith('.')) continue

      const itemPath = join(fullPath, item)
      const stat = statSync(itemPath)
      const isDir = stat.isDirectory()
      const icon = isDir ? '📁' : '📄'

      results.push(`${pfx}${icon} ${item}${isDir ? '/' : ''}`)

      if (isDir && cDepth < depth - 1) {
        const subItems = listDirectory({ 
          path: join(path, item), 
          maxDepth: depth, 
          currentDepth: cDepth + 1, 
          prefix: pfx + '  ' 
        })
        results.push(...subItems)
      }
    }

    return results
  } catch (e) {
    const error = e as Error
    return [`${pfx}❌ Error: ${error.message}`]
  }
}

/**
 * Check node_modules and key packages for a specific package
 * @param packagePath - Path to the package
 * @param description - Description for logging
 */
function checkNodeModules(packagePath: string, description: string): void {
  log('MODULES', `\n${description}`, 'info')

  const packageJson = join(ROOT, packagePath, 'package.json')
  const nodeModules = join(ROOT, packagePath, 'node_modules')

  if (!existsSync(packageJson)) {
    log('MODULES', `  ❌ package.json not found at ${packagePath}`, 'error')
    return
  }

  log('MODULES', `  ✓ package.json found`, 'success')

  if (!existsSync(nodeModules)) {
    log('MODULES', `  ❌ node_modules not found at ${packagePath}/node_modules`, 'error')
    return
  }

  log('MODULES', `  ✓ node_modules exists`, 'success')

  // Check for key packages
  const keyPackages: string[] = [
    '@orpc/contract',
    '@orpc/server',
    'zod',
    'typescript',
    'nestjs',
    'express',
  ]

  for (const pkg of keyPackages) {
    const pkgPath = join(nodeModules, pkg)
    const exists = existsSync(pkgPath)
    const status = exists ? 'success' : 'error'
    log('MODULES', `    ${exists ? '✓' : '❌'} ${pkg}`, status)
  }
}

function checkBunLock() {
  log('LOCK', '\nChecking lock files', 'info')

  const bunLock = join(ROOT, 'bun.lock')
  const bunLockBak = join(ROOT, 'bun.lock.bak')

  if (existsSync(bunLock)) {
    const stat = statSync(bunLock)
    log('LOCK', `  ✓ bun.lock exists (${(stat.size / 1024 / 1024).toFixed(2)}MB)`, 'success')
  } else {
    log('LOCK', `  ❌ bun.lock not found`, 'error')
  }

  if (existsSync(bunLockBak)) {
    log('LOCK', `  ⓘ bun.lock.bak exists (backup)`, 'warn')
  }
}

/**
 * Check dependency resolution across key packages
 */
function checkDependencyResolution(): void {
  log('DEPS', '\nChecking dependency resolution', 'info')

  const paths: string[] = [
    'packages/contracts/common',
    'apps/api-services/bff',
    'apps/api-services/shared',
    'apps/web',
  ]

  for (const path of paths) {
    const packageJsonPath = join(ROOT, path, 'package.json')
    if (!existsSync(packageJsonPath)) continue

    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as PackageJson
      log('DEPS', `\n  ${path}:`, 'info')

      // Check dependencies
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies,
        ...pkg.peerDependencies,
      }

      const criticalDeps: string[] = ['@orpc/contract', 'zod', 'express', 'typescript']
      for (const dep of criticalDeps) {
        if (dep in allDeps) {
          log('DEPS', `    ✓ ${dep}@${allDeps[dep]}`, 'success')
        }
      }
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      log('DEPS', `    ❌ Error reading package.json: ${error.message}`, 'error')
    }
  }
}

/**
 * Check critical source files
 */
function checkSourceFiles(): void {
  log('SOURCE', '\nChecking source files', 'info')

  const criticalFiles: string[] = [
    'packages/contracts/bff/index.ts',
    'packages/contracts/runtime/index.ts',
    'apps/api-services/bff/src/main.ts',
    'packages/nest/schema/drizzle.config.ts',
  ]

  for (const file of criticalFiles) {
    const fullPath = join(ROOT, file)
    const exists = existsSync(fullPath)
    const status = exists ? 'success' : 'error'

    if (exists) {
      try {
        const stat = statSync(fullPath)
        log('SOURCE', `  ${exists ? '✓' : '❌'} ${file} (${stat.size} bytes)`, status)
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e))
        log('SOURCE', `  ❌ ${file} - Error: ${error.message}`, 'error')
      }
    } else {
      log('SOURCE', `  ${exists ? '✓' : '❌'} ${file}`, status)
    }
  }
}

/**
 * Check Docker environment configuration
 */
function checkDockerEnvironment(): void {
  log('DOCKER', '\nChecking Docker configuration', 'info')

  const dockerFiles: string[] = [
    'docker/Dockerfile.web.dev',
    'docker/Dockerfile.api.dev',
    'docker-compose.yml',
  ]

  for (const file of dockerFiles) {
    const fullPath = join(ROOT, file)
    const exists = existsSync(fullPath)
    const status = exists ? 'success' : 'error'
    log('DOCKER', `  ${exists ? '✓' : '❌'} ${file}`, status)
  }
}

/**
 * Check environment variables configuration
 */
function checkEnv(): void {
  log('ENV', '\nChecking environment variables', 'info')

  const envFile = join(ROOT, '.env')
  const envExists = existsSync(envFile)

  if (envExists) {
    log('ENV', `  ✓ .env file found`, 'success')

    try {
      const envContent = readFileSync(envFile, 'utf-8')
      const lines = envContent.split('\n').filter((l: string) => l.trim() && !l.startsWith('#'))
      log('ENV', `    └─ ${lines.length} variables configured`, 'info')
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      log('ENV', `    ❌ Error reading .env: ${error.message}`, 'error')
    }
  } else {
    log('ENV', `  ❌ .env file not found`, 'error')
  }
}

/**
 * Check Turbo configuration
 */
function checkTurboConfig(): void {
  log('TURBO', '\nChecking Turbo configuration', 'info')

  const turboJsonPath = join(ROOT, 'turbo.json')
  const tsconfigPath = join(ROOT, 'tsconfig.json')

  const turboExists = existsSync(turboJsonPath)
  const tsconfigExists = existsSync(tsconfigPath)

  log('TURBO', `  ${turboExists ? '✓' : '❌'} turbo.json`, turboExists ? 'success' : 'error')
  log('TURBO', `  ${tsconfigExists ? '✓' : '❌'} tsconfig.json`, tsconfigExists ? 'success' : 'error')

  if (turboExists) {
    try {
      const turbo = JSON.parse(readFileSync(turboJsonPath, 'utf-8')) as { tasks?: Record<string, unknown> }
      const tasks = Object.keys(turbo.tasks || {})
      log('TURBO', `    └─ ${tasks.length} tasks configured`, 'info')
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      log('TURBO', `    ❌ Error reading turbo.json: ${error.message}`, 'error')
    }
  }
}

/**
 * Generate the complete diagnostic report
 */
function generateReport(): void {
  console.log(`\n${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`)
  console.log(`${colors.cyan}║          BUILD ENVIRONMENT DIAGNOSTIC REPORT               ║${colors.reset}`)
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}\n`)

  log('REPORT', `Timestamp: ${REPORT.timestamp}`, 'info')
  log('REPORT', `Root path: ${ROOT}`, 'info')

  // Run all checks
  checkBunLock()
  checkTurboConfig()
  checkEnv()
  checkSourceFiles()
  checkDependencyResolution()
  checkNodeModules('packages/contracts/bff', 'BFF Contracts Package')
  checkNodeModules('apps/api-services/bff', 'BFF Application')
  checkNodeModules('apps/api-services/shared', 'API Services Shared Package')
  checkNodeModules('apps/web', 'Web Application')
  checkDockerEnvironment()

  // Additional directory listings
  console.log(`\n${colors.cyan}📂 Directory Structure:${colors.reset}`)
  console.log(`${colors.cyan}packages/:${colors.reset}`)
  listDirectory('packages', 2).forEach(line => console.log('  ' + line))

  console.log(`\n${colors.cyan}apps/:${colors.reset}`)
  listDirectory('apps', 2).forEach(line => console.log('  ' + line))

  console.log(`\n${colors.cyan}node_modules (root level):${colors.reset}`)
  const nodeModulesItems = listDirectory('node_modules', 1).slice(0, 20)
  nodeModulesItems.forEach(line => console.log('  ' + line))
  const nodeModulesCount = readdirSync(join(ROOT, 'node_modules')).length
  if (nodeModulesCount > 20) {
    console.log(`  ... and ${nodeModulesCount - 20} more`)
  }

  console.log(`\n${colors.cyan}╔════════════════════════════════════════════════════════════╗${colors.reset}`)
  console.log(`${colors.cyan}║                    END OF REPORT                           ║${colors.reset}`)
  console.log(`${colors.cyan}╚════════════════════════════════════════════════════════════╝${colors.reset}\n`)
}

// Run the diagnostic
try {
  generateReport()
  process.exit(0)
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error))
  console.error(`${colors.red}Fatal error: ${err.message}${colors.reset}`)
  process.exit(1)
}
