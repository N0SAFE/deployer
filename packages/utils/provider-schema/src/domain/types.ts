import z from "zod/v4";
import { builderMetadataSchema, providerMetadataSchema } from "@repo/provider-schema/domain/metadata";
import { configSchemaSchema } from "@repo/provider-schema/domain/config-schema";

export type ProviderMetadata = z.infer<typeof providerMetadataSchema>;
export type BuilderMetadata = z.infer<typeof builderMetadataSchema>;
export type ConfigSchema = z.infer<typeof configSchemaSchema>;