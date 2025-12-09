import { z } from 'zod';
// Shared environment and variable schemas used across modules
// Environment type schema
export const environmentTypeSchema = z.enum(['production', 'staging', 'preview']);
// Environment variable schema
export const environmentVariableSchema = z.object({
    key: z.string().min(1),
    value: z.string(),
    isSecret: z.boolean().default(false),
    description: z.string().optional(),
});
// Dynamic variable schema
export const dynamicVariableSchema = z.object({
    key: z.string().min(1),
    template: z.string().min(1), // Template with variable references like "${project.name}-${environment.type}"
    description: z.string().optional(),
    isSecret: z.boolean().default(false),
    dependencies: z.array(z.string()).default([]), // List of variable keys this depends on
});
// Variable definition schema
export const variableDefinitionSchema = z.object({
    name: z.string().min(1),
    type: z.enum(['string', 'number', 'boolean', 'url', 'json']).default('string'),
    description: z.string().optional(),
    defaultValue: z.string().optional(),
    required: z.boolean().default(false),
    validation: z.object({
        pattern: z.string().optional(), // Regex pattern
        minLength: z.number().optional(),
        maxLength: z.number().optional(),
        allowedValues: z.array(z.string()).optional(),
    }).optional(),
});
// Variable template schemas
export const createVariableTemplateSchema = z.object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    tags: z.array(z.string()).default([]),
    variables: z.array(dynamicVariableSchema).default([]),
    variableDefinitions: z.array(variableDefinitionSchema).default([]),
    isGlobal: z.boolean().default(false),
});
export const updateVariableTemplateSchema = createVariableTemplateSchema.partial();
// Type exports
export type EnvironmentType = z.infer<typeof environmentTypeSchema>;
export type EnvironmentVariable = z.infer<typeof environmentVariableSchema>;
export type DynamicVariable = z.infer<typeof dynamicVariableSchema>;
export type VariableDefinition = z.infer<typeof variableDefinitionSchema>;
export type CreateVariableTemplate = z.infer<typeof createVariableTemplateSchema>;
export type UpdateVariableTemplate = z.infer<typeof updateVariableTemplateSchema>;
