import { Global, Module } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { describe, it, expect, beforeEach, vi } from 'vitest'

import { AppLifecycle } from '@deployer/lifecycle'
import { EffectRuntime } from '@deployer/nest-effect'
import { LocalDatabase, NodeConfigRepository } from '@deployer/node-state'

import {
    GLOBAL_DATABASE_CONNECTION,
    LOCAL_DATABASE_CONNECTION,
} from './database-connection'
import { DatabaseModule } from './database.module'
import { GlobalDatabaseService } from './global/global-database.service'

// Mock heavy sub-modules that trigger env validation and real DB connections
vi.mock('./global/global-database.module', async () => {
    // A `vi.mock` factory is hoisted above the imports, so every value it uses is imported inside it.
    const { GLOBAL_DATABASE_CONNECTION } = await import('./database-connection')
    const { GlobalDatabaseService } =
        await import('./global/global-database.service')
    return {
        GlobalDatabaseModule: {
            global: true,
            module: class {},
            providers: [
                { provide: 'GLOBAL_DATABASE_POOL', useValue: {} },
                {
                    provide: GlobalDatabaseService,
                    useValue: { db: { execute: vi.fn() } },
                },
                {
                    provide: GLOBAL_DATABASE_CONNECTION,
                    useValue: { execute: vi.fn() },
                },
            ],
            exports: [
                'GLOBAL_DATABASE_POOL',
                GlobalDatabaseService,
                GLOBAL_DATABASE_CONNECTION,
            ],
        },
    }
})
// The real module opens the SQLite file; a stand-in provides the same tokens without touching disk.
vi.mock('./local/local-database.module', async () => {
    const { LocalDatabase } = await import('@deployer/node-state')
    return {
        LocalDatabaseModule: {
            global: true,
            module: class {},
            providers: [
                { provide: LOCAL_DATABASE_CONNECTION, useValue: {} },
                { provide: LocalDatabase, useValue: {} },
            ],
            exports: [LOCAL_DATABASE_CONNECTION, LocalDatabase],
        },
    }
})
vi.mock('../lifecycle', () => ({
    // `forRoot` MUST be present: `@Global() @Module({})` classes provide NOTHING
    // when imported bare, so `DatabaseModule` imports this module through
    // `forRoot()` — a stub that omits it fails at import time with
    // "AppLifecycleModule.forRoot is not a function" before any assertion runs.
    AppLifecycleModule: {
        forRoot: vi.fn().mockReturnValue({ module: class {}, global: true }),
    },
}))
vi.mock('./services/database-startup-guard.service', () => ({
    DatabaseStartupGuard: class {},
    makeDatabaseStartupGuard: () => ({}),
}))
vi.mock('./services/database-probe.service', () => ({
    DatabaseProbeService: class {},
    makeDatabaseProbeService: () => ({}),
}))
vi.mock('./services/database-failure-tracker.service', () => ({
    DatabaseFailureTracker: class {},
    makeDatabaseFailureTracker: () => ({}),
}))

/** What the real lifecycle module and the node-state module would provide to the factories below. */
@Global()
@Module({
    providers: [
        { provide: AppLifecycle, useValue: {} },
        { provide: NodeConfigRepository, useValue: {} },
        { provide: EffectRuntime, useValue: {} },
    ],
    exports: [AppLifecycle, NodeConfigRepository, EffectRuntime],
})
class CollaboratorsStub {}

describe('DatabaseModule', () => {
    let module: TestingModule

    beforeEach(async () => {
        module = await Test.createTestingModule({
            imports: [CollaboratorsStub, DatabaseModule],
        })
            .overrideProvider(GLOBAL_DATABASE_CONNECTION)
            .useValue({ execute: vi.fn() })
            .overrideProvider('GLOBAL_DATABASE_POOL')
            .useValue({})
            .compile()
    })

    it('should be defined', () => {
        expect(module).toBeDefined()
    })

    it('should provide GlobalDatabaseService', () => {
        expect(module.get(GlobalDatabaseService)).toBeDefined()
    })

    it('should provide the LocalDatabase service', () => {
        expect(module.get(LocalDatabase)).toBeDefined()
    })

    it('should provide GLOBAL_DATABASE_CONNECTION', () => {
        expect(module.get(GLOBAL_DATABASE_CONNECTION)).toBeDefined()
    })

    it('should provide LOCAL_DATABASE_CONNECTION', () => {
        expect(module.get(LOCAL_DATABASE_CONNECTION)).toBeDefined()
    })
})
