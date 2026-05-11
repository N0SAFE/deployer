import z from "zod/v4";
import {
  runnerNetworkModeSchema,
  serviceRunnerStrategySchema,
} from "@repo/contracts-common";

export const kubernetesRunnerConfigSchema = z
  .object({
    strategy: serviceRunnerStrategySchema,
    startCommand: z.string().min(1),
    args: z.array(z.string()),
    ports: z.array(z.int().positive()),
    volumeMounts: z.array(z.string()),
    secretRefs: z.array(z.string()),
    networkMode: runnerNetworkModeSchema,
    gracefulShutdownSeconds: z.int().min(0),
  })
  .strict();

export const dockerComposeRunnerConfigSchema = kubernetesRunnerConfigSchema;
export const dockerSwarmRunnerConfigSchema = kubernetesRunnerConfigSchema;
export const workerRuntimeRunnerConfigSchema = kubernetesRunnerConfigSchema;
export const nomadRunnerConfigSchema = kubernetesRunnerConfigSchema;

export const staticRunnerConfigSchema = z
  .object({
    strategy: z.literal("recreate"),
    startCommand: z.string().min(1),
    args: z.array(z.string()),
    ports: z.array(z.int().positive()),
    volumeMounts: z.array(z.string()),
    secretRefs: z.array(z.string()),
    networkMode: runnerNetworkModeSchema,
    gracefulShutdownSeconds: z.int().min(0),
  })
  .strict();

export const runnerConfigSchemaById = {
  kubernetes: kubernetesRunnerConfigSchema,
  "docker-compose": dockerComposeRunnerConfigSchema,
  "docker-swarm": dockerSwarmRunnerConfigSchema,
  "worker-runtime": workerRuntimeRunnerConfigSchema,
  nomad: nomadRunnerConfigSchema,
  static: staticRunnerConfigSchema,
} as const;

export const serviceRunnerConfigUnionSchema = z.union([
  kubernetesRunnerConfigSchema,
  dockerComposeRunnerConfigSchema,
  dockerSwarmRunnerConfigSchema,
  workerRuntimeRunnerConfigSchema,
  nomadRunnerConfigSchema,
  staticRunnerConfigSchema,
]);
