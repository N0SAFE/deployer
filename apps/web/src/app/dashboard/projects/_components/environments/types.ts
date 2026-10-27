import type { z } from 'zod/v4'
import type { projectEnvironmentSchema, variableTemplateSchema } from '@deployer/contracts-entities'

export type ProjectEnvironment = z.infer<typeof projectEnvironmentSchema>
export type VariableTemplate = z.infer<typeof variableTemplateSchema>

export interface ServiceEnvLink {
  serviceId: string
  environmentId: string
  isEnabled: boolean
}

export interface ProjectServiceRow {
  id: string
  name: string
  parentId?: string | null
}

export const envLinkKey = (serviceId: string, environmentId: string): string => `${serviceId}:${environmentId}`

/** Badge variant for an environment kind; kind is also always written as text. */
export function kindBadgeVariant(kind: string): 'secondary' | 'outline' | 'default' {
  if (kind === 'preview') return 'secondary'
  if (kind === 'ephemeral') return 'outline'
  return 'default'
}
