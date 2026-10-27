import z from 'zod/v4'
import { providerSchema } from './CreateService.provider-schema'
import { runnerSchema } from './CreateService.runner-schema'

/* ─── HEALTH CHECK ───────────────────────────────────────────────── */

/** Timing/thresholds shared by every non-none health check variant. */
const healthTimingShape = {
    interval: z.number().int().positive(),
    timeout: z.number().int().positive(),
    retries: z.number().int().min(0),
    /** Delay before the container is considered "started" — grace period. */
    startPeriod: z.number().int().min(0),
    /** Consecutive successes required to mark healthy. */
    successThreshold: z.number().int().positive(),
    /** Consecutive failures required to mark unhealthy. */
    failureThreshold: z.number().int().positive(),
} as const

const healthCheckSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('http'),
        path: z.string().min(1),
        method: z.enum(['GET', 'HEAD', 'POST']),
        expectedStatus: z.number().int().min(100).max(599),
        headers: z.record(z.string(), z.string()).default({}),
        ...healthTimingShape,
    }),
    z.object({
        type: z.literal('tcp'),
        port: z.number().int().positive(),
        ...healthTimingShape,
    }),
    z.object({
        type: z.literal('command'),
        command: z.string().min(1),
        ...healthTimingShape,
    }),
    z.object({ type: z.literal('none') }),
])

/* ─── MISC ────────────────────────────────────────────────────────── */

const envVarSchema = z.object({
    key: z.string().min(1),
    value: z.string(),
})

const domainEntrySchema = z.object({
    projectDomainId: z.string().min(1),
    subdomain: z.string().nullable(),
    basePath: z.string().nullable(),
    isPrimary: z.boolean(),
    sslEnabled: z.boolean(),
})

const resourceLimitsSchema = z.object({
    memory: z.string().optional(),
    cpu: z.string().optional(),
}).optional()

/* ─── FULL WIZARD SCHEMA ──────────────────────────────────────────── */

export const wizardSchema = z.object({
    basicInfo: z.object({
        name: z.string().min(1, 'Service name is required'),
        /** Legacy freeform category — no longer drives anything; the service
         * type is derived from the runner (application / compose / sub-services…). */
        type: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
    }),
    provider: providerSchema,
    runner: runnerSchema,
    network: z.object({
        /** Primary container port (used for ingress/health default). */
        port: z.number().int().positive().optional(),
        /** Ingress visibility: `private` = local + private mesh lanes only;
         * `public` = also on the public lane when one is enabled. */
        visibility: z.enum(['private', 'public']).default('public'),
        /** TLS termination config. */
        tls: z.object({
            enabled: z.boolean().default(false),
            certSecretRef: z.string().optional(),
            httpRedirect: z.boolean().default(true),
        }).default({ enabled: false, httpRedirect: true }),
        healthCheck: healthCheckSchema,
        customDomains: z.array(z.string()).optional(),
        domainEntries: z.array(domainEntrySchema).optional(),
    }),
    advanced: z.object({
        environmentVariables: z.array(envVarSchema).optional(),
        resourceLimits: resourceLimitsSchema,
    }),
})

export type WizardFormData = z.input<typeof wizardSchema>
