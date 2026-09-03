'use client'

/* ===================================================================
 * CreateService.hook — Zod schemas + TanStack Form hook for the
 * service creation wizard.
 *
 * ALL fields use discriminated unions — no loose optional-objects
 * where fields depend on sibling discriminator fields.
 *
 * Key architecture:
 *   provider schema  → discriminated on providerId
 *   runner schema    → discriminated on runnerId (build/runner params)
 *   health schema    → discriminated on type
 *
 * rootPath / buildContext / dockerfilePath live under the RUNNER,
 * NOT the provider — they describe how to build, not where to pull.
 * =================================================================== */

import { useForm } from '@tanstack/react-form'
import { z } from 'zod/v4'

/* ─── PROVIDER CONFIG SCHEMAS (per-provider-type shapes) ─────────── */

/** GitHub-specific: select an App, then a repo auto-fills URL + branch. */
const githubConfigSchema = z.object({
    providerAppId: z.string().min(1, 'Select a GitHub App'),
    sourceUrl: z.string().min(1, 'Repository URL is required'),
    branch: z.string().min(1, 'Branch is required'),
    image: z.string().optional(),
    autoSyncEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    authSecretRef: z.string().min(1),
}).strict()

/** GitLab / Bitbucket: manual URL + branch (no dynamic app picker yet). */
const manualGitConfigSchema = z.object({
    sourceUrl: z.string().min(1, 'Repository URL is required'),
    branch: z.string().min(1, 'Branch is required'),
    image: z.string().optional(),
    autoSyncEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    authSecretRef: z.string().min(1),
}).strict()

/** Container registry: image reference only. */
const containerRegistryConfigSchema = z.object({
    sourceUrl: z.string().min(1, 'Image URL is required'),
    image: z.string().optional(),
    authSecretRef: z.string().min(1),
}).strict()

/** Artifact bundle: a download URL. */
const artifactBundleConfigSchema = z.object({
    sourceUrl: z.string().min(1, 'Bundle URL is required'),
    authSecretRef: z.string().min(1),
}).strict()

/** Manual: free-form source. */
const manualConfigSchema = z.object({
    sourceUrl: z.string().min(1, 'Source URL is required'),
    image: z.string().optional(),
    autoSyncEnabled: z.boolean(),
    authSecretRef: z.string().min(1),
}).strict()

/* ─── PROVIDER DISCRIMINATED UNION ───────────────────────────────── */

const providerSchema = z.discriminatedUnion('providerId', [
    z.object({ providerId: z.literal('github'), config: githubConfigSchema }),
    z.object({ providerId: z.literal('gitlab'), config: manualGitConfigSchema }),
    z.object({ providerId: z.literal('bitbucket'), config: manualGitConfigSchema }),
    z.object({ providerId: z.literal('container-registry'), config: containerRegistryConfigSchema }),
    z.object({ providerId: z.literal('artifact-bundle'), config: artifactBundleConfigSchema }),
    z.object({ providerId: z.literal('manual'), config: manualConfigSchema }),
])

/* ─── RUNNER / BUILD CONFIG SCHEMAS ──────────────────────────────── */

/**
 * BUILD METHOD — how the container image is produced from the source.
 * Orthogonal to the runner type (how the service runs). Lives at the
 * top of the runner payload so any runner can build from any method.
 */
const buildMethodSchema = z.object({
    method: z.enum(['auto', 'dockerfile', 'nixpacks', 'buildpack', 'railpack', 'external']),
    rootPath: z.string().optional(),
    buildContext: z.string().optional(),
    dockerfilePath: z.string().optional(),
    composeFile: z.string().optional(),
    buildCommand: z.string().optional(),
    runCommand: z.string().optional(),
}).strict()

/** Execution-level fields shared by every runner config. */
const sharedRunnerConfig = {
    strategy: z.enum(['rolling', 'recreate', 'blue-green', 'canary']),
    startCommand: z.string().optional(),
    args: z.array(z.string()).default([]),
    ports: z.array(z.number().int().positive()).default([]),
    volumeMounts: z.array(z.string()).default([]),
    secretRefs: z.array(z.string()).default([]),
    networkMode: z.enum(['bridge', 'host', 'overlay']),
    gracefulShutdownSeconds: z.number().int().min(0),
} as const

/**
 * RUNNER — how the built image / service is deployed. Each runner kind
 * carries ONLY the fields it actually consumes (no random shared fields):
 *  - manual:         single container, manual start command (docker run)
 *  - orchestrator:   multi-service manifest (compose) — contains the
 *                    sub-services detected inside the manifest
 *  - kubernetes:     namespace / deployment / replicas / service account
 *  - nomad:          job name / datacenter / namespace
 *  - worker-runtime: queue / concurrency / retries
 *  - static:         output dir / index file (recreate strategy only)
 */

/**
 * A sub-service detected inside an orchestrator (compose) manifest.
 * Mirrors the main service's complexity: build, runtime, networking,
 * storage, dependencies, scaling, health, resources and restart policy.
 *
 * HIERARCHY RULE: when sub-services exist, the orchestrator (main service)
 * is a pure manifest shell — networking/ports/domains belong HERE, on each
 * sub-service. The orchestrator's own env (`runner.config.environment`)
 * cascades into every sub-service; a sub-service env key overrides it.
 */
const orchestratorSubServiceSchema = z.object({
    /** Service name from the compose file. */
    name: z.string().min(1, 'Service name is required'),
    /** Container image reference (prebuilt or produced by the build block). */
    image: z.string().min(1, 'Image is required'),

    /* ── Build (compose `build:` block) ── */
    build: z.object({
        context: z.string().optional(),
        dockerfile: z.string().optional(),
        args: z.record(z.string(), z.string()).default({}),
    }).optional(),

    /* ── Runtime ── */
    /** Override CMD. */
    command: z.string().optional(),
    /** Override ENTRYPOINT. */
    entrypoint: z.string().optional(),

    /* ── Networking (per sub-service — the orchestrator delegates here) ── */
    /** Primary container port (ingress + health default). */
    port: z.number().int().positive().optional(),
    ports: z.array(z.number().int().positive()).default([]),
    /** Extra container → host port forwards. */
    portMappings: z.array(z.object({
        containerPort: z.number().int().positive(),
        hostPort: z.number().int().positive().optional(),
        protocol: z.enum(['tcp', 'udp']),
        name: z.string().optional(),
    })).default([]),
    /** Expose this sub-service to the internet via the ingress (Traefik). */
    expose: z.boolean().default(false),
    /** TLS termination config (when exposed). */
    tls: z.object({
        enabled: z.boolean().default(false),
        certSecretRef: z.string().optional(),
        httpRedirect: z.boolean().default(true),
    }).default({ enabled: false, httpRedirect: true }),
    networks: z.array(z.string()).default([]),
    /** This sub-service's own custom domains (registered project domains). */
    customDomains: z.array(z.string()).default([]),

    /* ── Config / storage ── */
    /** Sub-service env — OVERRIDES the orchestrator's cascaded env per key. */
    environment: z.record(z.string(), z.string()).default({}),
    volumes: z.array(z.string()).default([]),
    labels: z.record(z.string(), z.string()).default({}),
    secrets: z.array(z.string()).default([]),

    /* ── Dependencies ── */
    dependsOn: z.array(z.string()).default([]),
    dependsOnCondition: z.enum(['service_started', 'service_healthy', 'service_completed_successfully']).default('service_started'),

    /* ── Scaling ── */
    replicas: z.number().int().positive().default(1),

    /* ── Health check (compose `healthcheck:`) ── */
    healthCheck: z.object({
        test: z.array(z.string()).default(['CMD-SHELL', 'exit 0']),
        interval: z.number().positive().optional(),
        timeout: z.number().positive().optional(),
        retries: z.number().int().min(0).optional(),
        startPeriod: z.number().positive().optional(),
    }).optional(),

    /* ── Resources (compose `deploy.resources:`) ── */
    resources: z.object({
        cpus: z.number().positive().optional(),
        memory: z.string().optional(),
    }).optional(),

    /* ── Restart policy ── */
    restart: z.enum(['no', 'always', 'on-failure', 'unless-stopped']).default('no'),
})

const runnerSchema = z.discriminatedUnion('runnerId', [
    // ── manual (docker run) ──
    z.object({
        runnerId: z.literal('manual'),
        build: buildMethodSchema,
        config: z.object({
            ...sharedRunnerConfig,
            startCommand: z.string().min(1, 'Start command is required'),
        }).strict(),
    }),
    // ── orchestrator (compose-based multi-service) ──
    z.object({
        runnerId: z.literal('orchestrator'),
        build: buildMethodSchema,
        config: z.object({
            composeFile: z.string().min(1, 'Compose file is required'),
            composeProjectName: z.string().optional(),
            profiles: z.array(z.string()).default([]),
            subServices: z.array(orchestratorSubServiceSchema).default([]),
            /** MAIN env — cascades to every sub-service; sub-service env wins per key. */
            environment: z.record(z.string(), z.string()).default({}),
            strategy: z.enum(['rolling', 'recreate', 'blue-green', 'canary']),
            networkMode: z.enum(['bridge', 'host', 'overlay']),
            gracefulShutdownSeconds: z.number().int().min(0),
            /** Self-deploy scope — what a push to this repo deploys. */
            autoDeploySubtree: z.enum(['whole-stack', 'changed-only']).default('whole-stack'),
            /** Preview scope — what a PR preview of this orchestrator includes. */
            previewScope: z.enum(['whole-stack', 'changed-only']).default('whole-stack'),
        }).strict(),
    }),
    // ── compose stack (ONE service managing a compose stack as a unit) ──
    z.object({
        runnerId: z.literal('compose'),
        build: buildMethodSchema,
        config: z.object({
            /** Compose project name (docker compose -p). */
            appName: z.string().min(1, 'Compose project name is required'),
            /** Path to the compose file inside the repository. */
            composeFile: z.string().min(1, 'Compose file is required'),
            /** Compose profiles activated on deploy. */
            profiles: z.array(z.string()).default([]),
            /** Environment overrides passed to the whole stack. */
            environment: z.record(z.string(), z.string()).default({}),
            /** Read-only declared services (from the compose file). */
            declaredServices: z.array(z.object({
                name: z.string(),
                image: z.string().optional(),
                ports: z.array(z.string()).default([]),
            })).default([]),
            strategy: z.enum(['rolling', 'recreate', 'blue-green', 'canary']),
            networkMode: z.enum(['bridge', 'host', 'overlay']),
            gracefulShutdownSeconds: z.number().int().min(0),
        }).strict(),
    }),
    // ── kubernetes ──
    z.object({
        runnerId: z.literal('kubernetes'),
        build: buildMethodSchema,
        config: z.object({
            ...sharedRunnerConfig,
            namespace: z.string().min(1, 'Namespace is required'),
            deploymentName: z.string().min(1, 'Deployment name is required'),
            replicas: z.number().int().positive(),
            serviceAccountName: z.string().optional(),
        }).strict(),
    }),
    // ── nomad ──
    z.object({
        runnerId: z.literal('nomad'),
        build: buildMethodSchema,
        config: z.object({
            ...sharedRunnerConfig,
            jobName: z.string().min(1, 'Job name is required'),
            datacenter: z.string().min(1, 'Datacenter is required'),
            nomadNamespace: z.string().optional(),
        }).strict(),
    }),
    // ── worker-runtime ──
    z.object({
        runnerId: z.literal('worker-runtime'),
        build: buildMethodSchema,
        config: z.object({
            ...sharedRunnerConfig,
            queueName: z.string().min(1, 'Queue name is required'),
            concurrency: z.number().int().positive(),
            maxRetries: z.number().int().min(0),
        }).strict(),
    }),
    // ── static ──
    z.object({
        runnerId: z.literal('static'),
        build: buildMethodSchema,
        config: z.object({
            strategy: z.literal('recreate'),
            startCommand: z.string().optional(),
            args: z.array(z.string()).default([]),
            ports: z.array(z.number().int().positive()).default([]),
            volumeMounts: z.array(z.string()).default([]),
            secretRefs: z.array(z.string()).default([]),
            networkMode: z.enum(['bridge', 'host', 'overlay']),
            gracefulShutdownSeconds: z.number().int().min(0),
            outputDir: z.string().min(1, 'Output directory is required'),
            indexFile: z.string().min(1, 'Index file is required'),
            errorPage: z.string().optional(),
        }).strict(),
    }),
    // ── mock (spec-driven replacement of a contract — DI-style swap) ──
    z.object({
        runnerId: z.literal('mock'),
        build: buildMethodSchema,
        config: z.object({
            /** The contract this mock implements (must match the replaced service). */
            implements: z.object({
                contractRef: z.string().min(1, 'Contract ref is required'),
                compatibility: z.enum(['http', 'grpc', 'events']).default('http'),
            }),
            /** Mock engine — how responses are generated. */
            engine: z.enum(['prism', 'wiremock', 'json-server']),
            /** Engine-specific source. */
            source: z.discriminatedUnion('kind', [
                z.object({ kind: z.literal('openapi'), specPath: z.string().min(1) }),
                z.object({ kind: z.literal('stub-dir'), mappingsDir: z.string().min(1) }),
                z.object({ kind: z.literal('db-file'), dbPath: z.string().min(1) }),
                z.object({ kind: z.literal('recorded'), targetUrl: z.string().min(1) }),
            ]),
            /** Response behavior tuning. */
            behavior: z.object({
                latencyMs: z.number().int().nonnegative().default(0),
                failRatePercent: z.number().min(0).max(100).default(0),
            }).default({ latencyMs: 0, failRatePercent: 0 }),
            /** Only present in preview, never prod. */
            previewOnly: z.boolean().default(true),
        }).strict(),
    }),
])

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

const wizardSchema = z.object({
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
        /** Extra port forwards: container → host (host omitted = auto). */
        portMappings: z.array(z.object({
            containerPort: z.number().int().positive(),
            hostPort: z.number().int().positive().optional(),
            protocol: z.enum(['tcp', 'udp']),
            name: z.string().optional(),
        })).default([]),
        /** Expose to the internet via the ingress (Traefik). */
        expose: z.boolean().default(false),
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

type WizardFormData = z.input<typeof wizardSchema>

/* ─── DEFAULT VALUES ──────────────────────────────────────────────── */

const defaultWizardValues: WizardFormData = {
    basicInfo: {
        name: '',
        description: undefined,
        tags: undefined,
    },
    provider: {
        providerId: 'github',
        config: {
            providerAppId: '',
            sourceUrl: '',
            branch: 'main',
            autoSyncEnabled: true,
            webhookEnabled: false,
            authSecretRef: 'default',
        },
    },
    runner: {
        runnerId: 'manual',
        build: {
            method: 'auto',
            rootPath: '/',
            buildContext: '.',
            dockerfilePath: 'Dockerfile',
            composeFile: 'docker-compose.yml',
            buildCommand: '',
            runCommand: '',
        },
        config: {
            strategy: 'rolling',
            startCommand: 'npm start',
            args: [],
            ports: [],
            volumeMounts: [],
            secretRefs: [],
            networkMode: 'bridge',
            gracefulShutdownSeconds: 30,
        },
    },
    network: {
        port: undefined,
        portMappings: [],
        expose: false,
        tls: { enabled: false, httpRedirect: true },
        healthCheck: {
            type: 'http',
            path: '/health',
            method: 'GET',
            expectedStatus: 200,
            headers: {},
            interval: 30,
            timeout: 10,
            retries: 3,
            startPeriod: 0,
            successThreshold: 1,
            failureThreshold: 3,
        },
        customDomains: undefined,
        domainEntries: undefined,
    },
    advanced: { environmentVariables: undefined, resourceLimits: undefined },
}

/* ─── HOOK ────────────────────────────────────────────────────────── */

export function useCreateServiceForm(onConfirm: (data: WizardFormData) => Promise<void>) {
    const form = useForm({
        defaultValues: defaultWizardValues,
        onSubmit: async ({ value }) => {
            const parsed = wizardSchema.safeParse(value)
            if (!parsed.success) return
            await onConfirm(parsed.data)
        },
    })
    return form
}

export type CreateServiceFormApi = ReturnType<typeof useCreateServiceForm>

export type { WizardFormData }

export type ProviderFormData = z.infer<typeof providerSchema>
export type RunnerFormData = z.infer<typeof runnerSchema>
export type OrchestratorSubService = z.infer<typeof orchestratorSubServiceSchema>

export {
    wizardSchema,
    providerSchema,
    runnerSchema,
    buildMethodSchema,
    orchestratorSubServiceSchema,
    healthCheckSchema,
    resourceLimitsSchema,
    githubConfigSchema,
    manualGitConfigSchema,
    containerRegistryConfigSchema,
    defaultWizardValues,
    envVarSchema,
    domainEntrySchema,
}
