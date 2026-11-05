import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
    defaultIngressLanes,
    type IngressLanes,
} from '@deployer/contracts-entities/entities/ingress/index'

import {
    INGRESS_LANES_SETTING,
    makeIngressLanesService,
} from './ingress-lanes.service'

import type { ClusterSettingsShape } from '../../mesh-node/cluster-settings'

const entryPort = () => 8080

function settings(stored: IngressLanes | undefined) {
    return {
        read: vi.fn((_key: string, _schema: unknown, fallback: IngressLanes) =>
            Effect.succeed(stored ?? fallback)
        ),
        write: vi.fn(() => Effect.void),
    } as unknown as ClusterSettingsShape
}

describe('IngressLanesService', () => {
    it('reads local-only on the configured entry port when nothing is stored (never fails open)', async () => {
        expect(
            await Effect.runPromise(
                makeIngressLanesService({
                    settings: settings(undefined),
                    entryPort,
                }).getLanes()
            )
        ).toEqual(defaultIngressLanes(8080))
    })

    it('reads the replicated lanes when they exist', async () => {
        const stored = {
            ...defaultIngressLanes(80),
            private: {
                enabled: true,
                domain: 'corp.internal',
                exposeOnLan: false,
            },
        }
        expect(
            await Effect.runPromise(
                makeIngressLanesService({
                    settings: settings(stored),
                    entryPort,
                }).getLanes()
            )
        ).toEqual(stored)
    })

    it('writes the lanes under the replicated key', async () => {
        const store = settings(undefined)
        const lanes = defaultIngressLanes(80)
        await Effect.runPromise(
            makeIngressLanesService({ settings: store, entryPort }).setLanes(
                lanes
            )
        )
        expect(store.write).toHaveBeenCalledWith(INGRESS_LANES_SETTING, lanes)
    })
})
