import z from "zod/v4";
import {
  serviceProviderTypeSchema,
  serviceRunnerTypeSchema,
  serviceTypeSchema,
  perEnvironmentStrategySchema,
} from "@repo/contracts-common";
import { traefikDynamicConfigSchema } from "../traefik";
import {
  providerConfigSchemaById,
  serviceProviderConfigUnionSchema,
} from "./provider-config.schema";
import {
  runnerConfigSchemaById,
  serviceRunnerConfigUnionSchema,
} from "./runner-config.schema";
import { implementedContractSchema } from "./mock-config.schema";
import { previewSourceTemplateSchema } from "../configuration/preview-template.schema";
import { serviceNetworkConfigSchema } from "../project/network.schema";

/**
 * Plain refinement-free object shape (NO superRefine, NO lazy `children`).
 * Safe for `.shape` access and for `.omit()/.partial()` in create/update
 * input schemas (zod v4 forbids those on refined objects).
 */
export const serviceObjectShape = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    type: serviceTypeSchema,
    /** Per-environment rollout strategy — the strategy of the target env wins. */
    environmentStrategies: perEnvironmentStrategySchema.optional(),
    providerId: serviceProviderTypeSchema,
    providerConfig: serviceProviderConfigUnionSchema.nullable(),
    builderId: serviceRunnerTypeSchema,
    builderConfig: serviceRunnerConfigUnionSchema.nullable(),
    port: z.number().int().nullable(),
    environmentVariables: z.record(z.string(), z.string()).nullable(),
    resourceLimits: z
      .object({
        memory: z.string().optional(),
        cpu: z.string().optional(),
        storage: z.string().optional(),
      })
      .nullable(),
    healthCheckPath: z.string().nullable(),
    healthCheckInterval: z.number().int().nullable(),
    healthCheckTimeout: z.number().int().nullable(),
    healthCheckRetries: z.number().int().nullable(),
    deploymentRetention: z
      .object({
        maxSuccessfulDeployments: z.number().optional(),
        keepArtifacts: z.boolean().optional(),
        autoCleanup: z.boolean().optional(),
        cleanupSchedule: z.string().optional(),
      })
      .nullable(),
    traefikConfig: traefikDynamicConfigSchema.nullable(),
    customDomains: z.array(z.string()).nullable(),
    /** Provider-backed network config (DNS provider + zone + record policy). */
    network: serviceNetworkConfigSchema.nullable(),
    /**
     * The contract this service implements (DI semantics). A mock must match
     * the replaced service's contractRef — see mock-config.schema.ts.
     */
    implementsContract: implementedContractSchema.nullable(),
    /** Per-service preview resolution template (how previews of THIS service resolve). */
    preview: previewSourceTemplateSchema.nullable(),
    isActive: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    // ==========================================
    // HIERARCHY (sub-services)
    // A sub-service is a REAL service row linked to its parent. Any service
    // may have children (they become orchestrators); a child may itself have
    // children — full nesting. `children` is a read-model (computed tree).
    // ==========================================
    parentId: z.uuid().nullable(),
    parentPath: z.string().nullable(),
    depth: z.number().int().nonnegative().default(0),
    createdAt: z.string(),
    updatedAt: z.string(),
  });

/** Refined variant: validates providerConfig/builderConfig against the ids. */
const serviceSchemaBase = serviceObjectShape.superRefine((service, ctx) => {
  if (service.providerConfig === null) return;

  const providerSchema = providerConfigSchemaById[service.providerId];
  if (!providerSchema.safeParse(service.providerConfig).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["providerConfig"],
      message: `providerConfig does not match providerId '${service.providerId}'.`,
    });
  }

  if (service.builderConfig === null) return;

  const runnerSchema = runnerConfigSchemaById[service.builderId];
  if (!runnerSchema.safeParse(service.builderConfig).success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["builderConfig"],
      message: `builderConfig does not match builderId '${service.builderId}'.`,
    });
  }
});

/**
 * Effective config of a service — the RESOLVED configuration after merging
 * inherited values from the parent chain (sub-service → parent → ... → root).
 * Follows the Docker-Compose merge model: single-values replace, maps merge
 * key-by-key with the child taking precedence.
 *
 * A sub-service "is a namespace" for everything below it: it inherits the
 * parent's runtime defaults unless it overrides them. This schema is the
 * read-model the UI shows for "what this service will actually run with".
 */
export const serviceEffectiveConfigSchema = z.object({
  /** Resolved container port (child overrides parent). */
  port: z.number().int().nullable(),
  /** Resolved resource limits (child overrides parent, field by field). */
  resourceLimits: z
    .object({
      memory: z.string().optional(),
      cpu: z.string().optional(),
      storage: z.string().optional(),
    })
    .nullable(),
  /** Resolved env vars (key-by-key merge, child wins). */
  environmentVariables: z.record(z.string(), z.string()).nullable(),
  /** Resolved health check settings (child overrides parent). */
  healthCheck: z
    .object({
      path: z.string().nullable(),
      interval: z.number().int().nullable(),
      timeout: z.number().int().nullable(),
      retries: z.number().int().nullable(),
    })
    .nullable(),
  /** Resolved deployment retention (child overrides parent). */
  deploymentRetention: z
    .object({
      maxSuccessfulDeployments: z.number().optional(),
      keepArtifacts: z.boolean().optional(),
      autoCleanup: z.boolean().optional(),
      cleanupSchedule: z.string().optional(),
    })
    .nullable(),
  /**
   * Resolved provider source (sourceUrl/branch etc.). A sub-service inherits
   * the parent's repository source unless it defines its own providerConfig.
   */
  providerConfig: serviceProviderConfigUnionSchema.nullable(),
  /** Resolved custom domains (own + inherited). */
  customDomains: z.array(z.string()).nullable(),
  /**
   * Resolved network config (DNS provider + zone + record policy). A
   * sub-service inherits the parent chain's network config unless it defines
   * its own (only explicitly-set fields override).
   */
  network: serviceNetworkConfigSchema.nullable(),
  /** Resolved contract this service implements (inherited down the chain). */
  implementsContract: implementedContractSchema.nullable(),
});

export type ServiceEffectiveConfig = z.infer<typeof serviceEffectiveConfigSchema>;

/**
 * Recursive schema — zod v4 native mechanism via a lazy `get` accessor
 * (no `z.lazy()` needed). The getter runs when `.children` is first accessed,
 * at which point `serviceSchema` is fully initialized.
 *
 * NOTE: this MUST be declared before `serviceWithEffectiveConfigSchema`
 * (which `.extend()`s it) — otherwise it's a temporal-dead-zone error.
 */
export const serviceSchema = serviceSchemaBase.extend({
  get children() {
    return z.array(serviceSchema).optional();
  },
});

export type Service = z.infer<typeof serviceSchema>;

/** The service DTO extended with its resolved effective config (read-model). */
export const serviceWithEffectiveConfigSchema = serviceSchema.extend({
  effectiveConfig: serviceEffectiveConfigSchema,
});

export type ServiceWithEffectiveConfig = z.infer<typeof serviceWithEffectiveConfigSchema>;
