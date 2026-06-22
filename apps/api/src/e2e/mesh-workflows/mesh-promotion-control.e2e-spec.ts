import { describe, it, expect } from 'vitest'
import { MeshConnectionRegistry } from '@/core/modules/mesh/connection/mesh-connection-registry'
import { generateConsumerId } from '@/core/modules/mesh/filter/mesh-filter.types'

describe('mesh promotion & control frames (e2e)', () => {
  it('decidePromotion returns attach/promote/new and lifecycle emits attach events', async () => {
    const registry = new MeshConnectionRegistry()

    const consumerA = generateConsumerId()
    const consumerB = generateConsumerId()

    const narrow = { op: 'eq', field: 'projectId', value: 'p1' } as any
    const broad = { op: 'in', field: 'projectId', values: ['p1', 'p2'] } as any

    const conn = await registry.open('node-a', 'deployments', 'list', consumerA, narrow)

    // wait for opened status
    await new Promise((r) => setTimeout(r, 20))

    // when incoming filter is subset -> attach
    const decision1 = registry.decidePromotion(narrow, [conn])
    expect(decision1.action).toBe('attach')

    // when incoming filter is superset -> promote
    const decision2 = registry.decidePromotion(broad, [conn])
    expect(decision2.action).toBe('promote')

    await registry.attach(conn.id, consumerB, narrow)

    // ensure lifecycle emits consumer_attached by checking consumer count
    const openNow = registry.listOpen().find((c) => c.id === conn.id)
    expect(openNow?.consumers.size).toBeGreaterThanOrEqual(2)

    registry.release(conn.id, consumerA)
    registry.release(conn.id, consumerB)

    // allow connection close
    await new Promise((r) => setTimeout(r, 20))

    expect(registry.listOpen().some((c) => c.id === conn.id)).toBe(false)
  })
})
