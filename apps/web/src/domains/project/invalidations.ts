/**
 * Project Domain - Cache Invalidation Configuration
 */

import {
  defineInvalidations,
  type CallableInvalidationConfig,
  type InvalidationConfig,
} from '../shared/helpers'
import { projectEndpoints } from './endpoints'

type ProjectEndpoints = typeof projectEndpoints

function resolveProjectId(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const c = input as { id?: string; params?: { id?: string } }
  return c.id ?? c.params?.id
}

const projectInvalidationsConfig: InvalidationConfig<ProjectEndpoints> = {
  create: ({ keys }) => [keys.list()],

  update: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.findById({ input: { params: { id } } }), keys.list()]
      : [keys.list()]
  },

  delete: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.findById({ input: { params: { id } } }), keys.list()]
      : [keys.list()]
  },

  // Collaborator mutations
  inviteCollaborator: ({ input, keys }) => {
    const projectId = (input as { projectId?: string } | undefined)?.projectId
    return projectId
      ? [keys.getCollaborators({ input: { id: projectId } })]
      : []
  },

  updateCollaborator: ({ input, keys }) => {
    const projectId = (input as { projectId?: string } | undefined)?.projectId
    return projectId
      ? [keys.getCollaborators({ input: { id: projectId } })]
      : []
  },

  removeCollaborator: ({ input, keys }) => {
    const projectId = (input as { projectId?: string } | undefined)?.projectId
    return projectId
      ? [keys.getCollaborators({ input: { id: projectId } })]
      : []
  },

  // Environment mutations
  createEnvironment: ({ input, keys }) => {
    const projectId = (input as { params?: { id?: string } } | undefined)?.params?.id
    return projectId
      ? [keys.listEnvironments({ input: { id: projectId } })]
      : []
  },

  updateEnvironment: ({ input, keys }) => {
    const projectId = (input as { params?: { id?: string } } | undefined)?.params?.id
    return projectId
      ? [keys.listEnvironments({ input: { id: projectId } })]
      : []
  },

  deleteEnvironment: ({ input, keys }) => {
    const projectId = (input as { params?: { id?: string } } | undefined)?.params?.id
    return projectId
      ? [keys.listEnvironments({ input: { id: projectId } })]
      : []
  },

  cloneEnvironment: ({ input, keys }) => {
    const projectId = (input as { params?: { id?: string } } | undefined)?.params?.id
    return projectId
      ? [keys.listEnvironments({ input: { id: projectId } })]
      : []
  },

  // Variable template mutations
  createVariableTemplate: ({ input, keys }) => {
    const projectId = (input as { params?: { id?: string } } | undefined)?.params?.id
    return projectId
      ? [keys.listVariableTemplates({ input: { id: projectId } })]
      : []
  },

  updateVariableTemplate: ({ input, keys }) => {
    const projectId = (input as { params?: { id?: string } } | undefined)?.params?.id
    return projectId
      ? [keys.listVariableTemplates({ input: { id: projectId } })]
      : []
  },

  deleteVariableTemplate: ({ input, keys }) => {
    const projectId = (input as { params?: { id?: string } } | undefined)?.params?.id
    return projectId
      ? [keys.listVariableTemplates({ input: { id: projectId } })]
      : []
  },

  // Config mutations — invalidate the specific config + findById for the project
  updateGeneralConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getGeneralConfig({ input: { id } }), keys.findById({ input: { params: { id } } })]
      : []
  },

  updateEnvironmentConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getEnvironmentConfig({ input: { id } })]
      : []
  },

  updateDeploymentConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getDeploymentConfig({ input: { id } })]
      : []
  },

  updateSecurityConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getSecurityConfig({ input: { id } })]
      : []
  },

  updateResourceConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getResourceConfig({ input: { id } })]
      : []
  },

  updateNotificationConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getNotificationConfig({ input: { id } })]
      : []
  },

  refreshEnvironmentStatus: ({ input, keys }) => {
    const id = resolveProjectId(input)
    const i = input as { environmentId?: string; params?: { environmentId?: string } } | undefined
    const environmentId = i?.environmentId ?? i?.params?.environmentId
    return id
      ? [
          ...(environmentId ? [keys.getEnvironmentStatus({ input: { id, environmentId } })] : []),
          keys.getAllEnvironmentStatuses({ input: { id } }),
        ]
      : []
  },
}

export const projectInvalidations: CallableInvalidationConfig<
  ProjectEndpoints,
  typeof projectInvalidationsConfig
> = defineInvalidations(projectEndpoints, projectInvalidationsConfig)
