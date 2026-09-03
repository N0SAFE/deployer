import type { ServiceProviderType, ServiceRunnerType } from "@repo/contracts-common";
import {
  githubProviderConfigSchema,
  gitlabProviderConfigSchema,
  bitbucketProviderConfigSchema,
  artifactBundleProviderConfigSchema,
  containerRegistryProviderConfigSchema,
  manualProviderConfigSchema,
  kubernetesRunnerConfigSchema,
  manualRunnerConfigSchema,
  orchestratorRunnerConfigSchema,
  workerRuntimeRunnerConfigSchema,
  nomadRunnerConfigSchema,
  staticRunnerConfigSchema,
} from "@repo/contracts-entities";
import z from "zod/v4";

type GithubProviderConfig = z.infer<typeof githubProviderConfigSchema>;
type GitlabProviderConfig = z.infer<typeof gitlabProviderConfigSchema>;
type BitbucketProviderConfig = z.infer<typeof bitbucketProviderConfigSchema>;
type ArtifactBundleProviderConfig = z.infer<typeof artifactBundleProviderConfigSchema>;
type ContainerRegistryProviderConfig = z.infer<typeof containerRegistryProviderConfigSchema>;
type ManualProviderConfig = z.infer<typeof manualProviderConfigSchema>;

type ProviderConfig =
  | GithubProviderConfig
  | GitlabProviderConfig
  | BitbucketProviderConfig
  | ArtifactBundleProviderConfig
  | ContainerRegistryProviderConfig
  | ManualProviderConfig;

type KubernetesRunnerConfig = z.infer<typeof kubernetesRunnerConfigSchema>;
type ManualRunnerConfig = z.infer<typeof manualRunnerConfigSchema>;
type OrchestratorRunnerConfig = z.infer<typeof orchestratorRunnerConfigSchema>;
type WorkerRuntimeRunnerConfig = z.infer<typeof workerRuntimeRunnerConfigSchema>;
type NomadRunnerConfig = z.infer<typeof nomadRunnerConfigSchema>;
type StaticRunnerConfig = z.infer<typeof staticRunnerConfigSchema>;

type RunnerConfig =
  | KubernetesRunnerConfig
  | ManualRunnerConfig
  | OrchestratorRunnerConfig
  | WorkerRuntimeRunnerConfig
  | NomadRunnerConfig
  | StaticRunnerConfig;

/** Generate default provider config for a given provider type. */
export function defaultProviderConfig(providerId: ServiceProviderType): ProviderConfig {
  const defaults = {
    sourceUrl: "",
    branch: "main",
    rootPath: ".",
    buildContext: ".",
    dockerfilePath: "Dockerfile" as const,
    image: "" as const,
    autoSyncEnabled: true,
    webhookEnabled: true,
    authSecretRef: "default",
  };

  switch (providerId) {
    case "github":
    case "gitlab":
    case "bitbucket":
      return {
        sourceUrl: defaults.sourceUrl,
        branch: defaults.branch,
        rootPath: defaults.rootPath,
        buildContext: defaults.buildContext,
        dockerfilePath: defaults.dockerfilePath,
        image: defaults.image,
        autoSyncEnabled: defaults.autoSyncEnabled,
        webhookEnabled: defaults.webhookEnabled,
        authSecretRef: defaults.authSecretRef,
      };
    case "artifact-bundle":
    case "container-registry":
      return {
        sourceUrl: defaults.sourceUrl,
        branch: defaults.branch,
        rootPath: defaults.rootPath,
        buildContext: defaults.buildContext,
        image: defaults.image,
        autoSyncEnabled: defaults.autoSyncEnabled,
        webhookEnabled: defaults.webhookEnabled,
        authSecretRef: defaults.authSecretRef,
      };
    case "manual":
      return {
        sourceUrl: defaults.sourceUrl,
        branch: defaults.branch,
        rootPath: defaults.rootPath,
        buildContext: defaults.buildContext,
        dockerfilePath: defaults.dockerfilePath,
        image: defaults.image,
        autoSyncEnabled: defaults.autoSyncEnabled,
        webhookEnabled: defaults.webhookEnabled,
        authSecretRef: defaults.authSecretRef,
      };
    default:
      return {
        sourceUrl: defaults.sourceUrl,
        branch: defaults.branch,
        rootPath: defaults.rootPath,
        buildContext: defaults.buildContext,
        dockerfilePath: defaults.dockerfilePath,
        image: defaults.image,
        autoSyncEnabled: defaults.autoSyncEnabled,
        webhookEnabled: defaults.webhookEnabled,
        authSecretRef: defaults.authSecretRef,
      };
  }
}

/** Generate default runner config for a given runner type. */
export function defaultRunnerConfig(builderId: ServiceRunnerType): RunnerConfig {
  const defaults = {
    startCommand: "",
    args: [] as string[],
    ports: [] as number[],
    volumeMounts: [] as string[],
    secretRefs: [] as string[],
    gracefulShutdownSeconds: 30,
  };

  switch (builderId) {
    case "kubernetes":
    case "manual":
    case "compose":
    case "orchestrator":
    case "worker-runtime":
    case "nomad":
      return {
        strategy: "rolling" as const,
        ...defaults,
        networkMode: "bridge" as const,
      };
    case "static":
      return {
        strategy: "recreate" as const,
        ...defaults,
        networkMode: "bridge" as const,
      };
    default:
      return {
        strategy: "rolling" as const,
        ...defaults,
        networkMode: "bridge" as const,
      };
  }
}
