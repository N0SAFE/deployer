import 'reflect-metadata'
import { Test } from '@nestjs/testing'

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args)

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

const timeoutMs = 12000

const nameOf = (imp: unknown): string => {
  if (!imp) return '<null>'
  if (typeof imp === 'function') return (imp as { name?: string }).name ?? '<anonymous fn>'
  if (typeof imp === 'object' && imp !== null && 'module' in imp) {
    const moduleName = (imp as { module?: { name?: string } }).module?.name
    return moduleName ? `${moduleName}(dynamic)` : '<dynamic module>'
  }
  return typeof imp
}

async function tryCompile(imports: unknown[], label: string) {
  const startedAt = Date.now()
  try {
    const compiled = await Promise.race([
      Test.createTestingModule({ imports }).compile(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`timeout after ${String(timeoutMs)}ms`)), timeoutMs)
      }),
    ])
    await (compiled as { close: () => Promise<void> }).close()
    log('OK', label, `${Date.now() - startedAt}ms`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log('FAIL', label, `${Date.now() - startedAt}ms`, message)
  }
}

async function run() {
  const { AppModule } = await import('../src/app.module')
  const allImports = (Reflect.getMetadata('imports', AppModule) as unknown[]) ?? []

  log('imports', allImports.map(nameOf).join(' | '))

  await tryCompile(allImports, 'full')

  for (let i = 0; i < allImports.length; i += 1) {
    const omitted = nameOf(allImports[i])
    const subset = allImports.filter((_, idx) => idx !== i)
    await tryCompile(subset, `without ${omitted}`)
  }

  log('done')
}

run().catch((error) => {
  log('fatal', error)
  process.exitCode = 1
})
