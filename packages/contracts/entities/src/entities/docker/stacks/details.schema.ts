import z from 'zod/v4'

export const dockerStackSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  projectId: z.string().min(1),
  serviceCount: z.number().int().min(0),
  activeServices: z.number().int().min(0),
  latestDeploymentStatus: z.string().nullable(),
  deploymentCount: z.number().int().min(0),
})
export type DockerStackSummary = z.infer<typeof dockerStackSummarySchema>

export const dockerStackGraphNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.string().min(1),
})
export type DockerStackGraphNode = z.infer<typeof dockerStackGraphNodeSchema>

export const dockerStackGraphEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.string().min(1),
})
export type DockerStackGraphEdge = z.infer<typeof dockerStackGraphEdgeSchema>

export const dockerStackServiceGraphSchema = z.object({
  nodes: z.array(dockerStackGraphNodeSchema),
  edges: z.array(dockerStackGraphEdgeSchema),
})
export type DockerStackServiceGraph = z.infer<typeof dockerStackServiceGraphSchema>

export const dockerStackActivityStatusSchema = z.enum(['success', 'failed', 'pending'])
export type DockerStackActivityStatus = z.infer<typeof dockerStackActivityStatusSchema>

export const dockerStackActivityEntrySchema = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
  status: dockerStackActivityStatusSchema,
  timestamp: z.string(),
})
export type DockerStackActivityEntry = z.infer<typeof dockerStackActivityEntrySchema>

export const dockerStackLogLevelSchema = z.enum(['info', 'warn', 'error'])
export type DockerStackLogLevel = z.infer<typeof dockerStackLogLevelSchema>

export const dockerStackLogEntrySchema = z.object({
  id: z.string().min(1),
  service: z.string().min(1),
  level: dockerStackLogLevelSchema,
  message: z.string().min(1),
  timestamp: z.string(),
})
export type DockerStackLogEntry = z.infer<typeof dockerStackLogEntrySchema>

export const dockerStackGitWebhookStatusSchema = z.enum(['configured', 'missing', 'error'])
export type DockerStackGitWebhookStatus = z.infer<typeof dockerStackGitWebhookStatusSchema>

export const dockerStackGitSyncStateSchema = z.object({
  repositoryUrl: z.string().min(1),
  branch: z.string().min(1),
  lastCommit: z.string().min(1),
  lastSyncAt: z.string(),
  autoDeployOnPush: z.boolean(),
  webhookStatus: dockerStackGitWebhookStatusSchema,
})
export type DockerStackGitSyncState = z.infer<typeof dockerStackGitSyncStateSchema>