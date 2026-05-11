import z from 'zod/v4'

export const dockerNetworkSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  projectId: z.string().min(1),
  serviceCount: z.number().int().min(0),
  activeServiceCount: z.number().int().min(0),
  exposedDomains: z.array(z.string()),
})
export type DockerNetworkSummary = z.infer<typeof dockerNetworkSummarySchema>

export const dockerNetworkDiagnosticsSchema = z.object({
  dnsResolution: z.enum(['ok', 'degraded']),
  connectivityScore: z.number().min(0).max(100),
  notes: z.array(z.string()),
})
export type DockerNetworkDiagnostics = z.infer<typeof dockerNetworkDiagnosticsSchema>