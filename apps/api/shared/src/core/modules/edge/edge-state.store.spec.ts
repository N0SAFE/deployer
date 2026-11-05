import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import z from 'zod/v4'

import { edgeStateKey, makeEdgeStateStore } from './edge-state.store'
import { EdgeStateFailure } from './edge.errors'

const schema = z.object({ tunnelId: z.string() })

function store(overrides: Record<string, unknown> = {}) {
    const settings = {
        read: vi.fn((_key: string, _schema: unknown, fallback: unknown) =>
            Effect.succeed(fallback)
        ),
        write: vi.fn((_key: string, _value: unknown) => Effect.void),
        ...overrides,
    }
    return { settings, store: makeEdgeStateStore(settings as never) }
}

describe('EdgeStateStore', () => {
    it('keeps one cluster setting per provider', () => {
        expect(edgeStateKey('cloudflare-tunnel')).toBe('edge.cloudflare-tunnel')
    })

    it('reads null when the provider has no state', async () => {
        const t = store()
        expect(await Effect.runPromise(t.store.read('p', schema))).toBeNull()
        expect(t.settings.read).toHaveBeenCalledWith(
            'edge.p',
            expect.anything(),
            null
        )
    })

    it('validates before writing, and clears with null so the removal replicates', async () => {
        const t = store()
        await Effect.runPromise(t.store.write('p', schema, { tunnelId: 't1' }))
        expect(t.settings.write).toHaveBeenCalledWith('edge.p', {
            tunnelId: 't1',
        })
        await Effect.runPromise(t.store.clear('p'))
        expect(t.settings.write).toHaveBeenLastCalledWith('edge.p', null)
    })

    it('fails with EdgeStateFailure for an invalid value (nothing is written) and for a cluster that refuses the write', async () => {
        const t = store()
        expect(
            await Effect.runPromise(
                Effect.flip(
                    t.store.write('p', schema, { tunnelId: 1 } as never)
                )
            )
        ).toBeInstanceOf(EdgeStateFailure)
        expect(t.settings.write).not.toHaveBeenCalled()
        const down = store({
            write: () => Effect.fail(new Error('no cluster')),
        })
        expect(
            await Effect.runPromise(Effect.flip(down.store.clear('p')))
        ).toBeInstanceOf(EdgeStateFailure)
    })
})
