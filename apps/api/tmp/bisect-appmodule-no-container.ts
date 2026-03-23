import 'reflect-metadata'
import { Test } from '@nestjs/testing'

const log = (...args: unknown[]) => {
  console.log(new Date().toISOString(), ...args)
}

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://deployer:deployer@127.0.0.1:1/deployer_e2e',
  AUTH_SECRET: 'test-auth-secret-key-for-testing-only',
  BETTER_AUTH_SECRET: 'test-auth-secret-key-for-testing-only',
  NEXT_PUBLIC_API_URL: 'http://localhost:3001',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  API_PORT: '3001',
  DEFAULT_ADMIN_EMAIL: 'admin@test.com',
  DEFAULT_ADMIN_PASSWORD: 'testpassword',
  NODE_LOCAL_DB_PATH: '/tmp/deployer-api-e2e-local.db',
})

const timeoutMs = 10000

const nameOf = (imp: unknown): string => {
  if (!imp) return '<null>'
  if (typeof imp === 'function') return (imp as { name?: string }).name ?? '<anonymous fn>'
  if (typeof imp === 'object' && imp !== null && 'module' in imp) {
    const moduleName = (imp as { module?: { name?: string } }).module?.name
    return moduleName ? `${moduleName}(dynamic)` : '<dynamic module>'
  }
  return typeof imp
}

async function run() {
  log('importing AppModule')
  const { AppModule } = await import('../src/app.module')
  const imports = (Reflect.getMetadata('imports', AppModule) as unknown[]) ?? []
  log('imports', imports.length)

  for (let i = 1; i <= imports.length; i += 1) {
    const subset = imports.slice(0, i)
    const current = nameOf(imports[i - 1])
    const startedAt = Date.now()
    try {
      const compiled = await Promise.race([
        Test.createTestingModule({ imports: subset }).compile(),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`timeout after ${String(timeoutMs)}ms`)), timeoutMs)
        }),
      ])
      log('OK', i, current, `${Date.now() - startedAt}ms`)
      await (compiled as { close: () => Promise<void> }).close()
    } catch (error) {
      log('FAIL', i, current, `${Date.now() - startedAt}ms`, error)
      break
    }
  }

  log('done')
}

run().catch((error) => {
  log('fatal', error)
  process.exitCode = 1
})
