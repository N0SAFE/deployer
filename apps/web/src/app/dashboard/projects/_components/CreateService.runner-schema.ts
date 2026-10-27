import z from 'zod/v4'

/* ─── RUNNER / BUILD CONFIG SCHEMAS ──────────────────────────────── */

/**
 * BUILD METHOD — how the container image is produced from the source.
 * Orthogonal to the runner type (how the service runs). Lives at the
 * top of the runner payload so any runner can build from any method.
 */
export const buildMethodSchema = z.object({
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
export const orchestratorSubServiceSchema = z.object({
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
    /** Ingress visibility: `private` = local + private mesh lanes only;
     * `public` = also on the public lane when one is enabled. */
    visibility: z.enum(['private', 'public']).default('public'),
    /** TLS termination config (public lane). */
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

export const runnerSchema = z.discriminatedUnion('runnerId', [
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
