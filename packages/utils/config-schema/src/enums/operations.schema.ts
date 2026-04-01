import { z } from 'zod'

export const operationsDeploymentStatusSchema = z.enum(['success', 'failed', 'rolled-back', 'in-progress'])
export type OperationsDeploymentStatus = z.infer<typeof operationsDeploymentStatusSchema>

export const incidentSeveritySchema = z.enum(['sev1', 'sev2', 'sev3'])
export type IncidentSeverity = z.infer<typeof incidentSeveritySchema>

export const incidentStatusSchema = z.enum(['open', 'mitigated', 'resolved'])
export type IncidentStatus = z.infer<typeof incidentStatusSchema>

export const notificationChannelSchema = z.enum(['slack', 'email', 'webhook'])
export type NotificationChannel = z.infer<typeof notificationChannelSchema>

export const notificationLevelSchema = z.enum(['info', 'warning', 'critical'])
export type NotificationLevel = z.infer<typeof notificationLevelSchema>
