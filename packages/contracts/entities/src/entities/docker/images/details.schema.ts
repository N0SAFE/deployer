import z from 'zod/v4'
import {
  dockerImageSecurityScanSummarySchema,
  dockerVulnerabilityEntrySchema,
} from '../security/scanning/images/scan.schema'

export const dockerImageLayerEntrySchema = z.object({
  id: z.string().min(1),
  instruction: z.string().min(1),
  size: z.string().min(1),
  createdAt: z.string(),
})
export type DockerImageLayerEntry = z.infer<typeof dockerImageLayerEntrySchema>

export const dockerImageRuntimeConfigSchema = z.object({
  env: z.array(z.string()),
  exposedPorts: z.array(z.string()),
  workingDir: z.string().nullable(),
  user: z.string().nullable(),
  entrypoint: z.array(z.string()),
  command: z.array(z.string()),
})
export type DockerImageRuntimeConfig = z.infer<typeof dockerImageRuntimeConfigSchema>

export const dockerImageInspectDetailSchema = z.object({
  imageId: z.string().min(1),
  generatedAt: z.string(),
  registry: z.string().min(1),
  repository: z.string().min(1),
  tag: z.string().nullable(),
  digest: z.string().nullable(),
  sizeBytes: z.number().int().min(0).nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  labels: z.record(z.string(), z.string()),
  architecture: z.string().nullable(),
  os: z.string().nullable(),
  variant: z.string().nullable(),
  author: z.string().nullable(),
  comment: z.string().nullable(),
  dockerVersion: z.string().nullable(),
  rootFsType: z.string().nullable(),
  repoTags: z.array(z.string()),
  repoDigests: z.array(z.string()),
  layers: z.array(dockerImageLayerEntrySchema),
  vulnerabilities: z.array(dockerVulnerabilityEntrySchema),
  scanSummary: dockerImageSecurityScanSummarySchema.nullable().optional(),
  usedByContainerIds: z.array(z.string()),
  runtimeConfig: dockerImageRuntimeConfigSchema,
})
export type DockerImageInspectDetail = z.infer<typeof dockerImageInspectDetailSchema>

export const dockerImageSummarySchema = z.object({
  image: z.string().min(1),
  usageCount: z.number().int().min(0),
  successful: z.number().int().min(0),
  failed: z.number().int().min(0),
  lastSeenAt: z.string(),
})
export type DockerImageSummary = z.infer<typeof dockerImageSummarySchema>
