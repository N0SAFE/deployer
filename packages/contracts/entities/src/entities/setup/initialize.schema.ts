import z from 'zod/v4'

export const setupInitializeResultSchema = z.object({
  databaseUrl: z.url().optional(),
  meshNodeUrls: z.array(z.url().or(z.literal('local'))),
})
export type SetupInitializeResult = z.infer<typeof setupInitializeResultSchema>
