import { describe, expect, it } from 'vitest'

import { replicaRecord } from '../testing/mesh.fixtures'

import { createDirectoryStore } from './directory.repository'

describe('directory store', () => {
    it('ignores a stale generation and keeps the newer record', () => {
        const store = createDirectoryStore()
        store.upsert(replicaRecord({ generation: 3, keys: ['stream-1'] }))

        const changed = store.upsert(replicaRecord({ generation: 2, keys: [] }))

        expect(changed).toBe(false)
        expect(store.get('project-1', 1_000)?.keys).toEqual(['stream-1'])
    })

    it('extends the lease on an equal generation and reports a change only when it does', () => {
        const store = createDirectoryStore()
        store.upsert(replicaRecord())

        const extended = store.upsert(replicaRecord({ expiresAt: 20_000 }))
        const repeated = store.upsert(replicaRecord({ expiresAt: 20_000 }))

        expect([extended, repeated]).toEqual([true, false])
    })

    it('drops expired records from a snapshot', () => {
        const store = createDirectoryStore()
        store.upsert(replicaRecord({ expiresAt: 2_000 }))

        expect(store.snapshot(1_999)).toHaveLength(1)
        expect(store.snapshot(2_000)).toHaveLength(0)
    })

    it('removes a record and says whether it existed', () => {
        const store = createDirectoryStore()
        store.upsert(replicaRecord())

        expect([store.remove('project-1'), store.remove('project-1')]).toEqual([
            true,
            false,
        ])
    })
})
