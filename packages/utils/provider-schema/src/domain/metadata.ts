import z from "zod/v4";
import { builderCategorySchema, providerCategorySchema } from "./enums";

export const providerMetadataSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    icon: z.string().optional(),
    category: providerCategorySchema,
    supportedBuilders: z.array(z.string()),
    tags: z.array(z.string()),
});

export const builderMetadataSchema = z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    icon: z.string().optional(),
    category: builderCategorySchema,
    compatibleProviders: z.array(z.string()),
    tags: z.array(z.string()),
});

export const providerConfigValidationResultSchema = z.object({
    valid: z.boolean(),
    errors: z.array(z.string()),
});