import { route } from "@repo/orpc-utils/builder";
import z from "zod/v4";
import {
    builderMetadataSchema,
    configSchemaSchema,
    providerConfigValidationResultSchema,
    providerMetadataSchema,
    unknownConfigSchema,
} from "./schemas";

export const getAllProvidersContract = route({
    method: "GET",
    path: "/providers",
    summary: "Get all registered providers",
})
    .input(z.object({}))
    .output(
        z.object({
            providers: z.array(providerMetadataSchema),
            total: z.number(),
        }),
    )
    .build();

export const getProviderSchemaContract = route({
    method: "GET",
    path: "/providers/{id}/schema",
    summary: "Get provider configuration schema",
})
    .input((b) => b.params((p) => p`/providers/${p("id", z.string())}/schema`))
    .output(configSchemaSchema)
    .build();

export const getCompatibleBuildersContract = route({
    method: "GET",
    path: "/providers/{providerId}/builders",
    summary: "Get compatible builders for a provider",
})
    .input((b) => b.params((p) => p`/providers/${p("providerId", z.string())}/builders`))
    .output(
        z.object({
            builders: z.array(builderMetadataSchema),
            total: z.number(),
        }),
    )
    .build();

export const getAllBuildersContract = route({
    method: "GET",
    path: "/builders",
    summary: "Get all registered builders",
})
    .input(z.object({}))
    .output(
        z.object({
            builders: z.array(builderMetadataSchema),
            total: z.number(),
        }),
    )
    .build();

export const getBuilderSchemaContract = route({
    method: "GET",
    path: "/builders/{id}/schema",
    summary: "Get builder configuration schema",
})
    .input((b) => b.params((p) => p`/builders/${p("id", z.string())}/schema`))
    .output(configSchemaSchema)
    .build();

export const getCompatibleProvidersContract = route({
    method: "GET",
    path: "/builders/{builderId}/providers",
    summary: "Get compatible providers for a builder",
})
    .input((b) => b.params((p) => p`/builders/${p("builderId", z.string())}/providers`))
    .output(
        z.object({
            providers: z.array(providerMetadataSchema),
            total: z.number(),
        }),
    )
    .build();

export const validateProviderConfigContract = route({
    method: "POST",
    path: "/providers/{providerId}/validate",
    summary: "Validate provider configuration",
    description: "Validate configuration values against provider schema",
})
    .input((b) =>
        b
            .params((p) => p`/providers/${p("providerId", z.string())}/validate`)
            .body(
                z.object({
                    config: unknownConfigSchema,
                }),
            ),
    )
    .output(providerConfigValidationResultSchema)
    .build();

export const validateBuilderConfigContract = route({
    method: "POST",
    path: "/builders/{builderId}/validate",
    summary: "Validate builder configuration",
})
    .input((b) =>
        b
            .params((p) => p`/builders/${p("builderId", z.string())}/validate`)
            .body(
                z.object({
                    config: unknownConfigSchema,
                }),
            ),
    )
    .output(providerConfigValidationResultSchema)
    .build();
