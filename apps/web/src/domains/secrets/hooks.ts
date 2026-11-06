'use client'

import { useMutation, useQuery } from '@tanstack/react-query'

import { wrapWithInvalidations } from '@/domains/shared/helpers'

import { secretsEndpoints } from './endpoints'
import { secretsInvalidations } from './invalidations'

const enhancedSecrets = wrapWithInvalidations(
    secretsEndpoints,
    secretsInvalidations
)

/** How often the matrix looks again: adoption changes as nodes pick a rotation up, which is what the page is for. */
const INVENTORY_REFRESH_MS = 15_000

/** Every secret across the fleet and where each node stands against the value most nodes hold. */
export function useSecretInventory(options: { enabled?: boolean } = {}) {
    return useQuery({
        ...secretsEndpoints.inventory.queryOptions({ input: {} }),
        enabled: options.enabled ?? true,
        refetchInterval: INVENTORY_REFRESH_MS,
    })
}

/** How many stored values sit under each key generation: read before retiring one. Counts only. */
export function useStoredSecrets(options: { enabled?: boolean } = {}) {
    return useQuery({
        ...secretsEndpoints.stored.queryOptions({ input: {} }),
        enabled: options.enabled ?? true,
    })
}

/** Makes a new generation of the platform secret current. The earlier one stays accepted until it is retired. */
export function useRotatePlatformSecret() {
    return useMutation(
        secretsEndpoints.rotate.mutationOptions({
            onSuccess: enhancedSecrets.rotate.withInvalidationOnSuccess(),
        })
    )
}

/** Stops accepting an earlier generation on every reachable node. */
export function useRetirePlatformSecret() {
    return useMutation(
        secretsEndpoints.retire.mutationOptions({
            onSuccess: enhancedSecrets.retire.withInvalidationOnSuccess(),
        })
    )
}
