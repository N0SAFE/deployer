import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { providerSchemaContract } from "@deployer/fleet-contracts";
import { EffectContextOf } from "@deployer/nest-effect";
import { requireAuth } from "@deployer/shared/core/modules/auth/orpc/middlewares";

import { serve } from "../../../core/orpc/serve";
import { ProviderSchemaModule } from "../provider-schema.module";
import { ProviderSchemaService } from "../services/provider-schema.service";

/**
 * The provider and builder catalog surface.
 *
 * Every handler resolves `ProviderSchemaService` from the module's Effect context and runs its use
 * case through `serve`, which provides the actor and correlation id and maps failures to the errors
 * the contract declares. The controller holds no rule: it only shapes results to the contract.
 */
@Controller()
export class ProviderSchemaController {
    @Implement(providerSchemaContract.getAllProviders)
    getAllProviders() {
        return implement(providerSchemaContract.getAllProviders)
            .use(requireAuth())
            .use(ProviderSchemaModule[EffectContextOf])
            .effect(function* ({ context }) {
                const schemas = yield* ProviderSchemaService;
                const providers = yield* serve(context)(schemas.getAllProviders());
                return { providers, total: providers.length };
            });
    }

    @Implement(providerSchemaContract.getProviderSchema)
    getProviderSchema() {
        return implement(providerSchemaContract.getProviderSchema)
            .use(requireAuth())
            .use(ProviderSchemaModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const schemas = yield* ProviderSchemaService;
                return yield* serve(context)(schemas.getProviderSchema(input.params.id));
            });
    }

    @Implement(providerSchemaContract.getCompatibleBuilders)
    getCompatibleBuilders() {
        return implement(providerSchemaContract.getCompatibleBuilders)
            .use(requireAuth())
            .use(ProviderSchemaModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const schemas = yield* ProviderSchemaService;
                const builders = yield* serve(context)(schemas.getCompatibleBuilders(input.params.providerId));
                return { builders, total: builders.length };
            });
    }

    @Implement(providerSchemaContract.getAllBuilders)
    getAllBuilders() {
        return implement(providerSchemaContract.getAllBuilders)
            .use(requireAuth())
            .use(ProviderSchemaModule[EffectContextOf])
            .effect(function* ({ context }) {
                const schemas = yield* ProviderSchemaService;
                const builders = yield* serve(context)(schemas.getAllBuilders());
                return { builders, total: builders.length };
            });
    }

    @Implement(providerSchemaContract.getBuilderSchema)
    getBuilderSchema() {
        return implement(providerSchemaContract.getBuilderSchema)
            .use(requireAuth())
            .use(ProviderSchemaModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const schemas = yield* ProviderSchemaService;
                return yield* serve(context)(schemas.getBuilderSchema(input.params.id));
            });
    }

    @Implement(providerSchemaContract.getCompatibleProviders)
    getCompatibleProviders() {
        return implement(providerSchemaContract.getCompatibleProviders)
            .use(requireAuth())
            .use(ProviderSchemaModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const schemas = yield* ProviderSchemaService;
                const providers = yield* serve(context)(schemas.getCompatibleProviders(input.params.builderId));
                return { providers, total: providers.length };
            });
    }

    @Implement(providerSchemaContract.validateProviderConfig)
    validateProviderConfig() {
        return implement(providerSchemaContract.validateProviderConfig)
            .use(requireAuth())
            .use(ProviderSchemaModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const schemas = yield* ProviderSchemaService;
                return yield* serve(context)(
                    schemas.validateProviderConfig(input.params.providerId, input.body.config),
                );
            });
    }

    @Implement(providerSchemaContract.validateBuilderConfig)
    validateBuilderConfig() {
        return implement(providerSchemaContract.validateBuilderConfig)
            .use(requireAuth())
            .use(ProviderSchemaModule[EffectContextOf])
            .effect(function* ({ input, context }) {
                const schemas = yield* ProviderSchemaService;
                return yield* serve(context)(
                    schemas.validateBuilderConfig(input.params.builderId, input.body.config),
                );
            });
    }
}
