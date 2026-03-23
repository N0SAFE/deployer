import { Injectable } from "@nestjs/common";
import {
    configurationScopeSchema,
    organizationRuntimeConfigSchema,
    projectRuntimeConfigSchema,
    serviceRuntimeConfigSchema,
    userRuntimeConfigSchema,
    type ConfigurationScope,
} from "../schemas/runtime-configuration.schema";

interface RuntimeConfigurationSchemaByScope {
    organization: typeof organizationRuntimeConfigSchema;
    project: typeof projectRuntimeConfigSchema;
    service: typeof serviceRuntimeConfigSchema;
    user: typeof userRuntimeConfigSchema;
}

type RuntimeConfigurationSchema = RuntimeConfigurationSchemaByScope[ConfigurationScope];

export interface RuntimeConfigurationDefinition {
    scope: ConfigurationScope;
    schema: RuntimeConfigurationSchema;
    description: string;
    dependsOn: ConfigurationScope[];
}

type RuntimeConfigurationDefinitionMap = Record<ConfigurationScope, RuntimeConfigurationDefinition>;

const runtimeConfigurationDefinitions: RuntimeConfigurationDefinitionMap = {
    organization: {
        scope: "organization",
        schema: organizationRuntimeConfigSchema,
        description: "Organization-level defaults and guardrails",
        dependsOn: [],
    },
    project: {
        scope: "project",
        schema: projectRuntimeConfigSchema,
        description: "Project-level overrides and deployment behavior",
        dependsOn: ["organization"],
    },
    service: {
        scope: "service",
        schema: serviceRuntimeConfigSchema,
        description: "Service-level runtime and routing overrides",
        dependsOn: ["organization", "project"],
    },
    user: {
        scope: "user",
        schema: userRuntimeConfigSchema,
        description: "User-level runtime overrides (e.g., preview preferences)",
        dependsOn: ["organization", "project", "service"],
    },
};

@Injectable()
export class ConfigurationDefinitionService {
    private readonly definitions: RuntimeConfigurationDefinitionMap;

    constructor() {
        this.definitions = runtimeConfigurationDefinitions;
    }

    listDefinitions(): RuntimeConfigurationDefinition[] {
        return configurationScopeSchema.options.map((scope) => this.getDefinition(scope));
    }

    getDefinition(scope: ConfigurationScope): RuntimeConfigurationDefinition {
        return this.definitions[scope];
    }
}
