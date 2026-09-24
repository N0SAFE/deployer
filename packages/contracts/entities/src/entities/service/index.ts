export {
	githubProviderConfigSchema,
	gitlabProviderConfigSchema,
	bitbucketProviderConfigSchema,
	artifactBundleProviderConfigSchema,
	containerRegistryProviderConfigSchema,
	manualProviderConfigSchema,
	providerConfigSchemaById,
	serviceProviderConfigUnionSchema,
} from "@repo/contracts-entities/entities/service/provider-config.schema";

export {
	kubernetesRunnerConfigSchema,
	manualRunnerConfigSchema,
	orchestratorRunnerConfigSchema,
	orchestratorSubServiceSchema,
	workerRuntimeRunnerConfigSchema,
	nomadRunnerConfigSchema,
	staticRunnerConfigSchema,
	runnerConfigSchemaById,
	serviceRunnerConfigUnionSchema,
} from "@repo/contracts-entities/entities/service/runner-config.schema";

export {
	mockEngineSchema,
	mockServiceConfigSchema,
	implementedContractSchema,
} from "@repo/contracts-entities/entities/service/mock-config.schema";

// Provider-backed network config (shared with project/network.schema.ts)
export {
        serviceNetworkConfigSchema,
        projectNetworkConfigSchema,
        networkDnsRecordTypeSchema,
        defaultProjectNetworkConfig,
        defaultServiceNetworkConfig,
} from "@repo/contracts-entities/entities/project/network.schema";

export type {
        ServiceNetworkConfig,
        ProjectNetworkConfig,
} from "@repo/contracts-entities/entities/project/network.schema";

export {
	serviceSchema,
	serviceObjectShape,
	serviceEffectiveConfigSchema,
	serviceWithEffectiveConfigSchema,
} from "@repo/contracts-entities/entities/service/service.schema";

export type {
	Service,
	ServiceEffectiveConfig,
	ServiceWithEffectiveConfig,
} from "@repo/contracts-entities/entities/service/service.schema";
