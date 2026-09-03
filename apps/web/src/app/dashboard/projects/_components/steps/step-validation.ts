'use client'

import type { z } from 'zod/v4'
import { wizardSchema, providerSchema, runnerSchema, buildMethodSchema } from '../CreateService.hook'

/**
 * Per-step validation for the create-service wizard.
 *
 * Each step validates ONLY its own slice of the form against the shared Zod
 * schemas. The Next button is disabled when the current step is invalid, and
 * the first blocking issue is surfaced inline. This keeps the flow honest:
 * you cannot advance past a step that wouldn't submit.
 */

type WizardValues = z.input<typeof wizardSchema>

export interface StepValidation {
  valid: boolean
  /** Human-readable blocking issues (first one shown next to Next). */
  issues: string[]
}

function issuesFrom(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value)
  if (result.success) return []
  return result.error.issues.map((issue) => {
    const path = issue.path.join('.') || '(form)'
    return `${path}: ${issue.message}`
  })
}

/**
 * Validate the form slice belonging to a step id (1–9, matching ALL_STEPS).
 * Steps that are purely optional (Advanced, Domains) always pass.
 */
export function validateStep(values: WizardValues, stepId: number): StepValidation {
  switch (stepId) {
    case 1:
      return { valid: wizardSchema.shape.basicInfo.safeParse(values.basicInfo).success, issues: issuesFrom(wizardSchema.shape.basicInfo, values.basicInfo) }
    case 2:
      return { valid: providerSchema.safeParse(values.provider).success, issues: issuesFrom(providerSchema, values.provider) }
    case 3:
      return { valid: buildMethodSchema.safeParse(values.runner.build).success, issues: issuesFrom(buildMethodSchema, values.runner.build) }
    case 4:
    case 5:
      return { valid: runnerSchema.safeParse(values.runner).success, issues: issuesFrom(runnerSchema, values.runner) }
    case 6:
      return { valid: wizardSchema.shape.network.safeParse(values.network).success, issues: issuesFrom(wizardSchema.shape.network, values.network) }
    case 7: // Domains — fully optional
      return { valid: true, issues: [] }
    case 8: // Advanced — fully optional
      return { valid: true, issues: [] }
    case 9:
      return { valid: wizardSchema.safeParse(values).success, issues: issuesFrom(wizardSchema, values) }
    default:
      return { valid: true, issues: [] }
  }
}
