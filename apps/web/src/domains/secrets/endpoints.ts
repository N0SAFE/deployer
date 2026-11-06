import { orpc } from '@/lib/orpc'

/**
 * Secrets domain endpoints.
 *
 * The inventory is the fleet service's `secrets.inventory`: which node holds which secret, by fingerprint and generation, and
 * which nodes are behind. It never carries a value. `rotate` and `retire` are the two operator acts on the platform secret.
 */
export const secretsEndpoints = {
    inventory: orpc.secrets.inventory,
    rotate: orpc.secrets.rotate,
    retire: orpc.secrets.retire,
} as const
