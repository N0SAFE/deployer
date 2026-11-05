import { Context } from "effect";

import {
    configurationScopeSchema,
    projectRuntimeConfigSchema,
    serviceRuntimeConfigSchema,
    userRuntimeConfigSchema,
    type ConfigurationScope,
} from "../schemas/runtime-configuration.schema";

type RuntimeConfigurationSchemaByScope = {
    project: typeof projectRuntimeConfigSchema;
    service: typeof serviceRuntimeConfigSchema;
    user: typeof userRuntimeConfigSchema;
}

type RuntimeConfigurationSchema = RuntimeConfigurationSchemaByScope[ConfigurationScope];

export type RuntimeConfigurationDefinition = {
    scope: ConfigurationScope;
    schema: RuntimeConfigurationSchema;
    description: string;
    dependsOn: ConfigurationScope[];
}

type RuntimeConfigurationDefinitionMap = Record<ConfigurationScope, RuntimeConfigurationDefinition>;

const runtimeConfigurationDefinitions: RuntimeConfigurationDefinitionMap = {
    project: {
        scope: "project",
        schema: projectRuntimeConfigSchema,
        description: "Project-level overrides and deployment behavior",
        dependsOn: [],
    },
    service: {
        scope: "service",
        schema: serviceRuntimeConfigSchema,
        description: "Service-level runtime and routing overrides",
        dependsOn: ["project"],
    },
    user: {
        scope: "user",
        schema: userRuntimeConfigSchema,
        description: "User-level runtime overrides (e.g., preview preferences)",
        dependsOn: ["project", "service"],
    },
};

export type ConfigurationDefinitionServiceShape = {
    readonly listDefinitions: () => RuntimeConfigurationDefinition[];
    readonly getDefinition: (scope: ConfigurationScope) => RuntimeConfigurationDefinition;
};

/** The definitions are constants: the service is pure, so its methods are plain reads. */
export function makeConfigurationDefinitionService(
    definitions: RuntimeConfigurationDefinitionMap = runtimeConfigurationDefinitions,
): ConfigurationDefinitionServiceShape {
    const getDefinition = (scope: ConfigurationScope) => definitions[scope];
    return {
        listDefinitions: () => configurationScopeSchema.options.map(getDefinition),
        getDefinition,
    };
}

export class ConfigurationDefinitionService extends Context.Service<ConfigurationDefinitionService, ConfigurationDefinitionServiceShape>()(
    "shared/ConfigurationDefinitionService",
) {}
