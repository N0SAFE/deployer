import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { providerSchemaContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { ProviderSchemaService } from "../services/provider-schema.service";

@Controller()
export class ProviderSchemaController {
    constructor(private readonly providerSchemaService: ProviderSchemaService) {}

    @Implement(providerSchemaContract.getAllProviders)
    getAllProviders() {
        return implement(providerSchemaContract.getAllProviders)
            .use(requireAuth())
            .handler(() => {
                const providers = this.providerSchemaService.getAllProviders();
                return {
                    providers,
                    total: providers.length,
                };
            });
    }

    @Implement(providerSchemaContract.getProviderSchema)
    getProviderSchema() {
        return implement(providerSchemaContract.getProviderSchema)
            .use(requireAuth())
            .handler(({ input }) => this.providerSchemaService.getProviderSchema(input.params.id));
    }

    @Implement(providerSchemaContract.getCompatibleBuilders)
    getCompatibleBuilders() {
        return implement(providerSchemaContract.getCompatibleBuilders)
            .use(requireAuth())
            .handler(({ input }) => {
                const builders = this.providerSchemaService.getCompatibleBuilders(input.params.providerId);
                return {
                    builders,
                    total: builders.length,
                };
            });
    }

    @Implement(providerSchemaContract.getAllBuilders)
    getAllBuilders() {
        return implement(providerSchemaContract.getAllBuilders)
            .use(requireAuth())
            .handler(() => {
                const builders = this.providerSchemaService.getAllBuilders();
                return {
                    builders,
                    total: builders.length,
                };
            });
    }

    @Implement(providerSchemaContract.getBuilderSchema)
    getBuilderSchema() {
        return implement(providerSchemaContract.getBuilderSchema)
            .use(requireAuth())
            .handler(({ input }) => this.providerSchemaService.getBuilderSchema(input.params.id));
    }

    @Implement(providerSchemaContract.getCompatibleProviders)
    getCompatibleProviders() {
        return implement(providerSchemaContract.getCompatibleProviders)
            .use(requireAuth())
            .handler(({ input }) => {
                const providers = this.providerSchemaService.getCompatibleProviders(input.params.builderId);
                return {
                    providers,
                    total: providers.length,
                };
            });
    }

    @Implement(providerSchemaContract.validateProviderConfig)
    validateProviderConfig() {
        return implement(providerSchemaContract.validateProviderConfig)
            .use(requireAuth())
            .handler(({ input }) =>
                this.providerSchemaService.validateProviderConfig(input.params.providerId, input.body.config),
            );
    }

    @Implement(providerSchemaContract.validateBuilderConfig)
    validateBuilderConfig() {
        return implement(providerSchemaContract.validateBuilderConfig)
            .use(requireAuth())
            .handler(({ input }) =>
                this.providerSchemaService.validateBuilderConfig(input.params.builderId, input.body.config),
            );
    }
}
