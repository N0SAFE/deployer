import z from 'zod/v4'

export const nodeConfigStatusSchema = z.object({
  /** Whether a node config row exists with a bootstrap snapshot */
  isConfigured: z.boolean(),
  meshUrlsSnapshot: z.array(z.string()),
  nodeId: z.uuid(),
  configuredAt: z.date(),
})
export type NodeConfigStatus = z.infer<typeof nodeConfigStatusSchema>
