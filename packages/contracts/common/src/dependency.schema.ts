import { z } from 'zod'

export const dependencyRequirementSchema = z.enum(['required', 'optional'])
export type DependencyRequirement = z.infer<typeof dependencyRequirementSchema>

export const dependencyRequirementModeSchema = z.enum(['required', 'optional', 'disabled'])
export type DependencyRequirementMode = z.infer<typeof dependencyRequirementModeSchema>

export const dependencyHealthGateSchema = z.enum(['must-pass', 'warn', 'ignore'])
export type DependencyHealthGate = z.infer<typeof dependencyHealthGateSchema>

export const dependencyStartupModeSchema = z.enum(['before', 'parallel', 'after'])
export type DependencyStartupMode = z.infer<typeof dependencyStartupModeSchema>

export const dependencyAttachmentModeSchema = z.enum(['single-target', 'multi-target-filtered'])
export type DependencyAttachmentMode = z.infer<typeof dependencyAttachmentModeSchema>

export const dependencySelectionOrderSchema = z.enum([
  'health-first',
  'latency-first',
  'env-affinity',
  'shared-env-match',
  'tag-priority',
])
export type DependencySelectionOrder = z.infer<typeof dependencySelectionOrderSchema>

export const dependencyFailureModeSchema = z.enum(['fail-fast', 'degraded', 'queue'])
export type DependencyFailureMode = z.infer<typeof dependencyFailureModeSchema>

export const dependencyEnvironmentDiffStatusSchema = z.enum(['added', 'removed', 'changed', 'same'])
export type DependencyEnvironmentDiffStatus = z.infer<typeof dependencyEnvironmentDiffStatusSchema>
