import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import { providerSchemaContract } from "@deployer/fleet-contracts";
import { procedure } from "@deployer/nest-effect";
import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { ProviderSchemaService } from "../services/provider-schema.service";

/**
 * The provider and builder catalog surface.
 *
 * Every handler resolves `ProviderSchemaService` from the module's Effect context and runs its use
 * case through the `.effect()` boundary, which provides the actor and correlation id and maps failures to the errors
 * the contract declares. The controller holds no rule: it only shapes results to the contract.
 */
@Controller()
export class ProviderSchemaController {
    @Implement(providerSchemaContract.getAllProviders)
    getAllProviders() {
        return procedure(providerSchemaContract.getAllProviders)
            .use(requireAuth())
            .effect(function* () {
                const schemas = yield* ProviderSchemaService;
                const providers = yield* schemas.getAllProviders();
                return { providers, total: providers.length };
            });
    }

    @Implement(providerSchemaContract.getProviderSchema)
    getProviderSchema() {
        return procedure(providerSchemaContract.getProviderSchema)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const schemas = yield* ProviderSchemaService;
                return yield* schemas.getProviderSchema(input.params.id);
            });
    }

    @Implement(providerSchemaContract.getCompatibleBuilders)
    getCompatibleBuilders() {
        return procedure(providerSchemaContract.getCompatibleBuilders)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const schemas = yield* ProviderSchemaService;
                const builders = yield* schemas.getCompatibleBuilders(input.params.providerId);
                return { builders, total: builders.length };
            });
    }

    @Implement(providerSchemaContract.getAllBuilders)
    getAllBuilders() {
        return procedure(providerSchemaContract.getAllBuilders)
            .use(requireAuth())
            .effect(function* () {
                const schemas = yield* ProviderSchemaService;
                const builders = yield* schemas.getAllBuilders();
                return { builders, total: builders.length };
            });
    }

    @Implement(providerSchemaContract.getBuilderSchema)
    getBuilderSchema() {
        return procedure(providerSchemaContract.getBuilderSchema)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const schemas = yield* ProviderSchemaService;
                return yield* schemas.getBuilderSchema(input.params.id);
            });
    }

    @Implement(providerSchemaContract.getCompatibleProviders)
    getCompatibleProviders() {
        return procedure(providerSchemaContract.getCompatibleProviders)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const schemas = yield* ProviderSchemaService;
                const providers = yield* schemas.getCompatibleProviders(input.params.builderId);
                return { providers, total: providers.length };
            });
    }

    @Implement(providerSchemaContract.validateProviderConfig)
    validateProviderConfig() {
        return procedure(providerSchemaContract.validateProviderConfig)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const schemas = yield* ProviderSchemaService;
                return yield* schemas.validateProviderConfig(input.params.providerId, input.body.config)
                ;
            });
    }

    @Implement(providerSchemaContract.validateBuilderConfig)
    validateBuilderConfig() {
        return procedure(providerSchemaContract.validateBuilderConfig)
            .use(requireAuth())
            .effect(function* ({ input }) {
                const schemas = yield* ProviderSchemaService;
                return yield* schemas.validateBuilderConfig(input.params.builderId, input.body.config)
                ;
            });
    }
}
