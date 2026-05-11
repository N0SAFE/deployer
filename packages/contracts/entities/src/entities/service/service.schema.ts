import z from "zod/v4";
import {
  serviceProviderTypeSchema,
  serviceRunnerTypeSchema,
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

export const serviceSchema = z
  .object({
    id: z.uuid(),
    projectId: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    type: z.string(),
    providerId: serviceProviderTypeSchema,
    providerConfig: serviceProviderConfigUnionSchema,
    builderId: serviceRunnerTypeSchema,
    builderConfig: serviceRunnerConfigUnionSchema,
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
    isActive: z.boolean(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((service, ctx) => {
    const providerSchema = providerConfigSchemaById[service.providerId];
    if (!providerSchema.safeParse(service.providerConfig).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerConfig"],
        message: `providerConfig does not match providerId '${service.providerId}'.`,
      });
    }

    const runnerSchema = runnerConfigSchemaById[service.builderId];
    if (!runnerSchema.safeParse(service.builderConfig).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["builderConfig"],
        message: `builderConfig does not match builderId '${service.builderId}'.`,
      });
    }
  });

export type Service = z.infer<typeof serviceSchema>;
