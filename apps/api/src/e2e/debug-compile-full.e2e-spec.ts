import { describe, it, expect } from 'vitest'
import { Test } from '@nestjs/testing'
import { getMockEnv } from '@repo/env/mock'
import { InitializationService } from '@/core/modules/setup/services/initialization.service'

describe('debug appmodule compile', () => {
  it('compiles AppModule with dummy env', async () => {
    const patch = {
      ...getMockEnv('api'),
      NODE_ENV: 'test',
      SETUP_DATABASE_URL: 'postgres://deployer:deployer@127.0.0.1:1/deployer_e2e',
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

    const { AppModule } = await import('@/app.module')

    // The GlobalModule's GLOBAL_DATABASE_POOL factory calls
    // InitializationService.waitForSetup() which blocks until setup completes.
    // Since this is just a compilation smoke test, mock InitializationService
    // so waitForSetup() resolves immediately.
    const mockInitializationService = {
      waitForSetup: () => Promise.resolve({
        nodeId: 'mock-node',
        connectedAt: new Date(),
        databaseUrl: patch.SETUP_DATABASE_URL,
        strategy: 'local' as const,
      }),
      getSetupState: () => ({ state: 'completed', needsSetup: false, strategy: 'local', currentStep: null, progressPercent: 100, steps: [], completedAt: new Date(), hasUsers: false, availableStrategies: ['local'] }),
      getStateMachine: () => ({ initialState: 'not_started', terminalStates: ['completed'], states: [], transitions: [] }),
      getNodeStatus: () => ({ isConfigured: true, nodeId: 'mock-node', strategy: 'local', meshUrlsSnapshot: [], configuredAt: new Date() }),
      initialize: () => ({ subscribe: () => {} }),
      onModuleInit: () => Promise.resolve(),
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(InitializationService)
      .useValue(mockInitializationService)
      .compile()

    await moduleRef.close()

    // Restore what this test found — but never to "unset".
    //
    // `vitest.setup.ts` fills these keys with `??`, so it only supplies a value
    // while the key is UNSET. DELETE-ing a key here therefore does not restore
    // the setup file's value; it hands the next file in this worker the SCHEMA
    // DEFAULT instead. For `NODE_LOCAL_DB_PATH` that default is
    // `/app/data/local.db` — the path INSIDE the container — so the local-SQLite
    // factory then died with `EACCES: permission denied, mkdir '/app/data'` in
    // whatever file happened to run next.
    //
    // That is why the failure moved between runs and never reproduced in
    // isolation: it was never about the file that failed, only about which file
    // ran after this one.
    for (const [key, value] of previous.entries()) {
      if (value !== undefined) {
        process.env[key] = value
      }
    }
  }, 300_000)
})
