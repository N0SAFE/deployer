import z from 'zod'
import {
  dependencyAttachmentModeSchema,
  dependencyHealthGateSchema,
  dependencyRequirementModeSchema,
  dependencyStartupModeSchema,
  envNameSchema,
} from '@repo/contracts-common'
import { ALL_FILTER_OPERATORS, type FilterOperator } from '@repo/orpc-utils'

const serviceEnvironmentDependencyBehaviorSchema = z.object({
  requirement: dependencyRequirementModeSchema,
  healthGate: dependencyHealthGateSchema,
  startupMode: dependencyStartupModeSchema,
  attachmentMode: dependencyAttachmentModeSchema,
  targetSelection: z
    .object({
      strategy: z.enum(['filter-first', 'direct-only', 'preferred-then-filter']).default('filter-first'),
      directServiceId: z.string().optional(),
      filter: z.lazy(() => dependencyTargetFilterNodeSchema).optional(),
    })
    .default({ strategy: 'filter-first' })
    .superRefine((selection, ctx) => {
      if (selection.strategy === 'direct-only' && !selection.directServiceId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['directServiceId'],
          message: 'direct-only strategy requires directServiceId.',
        })
      }

      if (selection.strategy === 'filter-first' && !selection.filter) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['filter'],
          message: 'filter-first strategy requires a filter definition.',
        })
      }

      if (selection.strategy === 'preferred-then-filter' && !selection.directServiceId && !selection.filter) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['strategy'],
          message: 'preferred-then-filter requires directServiceId, filter, or both.',
        })
      }
    }),
})

const dependencyFilterInputSourceSchema = z.enum([
  'project-environment',
  'source-service-environment',
  'source-service-provider-tags',
  'source-service-input',
  'target-service-tags',
  'target-service-provider-tags',
  'target-service-metadata',
  'runtime-input',
])
export type DependencyFilterInputSource = z.infer<typeof dependencyFilterInputSourceSchema>

const dependencyFilterOperatorSchema = z.enum(ALL_FILTER_OPERATORS)
export type DependencyFilterOperator = z.infer<typeof dependencyFilterOperatorSchema>

const dependencyTargetFilterConditionSchema = z
  .object({
    source: dependencyFilterInputSourceSchema,
    key: z.string().min(1),
    operator: dependencyFilterOperatorSchema,
    value: z.union([z.string(), z.array(z.string())]).optional(),
    valuesFromInputKey: z.string().min(1).optional(),
  })
  .superRefine((condition, ctx) => {
    const nullaryOperators: FilterOperator[] = ['isNull', 'isNotNull']
    const listOperators: FilterOperator[] = ['in', 'notIn', 'contains']

    const hasStaticValue = condition.value !== undefined
    const hasInputValue = condition.valuesFromInputKey !== undefined

    if (hasStaticValue && hasInputValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['valuesFromInputKey'],
        message: 'Provide either value or valuesFromInputKey, not both.',
      })
    }

    if (nullaryOperators.includes(condition.operator)) {
      if (hasStaticValue || hasInputValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: `${condition.operator} does not accept value inputs.`,
        })
      }
      return
    }

    if (!hasStaticValue && !hasInputValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `Operator ${condition.operator} requires value or valuesFromInputKey.`,
      })
      return
    }

    if (hasStaticValue && listOperators.includes(condition.operator) && !Array.isArray(condition.value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: `Operator ${condition.operator} requires an array value.`,
      })
    }
  })

const dependencyTargetFilterBuilderSchema = z.object({
  mode: z.literal('builder'),
  all: z.array(z.lazy(() => dependencyTargetFilterNodeSchema)).default([]),
  any: z.array(z.lazy(() => dependencyTargetFilterNodeSchema)).default([]),
  not: z.array(z.lazy(() => dependencyTargetFilterNodeSchema)).default([]),
  minShouldMatch: z.number().int().positive().optional(),
})

const dependencyTargetFilterNodeSchema: z.ZodType = z.union([
  dependencyTargetFilterConditionSchema,
  dependencyTargetFilterBuilderSchema,
])

export const serviceDependencyTargetFilterSchema = dependencyTargetFilterNodeSchema
export type ServiceDependencyTargetFilter = z.infer<typeof serviceDependencyTargetFilterSchema>

const dependencyLinkTargetSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('same-environment'),
  }),
  z.object({
    mode: z.literal('fixed-environment'),
    targetEnvironment: envNameSchema,
  }),
  z.object({
    mode: z.literal('derived-environment'),
    fromInputKey: z.string().min(1),
    fallbackEnvironment: envNameSchema,
  }),
])
export type DependencyLinkTarget = z.infer<typeof dependencyLinkTargetSchema>

const dependencyInstanceProvisioningSchema = z.discriminatedUnion('provisioningMode', [
  z.object({
    provisioningMode: z.literal('shared-service'),
    sharingScope: z.enum(['project', 'environment', 'organization']),
    reuseKey: z.string().min(1),
    allowAttachAllTargets: z.boolean().default(false),
    noMatchPolicy: z.enum(['create-new-instance', 'fail']).default('create-new-instance'),
  }),
  z.object({
    provisioningMode: z.literal('per-source-instance'),
    instanceNameTemplate: z.string().min(1),
    maxInstancesPerEnvironment: z.number().int().positive().optional(),
    noMatchPolicy: z.enum(['create-new-instance', 'fail']).default('create-new-instance'),
  }),
  z.object({
    provisioningMode: z.literal('on-demand-pool'),
    poolRef: z.string().min(1),
    warmInstances: z.number().int().nonnegative().default(0),
    scaleToZeroAfterSeconds: z.number().int().positive().optional(),
    noMatchPolicy: z.enum(['create-new-instance', 'fail']).default('create-new-instance'),
  }),
])
export type DependencyInstanceProvisioning = z.infer<typeof dependencyInstanceProvisioningSchema>

export const serviceDependencyLinkPolicySchema = z
  .object({
    target: dependencyLinkTargetSchema,
    provisioning: dependencyInstanceProvisioningSchema,
  })
  .superRefine((policy, ctx) => {
    if (policy.target.mode === 'same-environment' && policy.provisioning.provisioningMode === 'shared-service') {
      if (policy.provisioning.sharingScope === 'organization') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['provisioning', 'sharingScope'],
          message: 'same-environment target cannot use organization sharing scope.',
        })
      }
    }
  })
export type ServiceDependencyLinkPolicy = z.infer<typeof serviceDependencyLinkPolicySchema>

export {
  serviceEnvironmentDependencyBehaviorSchema,
}
