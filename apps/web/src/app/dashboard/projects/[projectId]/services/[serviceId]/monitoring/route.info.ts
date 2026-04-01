import { z } from 'zod'

// Auto-generated flags - DO NOT EDIT manually, these are synced by dr:build
export const page = true
export const layout = false
export const Route = {
  name: 'AuthDashboardProjectsProjectIdServicesServiceIdMonitoring',
  params: z.object({
    projectId: z.string(),
    serviceId: z.string(),
  }),
}