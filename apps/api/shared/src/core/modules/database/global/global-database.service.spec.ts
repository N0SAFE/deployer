import { describe, it, expect } from 'vitest'

import { makeGlobalDatabaseService } from './global-database.service'

describe('GlobalDatabaseService', () => {
    it('is not initialized until a connection is given, and refuses to hand out a database before', () => {
        const service = makeGlobalDatabaseService()

        expect(service.isInitialized).toBe(false)
        expect(() => service.db).toThrowError(/has not been initialized yet/)

        const db = {} as never
        service.init(db)
        expect(service.isInitialized).toBe(true)
        expect(service.db).toBe(db)
    })
})
