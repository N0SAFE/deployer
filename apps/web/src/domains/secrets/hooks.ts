'use client'

import { useQuery } from '@tanstack/react-query'

import { secretsEndpoints } from './endpoints'

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
