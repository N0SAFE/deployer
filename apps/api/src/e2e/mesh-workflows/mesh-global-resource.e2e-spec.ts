import { describe, it, expect } from 'vitest'
import { MeshSubscriptionManager } from '@/core/modules/mesh/services/system-mesh-resource-discovery/subscription/mesh-subscription-manager'

describe('mesh global resource integration (e2e)', () => {
  it('registers a global resource and notifies subscribers on create/update/delete', async () => {
    const mgr = new MeshSubscriptionManager()

    type Item = { id: string; value: number }

    const notifier = mgr.registerGlobalResource<Item>('test:global', (null as any))

    const events: string[] = []

    const h1 = mgr.subscribe<Item>('test:global', async (evt) => {
      events.push(`h1:${evt.type}:${evt.item.id}`)
    })

    const h2 = mgr.subscribe<Item>('test:global', async (evt) => {
      events.push(`h2:${evt.type}:${evt.item.id}`)
    })

    await notifier.notifyCreated({ id: 'a', value: 1 }, 'node-a')
    await notifier.notifyUpdated({ id: 'a', value: 2 }, { id: 'a', value: 1 }, 'node-a')
    await notifier.notifyDeleted({ id: 'a', value: 2 }, 'node-a')

    // Allow async handlers to run
    await new Promise((r) => setTimeout(r, 10))

    expect(events).toContain('h1:created:a')
    expect(events).toContain('h2:created:a')
    expect(events).toContain('h1:updated:a')
    expect(events).toContain('h1:deleted:a')

    // unsubscribe and ensure no further events
    h1.unsubscribe()
    h2.unsubscribe()

    events.length = 0
    await notifier.notifyCreated({ id: 'b', value: 5 }, 'node-a')
    await new Promise((r) => setTimeout(r, 10))
    expect(events).toHaveLength(0)
  })
})
