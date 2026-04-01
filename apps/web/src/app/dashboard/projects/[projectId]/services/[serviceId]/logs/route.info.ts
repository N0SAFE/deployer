import { z } from 'zod'

// Auto-generated flags - DO NOT EDIT manually, these are synced by dr:build
export const page = true
export const layout = false
export const Route = {
  name: 'AuthDashboardProjectsProjectIdServicesServiceIdLogs',
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  }),
  search: z.object({
    replicas: z.string().optional(),
    deploymentId: z.string().optional(),
    replicaId: z.string().optional(),
    source: z.enum(['deployment', 'replica', 'mesh']).optional(),
  }),
}