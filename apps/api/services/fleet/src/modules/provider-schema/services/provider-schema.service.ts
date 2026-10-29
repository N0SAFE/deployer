import {
    buildersCatalog,
    builderConfigValidators,
    builderSchemasCatalog,
    providersCatalog,
    providerConfigValidators,
    providerSchemasCatalog,
} from "@deployer/provider-schema";
import { Context, Effect } from "effect";

import { FleetNotFound } from "../../../core/fleet.errors";

/** The outcome of validating a config against a provider's or builder's schema. */
export type ConfigValidation = {
    readonly valid: boolean;
    readonly errors: string[];
};

/** A zod-like validator, as the catalogs expose it. */
type Validator = {
    safeParse(config: unknown): {
        success: boolean;
        error?: { issues: { path: PropertyKey[]; message: string }[] };
    };
};

const validate = (validator: Validator, config: Record<string, unknown>): ConfigValidation => {
    const parsed = validator.safeParse(config);
    if (parsed.success) return { valid: true, errors: [] };
    return {
        valid: false,
        errors: (parsed.error?.issues ?? []).map((issue) => {
            const path = issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ` : "";
            return `${path}${issue.message}`;
        }),
    };
};

/**
 * Read-only access to the provider and builder catalogs. Nothing here touches I/O, so no method
 * needs a requirement: an unknown id is a typed `FleetNotFound`, not a throw.
 */
export type ProviderSchemaServiceShape = {
    readonly getAllProviders: () => Effect.Effect<typeof providersCatalog>;
    readonly getProviderSchema: (id: string) => Effect.Effect<(typeof providerSchemasCatalog)[string], FleetNotFound>;
    readonly getCompatibleBuilders: (providerId: string) => Effect.Effect<typeof buildersCatalog, FleetNotFound>;
    readonly getAllBuilders: () => Effect.Effect<typeof buildersCatalog>;
    readonly getBuilderSchema: (id: string) => Effect.Effect<(typeof builderSchemasCatalog)[string], FleetNotFound>;
    readonly getCompatibleProviders: (builderId: string) => Effect.Effect<typeof providersCatalog, FleetNotFound>;
    readonly validateProviderConfig: (
        providerId: string,
        config: Record<string, unknown>,
    ) => Effect.Effect<ConfigValidation, FleetNotFound>;
    readonly validateBuilderConfig: (
        builderId: string,
        config: Record<string, unknown>,
    ) => Effect.Effect<ConfigValidation, FleetNotFound>;
};

/** Tag and implementation together: the tag is the contract, `Live` the one implementation. */
export class ProviderSchemaService extends Context.Service<ProviderSchemaService, ProviderSchemaServiceShape>()(
    "fleet/ProviderSchemaService",
) {
	static readonly live: ProviderSchemaServiceShape = makeProviderSchemaService();

}

/** The service over the shipped catalogs; a plain record, so it needs no Nest to exist. */
function makeProviderSchemaService(): ProviderSchemaServiceShape {
    const notFound = (what: string, id: string) => new FleetNotFound({ reason: `${what} '${id}' not found` });

    return {
        getAllProviders: () => Effect.succeed(providersCatalog),

        getProviderSchema: Effect.fn("ProviderSchemaService.getProviderSchema")(function* (id) {
            const schema = providerSchemasCatalog[id];
            if (!schema) return yield* notFound("Provider schema", id);
            return schema;
        }),

        getCompatibleBuilders: Effect.fn("ProviderSchemaService.getCompatibleBuilders")(function* (providerId) {
            const provider = providersCatalog.find((item) => item.id === providerId);
            if (!provider) return yield* notFound("Provider", providerId);
            return buildersCatalog.filter((builder) => provider.supportedBuilders.includes(builder.id));
        }),

        getAllBuilders: () => Effect.succeed(buildersCatalog),

        getBuilderSchema: Effect.fn("ProviderSchemaService.getBuilderSchema")(function* (id) {
            const schema = builderSchemasCatalog[id];
            if (!schema) return yield* notFound("Builder schema", id);
            return schema;
        }),

        getCompatibleProviders: Effect.fn("ProviderSchemaService.getCompatibleProviders")(function* (builderId) {
            const builder = buildersCatalog.find((item) => item.id === builderId);
            if (!builder) return yield* notFound("Builder", builderId);
            return providersCatalog.filter((provider) => builder.compatibleProviders.includes(provider.id));
        }),

        validateProviderConfig: Effect.fn("ProviderSchemaService.validateProviderConfig")(function* (
            providerId,
            config,
        ) {
            const validator = providerConfigValidators[providerId];
            if (!validator) return yield* notFound("Provider", providerId);
            return validate(validator, config);
        }),

        validateBuilderConfig: Effect.fn("ProviderSchemaService.validateBuilderConfig")(function* (builderId, config) {
            const validator = builderConfigValidators[builderId];
            if (!validator) return yield* notFound("Builder", builderId);
            return validate(validator, config);
        }),
    };
}
