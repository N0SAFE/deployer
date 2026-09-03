import z from 'zod/v4'

export const templateVariableSchema = z.object({
  key: z.string(),
  template: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  required: z.boolean().default(false),
  defaultValue: z.string().nullable(),
})

export const variableTemplateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  variables: z.array(templateVariableSchema),
  isSystem: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
