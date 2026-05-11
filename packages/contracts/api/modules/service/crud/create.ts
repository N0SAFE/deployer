import * as z from "zod";
import { serviceOps, serviceObjectSchema } from "./shared";

export const serviceCreateInputSchema = serviceObjectSchema
  .omit({ id: true, isActive: true, createdAt: true, updatedAt: true })
  .partial({
    description: true,
    providerConfig: true,
    builderConfig: true,
    port: true,
    environmentVariables: true,
    resourceLimits: true,
    deploymentRetention: true,
    healthCheckPath: true,
    healthCheckInterval: true,
    healthCheckTimeout: true,
    healthCheckRetries: true,
    traefikConfig: true,
    customDomains: true,
    metadata: true,
  });

export type ServiceCreateInput = z.infer<typeof serviceCreateInputSchema>;

export const serviceCreateContract = serviceOps
  .create()
  .input(serviceCreateInputSchema)
  .build();
