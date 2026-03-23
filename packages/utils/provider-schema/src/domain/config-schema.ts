import z from "zod/v4";
import { conditionalOperatorSchema, configFieldTypeSchema } from "./enums";

export const configSchemaFieldSchema = z.object({
    key: z.string(),
    label: z.string(),
    description: z.string().optional(),
    schema: z.record(z.string(), z.unknown()),
    type: configFieldTypeSchema,
    required: z.boolean(),
    defaultValue: z.unknown().optional(),
    options: z
        .array(
            z.object({
                label: z.string(),
                value: z.union([z.string(), z.number(), z.boolean()]),
            }),
        )
        .optional(),
    placeholder: z.string().optional(),
    group: z.string().optional(),
    conditional: z
        .object({
            field: z.string(),
            value: z.unknown(),
            operator: conditionalOperatorSchema.optional(),
        })
        .optional(),
    ui: z
        .object({
            order: z.number().optional(),
            fullWidth: z.boolean().optional(),
            inline: z.boolean().optional(),
            icon: z.string().optional(),
        })
        .optional(),
});

export const configSchemaSchema = z.object({
    id: z.string(),
    version: z.string(),
    title: z.string(),
    description: z.string(),
    fields: z.array(configSchemaFieldSchema),
});

export const unknownConfigSchema = z.record(z.string(), z.unknown());