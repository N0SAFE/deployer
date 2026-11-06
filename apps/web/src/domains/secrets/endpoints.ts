import { orpc } from '@/lib/orpc'

/**
 * Secrets domain endpoints.
 *
 * The inventory is the fleet service's `secrets.inventory`: which node holds which secret, by fingerprint, and which nodes
 * are behind. It never carries a value.
 */
export const secretsEndpoints = {
    inventory: orpc.secrets.inventory,
} as const
