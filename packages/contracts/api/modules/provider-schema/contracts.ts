import { standard } from "@repo/orpc-utils";
import z from "zod/v4";
import {
    builderMetadataSchema,
    configSchemaSchema,
    providerConfigValidationResultSchema,
    providerMetadataSchema,
    unknownConfigSchema,
} from "./schemas";

const providerSchemaOps = standard.zod(configSchemaSchema, "providerSchema");
const builderSchemaOps = standard.zod(configSchemaSchema, "builderSchema");
const providerValidationOps = standard.zod(
    providerConfigValidationResultSchema,
    "providerConfigValidation",
);
const builderValidationOps = standard.zod(
    providerConfigValidationResultSchema,
    "builderConfigValidation",
);
const providerMetadataOps = standard.zod(providerMetadataSchema, "providerMetadata");
const builderMetadataOps = standard.zod(builderMetadataSchema, "builderMetadata");

export const getAllProvidersContract = providerMetadataOps
    .list()
    .path("/providers")
    .input(z.object({}))
    .output(
        z.object({
            providers: z.array(providerMetadataSchema),
            total: z.number(),
        }),
    )
    .build();

export const getProviderSchemaContract = providerSchemaOps
    .read({ idFieldName: "id", idSchema: z.string() })
    .input((b) => b.params((p) => p`/providers/${p("id", z.string())}/schema`))
    .output(configSchemaSchema)
    .build();

export const getCompatibleBuildersContract = builderMetadataOps
    .list()
    .input((b) => b.params((p) => p`/providers/${p("providerId", z.string())}/builders`))
    .output(
        z.object({
            builders: z.array(builderMetadataSchema),
            total: z.number(),
        }),
    )
    .build();

export const getAllBuildersContract = builderMetadataOps
    .list()
    .path("/builders")
    .input(z.object({}))
    .output(
        z.object({
            builders: z.array(builderMetadataSchema),
            total: z.number(),
        }),
    )
    .build();

export const getBuilderSchemaContract = builderSchemaOps
    .read({ idFieldName: "id", idSchema: z.string() })
    .input((b) => b.params((p) => p`/builders/${p("id", z.string())}/schema`))
    .output(configSchemaSchema)
    .build();

export const getCompatibleProvidersContract = providerMetadataOps
    .list()
    .input((b) => b.params((p) => p`/builders/${p("builderId", z.string())}/providers`))
    .output(
        z.object({
            providers: z.array(providerMetadataSchema),
            total: z.number(),
        }),
    )
    .build();

export const validateProviderConfigContract = providerValidationOps
    .create()
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

export const validateBuilderConfigContract = builderValidationOps
    .create()
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
