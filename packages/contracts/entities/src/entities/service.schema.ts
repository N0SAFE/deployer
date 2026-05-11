import {
    githubProviderConfigSchema,
    gitlabProviderConfigSchema,
    bitbucketProviderConfigSchema,
    artifactBundleProviderConfigSchema,
    containerRegistryProviderConfigSchema,
    manualProviderConfigSchema,
    providerConfigSchemaById,
    serviceProviderConfigUnionSchema,
} from "./service/provider-config.schema";
import {
    kubernetesRunnerConfigSchema,
    dockerComposeRunnerConfigSchema,
    dockerSwarmRunnerConfigSchema,
    workerRuntimeRunnerConfigSchema,
    nomadRunnerConfigSchema,
    staticRunnerConfigSchema,
    runnerConfigSchemaById,
    serviceRunnerConfigUnionSchema,
} from "./service/runner-config.schema";
import { serviceSchema, type Service } from "./service/service.schema";

export {
    githubProviderConfigSchema,
    gitlabProviderConfigSchema,
    bitbucketProviderConfigSchema,
    artifactBundleProviderConfigSchema,
    containerRegistryProviderConfigSchema,
    manualProviderConfigSchema,
    providerConfigSchemaById,
    serviceProviderConfigUnionSchema,
    kubernetesRunnerConfigSchema,
    dockerComposeRunnerConfigSchema,
    dockerSwarmRunnerConfigSchema,
    workerRuntimeRunnerConfigSchema,
    nomadRunnerConfigSchema,
    staticRunnerConfigSchema,
    runnerConfigSchemaById,
    serviceRunnerConfigUnionSchema,
    serviceSchema,
};

export type { Service };
