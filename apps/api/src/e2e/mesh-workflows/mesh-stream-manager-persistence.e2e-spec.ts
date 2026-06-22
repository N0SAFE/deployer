import { describe, it, expect } from 'vitest'
import { MeshConnectionRegistry } from '@/core/modules/mesh/connection/mesh-connection-registry'
import { generateConsumerId } from '@/core/modules/mesh/filter/mesh-filter.types'

describe('mesh stream manager / connection registry persistence (e2e)', () => {
  it('reuses lookup to find existing connection and closes when last consumer detaches', async () => {
    const registry = new MeshConnectionRegistry()

    const consumerA = generateConsumerId()
    const consumerB = generateConsumerId()

    const filter = { op: 'eq', field: 'projectId', value: 'p1' } as any

    const conn = await registry.open('node-x', 'deployments', 'list', consumerA, filter)
    expect(conn).toBeDefined()

    // lookup should find it
    const found = registry.lookup('node-x', 'deployments', 'list')
    expect(found).not.toBeNull()
    expect(found?.id).toBe(conn.id)

    // attach second consumer
    await registry.attach(conn.id, consumerB, filter)
    const openNow = registry.listOpen()
    expect(openNow.some((c) => c.id === conn.id)).toBe(true)

    // release both
    registry.release(conn.id, consumerA)
    // still open because consumerB attached
    expect(registry.listOpen().some((c) => c.id === conn.id)).toBe(true)

    registry.release(conn.id, consumerB)

    // allow connection close to propagate
    await new Promise((r) => setTimeout(r, 20))

    expect(registry.listOpen().some((c) => c.id === conn.id)).toBe(false)
  })
})
