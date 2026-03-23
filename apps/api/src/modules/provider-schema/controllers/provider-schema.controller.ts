import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { ProviderSchemaService } from "../services/provider-schema.service";

@Controller()
export class ProviderSchemaController {
    constructor(private readonly providerSchemaService: ProviderSchemaService) {}

    @Implement(appContract.providerSchema.getAllProviders)
    getAllProviders() {
        return implement(appContract.providerSchema.getAllProviders)
            .use(requireAuth())
            .handler(() => {
                const providers = this.providerSchemaService.getAllProviders();
                return {
                    providers,
                    total: providers.length,
                };
            });
    }

    @Implement(appContract.providerSchema.getProviderSchema)
    getProviderSchema() {
        return implement(appContract.providerSchema.getProviderSchema)
            .use(requireAuth())
            .handler(({ input }) => this.providerSchemaService.getProviderSchema(input.params.id));
    }

    @Implement(appContract.providerSchema.getCompatibleBuilders)
    getCompatibleBuilders() {
        return implement(appContract.providerSchema.getCompatibleBuilders)
            .use(requireAuth())
            .handler(({ input }) => {
                const builders = this.providerSchemaService.getCompatibleBuilders(input.params.providerId);
                return {
                    builders,
                    total: builders.length,
                };
            });
    }

    @Implement(appContract.providerSchema.getAllBuilders)
    getAllBuilders() {
        return implement(appContract.providerSchema.getAllBuilders)
            .use(requireAuth())
            .handler(() => {
                const builders = this.providerSchemaService.getAllBuilders();
                return {
                    builders,
                    total: builders.length,
                };
            });
    }

    @Implement(appContract.providerSchema.getBuilderSchema)
    getBuilderSchema() {
        return implement(appContract.providerSchema.getBuilderSchema)
            .use(requireAuth())
            .handler(({ input }) => this.providerSchemaService.getBuilderSchema(input.params.id));
    }

    @Implement(appContract.providerSchema.getCompatibleProviders)
    getCompatibleProviders() {
        return implement(appContract.providerSchema.getCompatibleProviders)
            .use(requireAuth())
            .handler(({ input }) => {
                const providers = this.providerSchemaService.getCompatibleProviders(input.params.builderId);
                return {
                    providers,
                    total: providers.length,
                };
            });
    }

    @Implement(appContract.providerSchema.validateProviderConfig)
    validateProviderConfig() {
        return implement(appContract.providerSchema.validateProviderConfig)
            .use(requireAuth())
            .handler(({ input }) =>
                this.providerSchemaService.validateProviderConfig(input.params.providerId, input.body.config),
            );
    }

    @Implement(appContract.providerSchema.validateBuilderConfig)
    validateBuilderConfig() {
        return implement(appContract.providerSchema.validateBuilderConfig)
            .use(requireAuth())
            .handler(({ input }) =>
                this.providerSchemaService.validateBuilderConfig(input.params.builderId, input.body.config),
            );
    }
}
