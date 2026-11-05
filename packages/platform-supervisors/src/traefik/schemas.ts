import z from 'zod/v4'

import {
    baseSupervisorPayloadSchema,
    baseSupervisorProcessInfoSchema,
    swarmProcessInfoSchema,
} from '@deployer/supervision'

export const PLATFORM_INGRESS_SUPERVISOR_ID = 'platform-ingress-traefik'
export const PLATFORM_INGRESS_ROLE = 'ingress'

/** Where the ACME account and issued certificates are persisted (ACME edges only). */
export const TRAEFIK_ACME_STORAGE_MOUNT = '/acme'
export const TRAEFIK_ACME_STORAGE_PATH = `${TRAEFIK_ACME_STORAGE_MOUNT}/acme.json`
/**
 * Named volume holding the ACME state, per node. ACME state is a CACHE, not a source of truth: two nodes
 * each obtaining their own certificate for a hostname is wasteful but correct, whereas a missing file
 * re-orders on every restart, which Let's Encrypt rate-limits.
 */
export const TRAEFIK_ACME_VOLUME = 'deployer-traefik-acme'

export const traefikSupervisorPayloadSchema =
    baseSupervisorPayloadSchema.extend({
        /** Live view of the ingress swarm service (null when absent). */
        service: swarmProcessInfoSchema.shape.live.nullable(),
        entrypoint: z
            .object({
                host: z.string(),
                port: z.number().int().min(1),
                reachable: z.boolean(),
                statusCode: z.number().int().nullable(),
                latencyMs: z.number().int().min(0).nullable(),
            })
            .nullable(),
        config: z.object({
            apiHostname: z.string(),
            /** Where the ingress polls its routes. */
            providerEndpoint: z.string(),
            /** Lanes the ingress serves right now. */
            lanes: z.array(z.string()),
        }),
    })
export type TraefikSupervisorPayload = z.output<
    typeof traefikSupervisorPayloadSchema
>

export const traefikProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
    process: swarmProcessInfoSchema,
    entry: z.object({
        /** Host port every node door binds (local and private lanes). */
        port: z.number().int().min(1),
        /** True when the port is the default 80. */
        isDefault80: z.boolean(),
    }),
    urls: z.object({
        /** The console on THIS machine (local lane). */
        entryUrl: z.string().nullable(),
        apiUrl: z.string(),
        webUrl: z.string(),
    }),
    config: z.object({
        providerEndpoint: z.string(),
        lanes: z.array(z.string()),
    }),
})
export type TraefikProcessInfo = z.output<typeof traefikProcessInfoSchema>
