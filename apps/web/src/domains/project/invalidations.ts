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

  updateNetwork: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getNetwork({ input: { params: { id } } }), keys.findById({ input: { params: { id } } }), keys.list()]
      : []
  },

  // Collaborator mutations
  inviteCollaborator: ({ input, keys }) => {
    const projectId = resolveProjectId(input)
    return projectId
      ? [keys.getCollaborators({ input: { params: { id: projectId } } })]
      : []
  },

  updateCollaborator: ({ input, keys }) => {
    const projectId = resolveProjectId(input)
    return projectId
      ? [keys.getCollaborators({ input: { params: { id: projectId } } })]
      : []
  },

  removeCollaborator: ({ input, keys }) => {
    const projectId = resolveProjectId(input)
    return projectId
      ? [keys.getCollaborators({ input: { params: { id: projectId } } })]
      : []
  },

  // Environment mutations
  createEnvironment: ({ input, keys }) => {
    const projectId = resolveProjectId(input)
    return projectId
      ? [keys.listEnvironments({ input: { params: { id: projectId }, query: {} } })]
      : []
  },

  updateEnvironment: ({ input, keys }) => {
    const projectId = resolveProjectId(input)
    return projectId
      ? [keys.listEnvironments({ input: { params: { id: projectId }, query: {} } })]
      : []
  },

  deleteEnvironment: ({ input, keys }) => {
    const projectId = resolveProjectId(input)
    return projectId
      ? [keys.listEnvironments({ input: { params: { id: projectId }, query: {} } })]
      : []
  },

  // Service × environment link mutations
  upsertServiceEnvironmentLink: ({ input, keys }) => {
    const projectId = resolveProjectId(input)
    return projectId
      ? [
          keys.listServiceEnvironmentLinks({ input: { params: { id: projectId } } }),
          keys.listEnvironments({ input: { params: { id: projectId }, query: {} } }),
        ]
      : []
  },

  cloneEnvironment: ({ input, keys }) => {
    const projectId = resolveProjectId(input)
    return projectId
      ? [keys.listEnvironments({ input: { params: { id: projectId }, query: {} } })]
      : []
  },

  // Config mutations — invalidate the specific config + findById for the project
  updateGeneralConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getGeneralConfig({ input: { params: { id } } }), keys.findById({ input: { params: { id } } })]
      : []
  },

  updateEnvironmentConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getEnvironmentConfig({ input: { params: { id } } })]
      : []
  },

  updateDeploymentConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getDeploymentConfig({ input: { params: { id } } })]
      : []
  },

  updateSecurityConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getSecurityConfig({ input: { params: { id } } })]
      : []
  },

  updateResourceConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getResourceConfig({ input: { params: { id } } })]
      : []
  },

  updateNotificationConfig: ({ input, keys }) => {
    const id = resolveProjectId(input)
    return id
      ? [keys.getNotificationConfig({ input: { params: { id } } })]
      : []
  },

  refreshEnvironmentStatus: ({ input, keys }) => {
    const id = resolveProjectId(input)
    const i = input as { environmentId?: string; params?: { environmentId?: string } } | undefined
    const environmentId = i?.environmentId ?? i?.params?.environmentId
    return id
      ? [
          ...(environmentId ? [keys.getEnvironmentStatus({ input: { params: { id, environmentId } } })] : []),
          keys.getAllEnvironmentStatuses({ input: { params: { id } } }),
        ]
      : []
  },

  // Variable template mutations
  createVariableTemplate: ({ input, keys }) => {
    const projectId = resolveProjectId(input)
    return projectId
      ? [keys.listVariableTemplates({ input: { params: { id: projectId } } })]
      : []
  },

  updateVariableTemplate: ({ input, keys }) => {
    const projectId = resolveProjectId(input)
    return projectId
      ? [keys.listVariableTemplates({ input: { params: { id: projectId } } })]
      : []
  },

  deleteVariableTemplate: ({ input, keys }) => {
    const projectId = resolveProjectId(input)
    return projectId
      ? [keys.listVariableTemplates({ input: { params: { id: projectId } } })]
      : []
  },
}

export const projectInvalidations: CallableInvalidationConfig<
  ProjectEndpoints,
  typeof projectInvalidationsConfig
> = defineInvalidations(projectEndpoints, projectInvalidationsConfig)
