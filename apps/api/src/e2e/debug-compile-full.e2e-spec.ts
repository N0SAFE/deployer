import { describe, it, expect } from 'vitest'
import { Test } from '@nestjs/testing'
import { getMockEnv } from '@repo/env/mock'

describe('debug appmodule compile', () => {
  it('compiles AppModule with dummy env', async () => {
    const patch = {
      ...getMockEnv('api'),
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
    } as const

    const previous = new Map<string, string | undefined>()
    for (const [key, value] of Object.entries(patch)) {
      previous.set(key, process.env[key])
      process.env[key] = value
    }

    try {
      const { AppModule } = await import('@/app.module')

      const compilePromise = Test.createTestingModule({
        imports: [AppModule],
      }).compile()

      const moduleRef = await Promise.race([
        compilePromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('compile timeout 15000ms')), 15000)
        }),
      ])

      await moduleRef.close()
      expect(true).toBe(true)
    } catch {
      expect(true).toBe(false)
    } finally {
      for (const [key, value] of previous.entries()) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })
})
