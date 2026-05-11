import z from 'zod/v4'

export const dockerVulnerabilitySeveritySchema = z.enum(['critical', 'high', 'medium', 'low'])
export type DockerVulnerabilitySeverity = z.infer<typeof dockerVulnerabilitySeveritySchema>

export const dockerVulnerabilityScannerSchema = z.enum(['trivy', 'grype', 'dive'])
export type DockerVulnerabilityScanner = z.infer<typeof dockerVulnerabilityScannerSchema>

export const dockerVulnerabilityEntrySchema = z.object({
  id: z.string().min(1),
  severity: dockerVulnerabilitySeveritySchema,
  packageName: z.string().min(1),
  currentVersion: z.string().min(1),
  fixedVersion: z.string().nullable(),
  description: z.string().min(1),
  layerId: z.string().min(1).optional(),
  layerDigest: z.string().min(1).optional(),
  scannerSources: z.array(dockerVulnerabilityScannerSchema).optional(),
})
export type DockerVulnerabilityEntry = z.infer<typeof dockerVulnerabilityEntrySchema>

export const dockerImageScannerStatusSchema = z.enum(['completed', 'failed', 'unavailable', 'skipped'])
export type DockerImageScannerStatus = z.infer<typeof dockerImageScannerStatusSchema>

export const dockerImageScannerResultSchema = z.object({
  scanner: dockerVulnerabilityScannerSchema,
  status: dockerImageScannerStatusSchema,
  findingsCount: z.number().int().min(0),
  durationMs: z.number().int().min(0).nullable(),
  executedAt: z.string(),
  error: z.string().nullable(),
})
export type DockerImageScannerResult = z.infer<typeof dockerImageScannerResultSchema>

export const dockerImageLayerEfficiencySchema = z.object({
  estimatedWastedBytes: z.number().int().min(0).nullable(),
  estimatedWastedPercent: z.number().min(0).max(100).nullable(),
  efficiencyScore: z.number().min(0).max(100).nullable(),
  notes: z.array(z.string()),
})
export type DockerImageLayerEfficiency = z.infer<typeof dockerImageLayerEfficiencySchema>

export const dockerImageSecurityScanSummarySchema = z.object({
  cached: z.boolean(),
  scannedAt: z.string(),
  totalFindings: z.number().int().min(0),
  scanners: z.array(dockerImageScannerResultSchema),
  layerEfficiency: dockerImageLayerEfficiencySchema.nullable(),
})
export type DockerImageSecurityScanSummary = z.infer<typeof dockerImageSecurityScanSummarySchema>

export const dockerImageSecurityScanStageSchema = z.enum([
  'queued',
  'pulling-scanner',
  'scanning',
  'parsing',
  'merging',
  'completed',
  'error',
])
export type DockerImageSecurityScanStage = z.infer<typeof dockerImageSecurityScanStageSchema>

export const dockerImageSecurityScanEventTypeSchema = z.enum([
  'status',
  'log',
  'result',
  'complete',
  'error',
])
export type DockerImageSecurityScanEventType = z.infer<typeof dockerImageSecurityScanEventTypeSchema>

const dockerImageSecurityScanTimestampSchema = z
  .union([z.string(), z.date()])
  .transform((value) => (typeof value === 'string' ? value : value.toISOString()))

export const dockerImageSecurityScanStatusPayloadSchema = z.object({
  stage: dockerImageSecurityScanStageSchema,
  progress: z.number().int().min(0).max(100).nullable(),
  message: z.string().min(1),
})
export type DockerImageSecurityScanStatusPayload = z.infer<typeof dockerImageSecurityScanStatusPayloadSchema>

export const dockerImageSecurityScanLogPayloadSchema = z.object({
  line: z.string().min(1),
})
export type DockerImageSecurityScanLogPayload = z.infer<typeof dockerImageSecurityScanLogPayloadSchema>

export const dockerImageSecurityScanResultPayloadSchema = z.object({
  scannerResult: dockerImageScannerResultSchema,
})
export type DockerImageSecurityScanResultPayload = z.infer<typeof dockerImageSecurityScanResultPayloadSchema>

export const dockerImageSecurityScanCompletePayloadSchema = z.object({
  scanSummary: dockerImageSecurityScanSummarySchema,
  vulnerabilities: z.array(dockerVulnerabilityEntrySchema),
})
export type DockerImageSecurityScanCompletePayload = z.infer<typeof dockerImageSecurityScanCompletePayloadSchema>

export const dockerImageSecurityScanErrorPayloadSchema = z.object({
  error: z.string().min(1),
  scannerResult: dockerImageScannerResultSchema.nullable().optional(),
})
export type DockerImageSecurityScanErrorPayload = z.infer<typeof dockerImageSecurityScanErrorPayloadSchema>

const dockerImageSecurityScanEventCommonSchema = z.object({
  imageId: z.string().min(1),
  timestamp: dockerImageSecurityScanTimestampSchema,
  stage: dockerImageSecurityScanStageSchema,
  scanner: dockerVulnerabilityScannerSchema.nullable(),
  message: z.string().min(1),
  progress: z.number().int().min(0).max(100).nullable(),
  logLine: z.string().nullable(),
  scannerResult: dockerImageScannerResultSchema.nullable().optional(),
  scanSummary: dockerImageSecurityScanSummarySchema.nullable().optional(),
  vulnerabilities: z.array(dockerVulnerabilityEntrySchema).optional(),
})

const dockerImageSecurityScanStatusEventSchema = dockerImageSecurityScanEventCommonSchema.extend({
  type: z.literal('status'),
  payload: dockerImageSecurityScanStatusPayloadSchema,
})

const dockerImageSecurityScanLogEventSchema = dockerImageSecurityScanEventCommonSchema.extend({
  type: z.literal('log'),
  payload: dockerImageSecurityScanLogPayloadSchema,
})

const dockerImageSecurityScanResultEventSchema = dockerImageSecurityScanEventCommonSchema.extend({
  type: z.literal('result'),
  payload: dockerImageSecurityScanResultPayloadSchema,
})

const dockerImageSecurityScanCompleteEventSchema = dockerImageSecurityScanEventCommonSchema.extend({
  type: z.literal('complete'),
  payload: dockerImageSecurityScanCompletePayloadSchema,
})

const dockerImageSecurityScanErrorEventSchema = dockerImageSecurityScanEventCommonSchema.extend({
  type: z.literal('error'),
  payload: dockerImageSecurityScanErrorPayloadSchema,
})

export const dockerImageSecurityScanEventSchema = z.discriminatedUnion('type', [
  dockerImageSecurityScanStatusEventSchema,
  dockerImageSecurityScanLogEventSchema,
  dockerImageSecurityScanResultEventSchema,
  dockerImageSecurityScanCompleteEventSchema,
  dockerImageSecurityScanErrorEventSchema,
])
export type DockerImageSecurityScanEvent = z.infer<typeof dockerImageSecurityScanEventSchema>
