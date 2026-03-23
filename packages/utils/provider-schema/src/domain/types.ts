import z from "zod/v4";
import { builderMetadataSchema, providerMetadataSchema } from "./metadata";
import { configSchemaSchema } from "./config-schema";

export type ProviderMetadata = z.infer<typeof providerMetadataSchema>;
export type BuilderMetadata = z.infer<typeof builderMetadataSchema>;
export type ConfigSchema = z.infer<typeof configSchemaSchema>;