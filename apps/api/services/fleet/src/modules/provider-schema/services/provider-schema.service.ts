import { Injectable, NotFoundException } from "@nestjs/common";
import {
    buildersCatalog,
    builderConfigValidators,
    builderSchemasCatalog,
    providersCatalog,
    providerConfigValidators,
    providerSchemasCatalog,
} from "@repo/provider-schema";

@Injectable()
export class ProviderSchemaService {
    private readonly providers = providersCatalog;
    private readonly builders = buildersCatalog;
    private readonly providerSchemas = providerSchemasCatalog;
    private readonly builderSchemas = builderSchemasCatalog;
    private readonly providerConfigValidators = providerConfigValidators;
    private readonly builderConfigValidators = builderConfigValidators;

    getAllProviders() {
        return this.providers;
    }

    getProviderSchema(id: string) {
        const schema = this.providerSchemas[id];
        if (!schema) {
            throw new NotFoundException(`Provider schema '${id}' not found`);
        }
        return schema;
    }

    getCompatibleBuilders(providerId: string) {
        const provider = this.providers.find((item) => item.id === providerId);
        if (!provider) {
            throw new NotFoundException(`Provider '${providerId}' not found`);
        }

        return this.builders.filter((builder) => provider.supportedBuilders.includes(builder.id));
    }

    getAllBuilders() {
        return this.builders;
    }

    getBuilderSchema(id: string) {
        const schema = this.builderSchemas[id];
        if (!schema) {
            throw new NotFoundException(`Builder schema '${id}' not found`);
        }
        return schema;
    }

    getCompatibleProviders(builderId: string) {
        const builder = this.builders.find((item) => item.id === builderId);
        if (!builder) {
            throw new NotFoundException(`Builder '${builderId}' not found`);
        }

        return this.providers.filter((provider) => builder.compatibleProviders.includes(provider.id));
    }

    validateProviderConfig(providerId: string, config: Record<string, unknown>) {
        const validator = this.providerConfigValidators[providerId];
        if (!validator) {
            throw new NotFoundException(`Provider '${providerId}' not found`);
        }

        const parsed = validator.safeParse(config);
        if (parsed.success) {
            return { valid: true, errors: [] };
        }

        return {
            valid: false,
            errors: parsed.error.issues.map((issue) => {
                const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
                return `${path}${issue.message}`;
            }),
        };
    }

    validateBuilderConfig(builderId: string, config: Record<string, unknown>) {
        const validator = this.builderConfigValidators[builderId];
        if (!validator) {
            throw new NotFoundException(`Builder '${builderId}' not found`);
        }

        const parsed = validator.safeParse(config);
        if (parsed.success) {
            return { valid: true, errors: [] };
        }

        return {
            valid: false,
            errors: parsed.error.issues.map((issue) => {
                const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
                return `${path}${issue.message}`;
            }),
        };
    }
}
