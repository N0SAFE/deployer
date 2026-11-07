import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import {
    defaultIngressLanes,
    type IngressLanes,
} from '@deployer/contracts-entities/entities/ingress/index'
import { provideTo } from '@deployer/effect-core'

import { ClusterSettings } from '../../mesh-node/cluster-settings'

import {
    INGRESS_LANES_SETTING,
    IngressLanesService,
} from './ingress-lanes.service'

import type { ClusterSettingsShape } from '../../mesh-node/cluster-settings'

const settings = (stored: IngressLanes | undefined) =>
    ({
        read: vi.fn((_key: string, _schema: unknown, fallback: IngressLanes) =>
            Effect.succeed(stored ?? fallback)
        ),
        write: vi.fn(() => Effect.void),
    }) as unknown as ClusterSettingsShape

/** The service over a fake cluster store: only the tag its operations yield is provided. */
const serviceOver = (store: ClusterSettingsShape, entryPort = 8080) =>
    provideTo(new IngressLanesService.live(entryPort), (effect) =>
        effect.pipe(Effect.provideService(ClusterSettings, store))
    )

describe('IngressLanesService', () => {
    it('reads local-only on the configured entry port when nothing is stored (never fails open)', async () => {
        expect(
            await Effect.runPromise(serviceOver(settings(undefined)).getLanes())
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
            await Effect.runPromise(serviceOver(settings(stored)).getLanes())
        ).toEqual(stored)
    })

    it('writes the lanes under the replicated key', async () => {
        const store = settings(undefined)
        const lanes = defaultIngressLanes(80)
        await Effect.runPromise(serviceOver(store).setLanes(lanes))
        expect(store.write).toHaveBeenCalledWith(INGRESS_LANES_SETTING, lanes)
    })
})
