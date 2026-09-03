import z from "zod/v4";
import {
  runnerNetworkModeSchema,
  serviceRunnerStrategySchema,
} from "@repo/contracts-common";
import { mockServiceConfigSchema } from "./mock-config.schema";

/**
 * COMPOSE STACK — one service that manages a docker-compose stack as a
 * SINGLE unit. `docker compose up/down/logs` run against the whole stack;
 * there is no per-service lifecycle control (that's the `sub-services`
 * orchestrator). The service can still reference individual services from
 * the compose file (image/env updates), but it deploys as one unit.
 *
 * Dokploy-style: `appName` is the compose project name; the stack is the
 * unit of deploy/rollback/logs.
 */
export const composeStackRunnerConfigSchema = z
  .object({
    strategy: serviceRunnerStrategySchema,
    networkMode: runnerNetworkModeSchema,
    gracefulShutdownSeconds: z.int().min(0),
    /** Compose project name (docker compose -p). */
    appName: z.string().min(1).optional(),
    /** Path to the compose file inside the repository. */
    composeFile: z.string().min(1).optional(),
    /** Raw compose content when pasted (no repo file). */
    composeContent: z.string().optional(),
    /** Compose profiles activated on deploy. */
    profiles: z.array(z.string()).default([]),
    /** Env file values / environment overrides passed to the stack. */
    environment: z.record(z.string(), z.string()).default({}),
    /** Individual services declared in the compose file (read-only refs). */
    declaredServices: z
      .array(
        z.object({
          name: z.string(),
          image: z.string().optional(),
          ports: z.array(z.string()).default([]),
        }),
      )
      .default([]),
  })
  .strict();

/**
 * Execution-level fields present on EVERY runner config.
 * `startCommand` is optional — some runners (compose/swarm) declare the
 * process command inside their manifest, not in the service config.
 * Per-runner fields are optional in the ENTITY schema so pre-existing
 * stored configs remain valid; the wizard form enforces completeness.
 */
const executionShape = {
  strategy: serviceRunnerStrategySchema,
  startCommand: z.string().optional(),
  args: z.array(z.string()).default([]),
  ports: z.array(z.int().positive()).default([]),
  volumeMounts: z.array(z.string()).default([]),
  secretRefs: z.array(z.string()).default([]),
  networkMode: runnerNetworkModeSchema,
  gracefulShutdownSeconds: z.int().min(0),
} as const;

export const kubernetesRunnerConfigSchema = z
  .object({
    ...executionShape,
    namespace: z.string().min(1).optional(),
    deploymentName: z.string().min(1).optional(),
    replicas: z.int().positive().optional(),
    serviceAccountName: z.string().optional(),
  })
  .strict();

/**
 * Manual container (docker run) — the process command is provided
 * explicitly in `startCommand` (unlike compose/orchestrator where the
 * command lives inside the manifest).
 */
export const manualRunnerConfigSchema = z
  .object({
    ...executionShape,
    startCommand: z.string().min(1).optional(),
  })
  .strict();

/** A sub-service detected inside an orchestrator (compose) manifest. */
export const orchestratorSubServiceSchema = z
  .object({
    name: z.string().min(1),
    image: z.string().min(1),
    build: z
      .object({
        context: z.string().optional(),
        dockerfile: z.string().optional(),
        args: z.record(z.string(), z.string()).default({}),
      })
      .optional(),
    command: z.string().optional(),
    entrypoint: z.string().optional(),
    // Networking (per sub-service — the orchestrator delegates here).
    port: z.int().positive().optional(),
    ports: z.array(z.int().positive()).default([]),
    portMappings: z
      .array(
        z.object({
          containerPort: z.int().positive(),
          hostPort: z.int().positive().optional(),
          protocol: z.enum(["tcp", "udp"]),
          name: z.string().optional(),
        }),
      )
      .default([]),
    expose: z.boolean().default(false),
    tls: z
      .object({
        enabled: z.boolean().default(false),
        certSecretRef: z.string().optional(),
        httpRedirect: z.boolean().default(true),
      })
      .default({ enabled: false, httpRedirect: true }),
    networks: z.array(z.string()).default([]),
    customDomains: z.array(z.string()).default([]),
    environment: z.record(z.string(), z.string()).default({}),
    volumes: z.array(z.string()).default([]),
    labels: z.record(z.string(), z.string()).default({}),
    secrets: z.array(z.string()).default([]),
    dependsOn: z.array(z.string()).default([]),
    dependsOnCondition: z
      .enum(["service_started", "service_healthy", "service_completed_successfully"])
      .default("service_started"),
    replicas: z.int().positive().default(1),
    healthCheck: z
      .object({
        test: z.array(z.string()).default(["CMD-SHELL", "exit 0"]),
        interval: z.number().positive().optional(),
        timeout: z.number().positive().optional(),
        retries: z.int().min(0).optional(),
        startPeriod: z.number().positive().optional(),
      })
      .optional(),
    resources: z
      .object({
        cpus: z.number().positive().optional(),
        memory: z.string().optional(),
      })
      .optional(),
    restart: z.enum(["no", "always", "on-failure", "unless-stopped"]).default("no"),
  })
  .strict();

/**
 * Orchestrator — a multi-service manifest (docker-compose) that owns
 * the sub-services detected inside it. The orchestrator itself has no
 * startCommand; each sub-service declares its own image/runtime.
 *
 * HIERARCHY: the orchestrator's `environment` cascades into every
 * sub-service (sub-service env overrides per key). Networking/ports/domains
 * are configured per sub-service, NOT on the orchestrator.
 */
export const orchestratorRunnerConfigSchema = z
  .object({
    strategy: serviceRunnerStrategySchema,
    networkMode: runnerNetworkModeSchema,
    gracefulShutdownSeconds: z.int().min(0),
    composeFile: z.string().min(1).optional(),
    composeProjectName: z.string().optional(),
    profiles: z.array(z.string().min(1)).default([]),
    subServices: z.array(orchestratorSubServiceSchema).default([]),
    environment: z.record(z.string(), z.string()).default({}),
    /**
     * SELF-DEPLOY SCOPE — what a push to this orchestrator's repo deploys.
     *  - whole-stack:  parent + ALL children, in dependency order (compose up).
     *  - changed-only: use the webhook's changed-paths to deploy only affected
     *                  services (GitHub `paths:` / Vercel monorepo skipping).
     */
    autoDeploySubtree: z.enum(["whole-stack", "changed-only"]).default("whole-stack"),
    /**
     * PREVIEW SCOPE — what a PR preview of this orchestrator includes.
     *  - whole-stack:  the whole product preview (web + api + db + …).
     *  - changed-only: only services touched by the PR (Railway Focused PRs).
     */
    previewScope: z.enum(["whole-stack", "changed-only"]).default("whole-stack"),
  })
  .strict();

export const workerRuntimeRunnerConfigSchema = z
  .object({
    ...executionShape,
    queueName: z.string().min(1).optional(),
    concurrency: z.int().positive().optional(),
    maxRetries: z.int().min(0).optional(),
  })
  .strict();

export const nomadRunnerConfigSchema = z
  .object({
    ...executionShape,
    jobName: z.string().min(1).optional(),
    datacenter: z.string().min(1).optional(),
    nomadNamespace: z.string().optional(),
  })
  .strict();

export const staticRunnerConfigSchema = z
  .object({
    strategy: z.literal("recreate"),
    startCommand: z.string().optional(),
    args: z.array(z.string()).default([]),
    ports: z.array(z.int().positive()).default([]),
    volumeMounts: z.array(z.string()).default([]),
    secretRefs: z.array(z.string()).default([]),
    networkMode: runnerNetworkModeSchema,
    gracefulShutdownSeconds: z.int().min(0),
    outputDir: z.string().min(1).optional(),
    indexFile: z.string().min(1).optional(),
    errorPage: z.string().optional(),
  })
  .strict();

export const runnerConfigSchemaById = {
  manual: manualRunnerConfigSchema,
  orchestrator: orchestratorRunnerConfigSchema,
  compose: composeStackRunnerConfigSchema,
  kubernetes: kubernetesRunnerConfigSchema,
  "worker-runtime": workerRuntimeRunnerConfigSchema,
  nomad: nomadRunnerConfigSchema,
  static: staticRunnerConfigSchema,
  mock: mockServiceConfigSchema,
} as const;

export const serviceRunnerConfigUnionSchema = z.union([
  manualRunnerConfigSchema,
  orchestratorRunnerConfigSchema,
  composeStackRunnerConfigSchema,
  kubernetesRunnerConfigSchema,
  workerRuntimeRunnerConfigSchema,
  nomadRunnerConfigSchema,
  staticRunnerConfigSchema,
  mockServiceConfigSchema,
]);
