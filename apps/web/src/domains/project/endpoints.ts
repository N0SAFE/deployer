import { orpc } from '@/lib/orpc'

/**
 * Project domain endpoints
 *
 * All project endpoints use ORPC contracts directly.
 */
export const projectEndpoints = {
  // Core CRUD
  list: orpc.project.list,
  findById: orpc.project.findById,
  create: orpc.project.create,
  update: orpc.project.update,
  delete: orpc.project.delete,

  // Collaborators
  getCollaborators: orpc.project.getCollaborators,
  inviteCollaborator: orpc.project.inviteCollaborator,
  updateCollaborator: orpc.project.updateCollaborator,
  removeCollaborator: orpc.project.removeCollaborator,

  // Environments
  listEnvironments: orpc.project.listEnvironments,
  getEnvironment: orpc.project.getEnvironment,
  createEnvironment: orpc.project.createEnvironment,
  updateEnvironment: orpc.project.updateEnvironment,
  deleteEnvironment: orpc.project.deleteEnvironment,
  cloneEnvironment: orpc.project.cloneEnvironment,

  // Variable templates
  listVariableTemplates: orpc.project.listVariableTemplates,
  getVariableTemplate: orpc.project.getVariableTemplate,
  createVariableTemplate: orpc.project.createVariableTemplate,
  updateVariableTemplate: orpc.project.updateVariableTemplate,
  deleteVariableTemplate: orpc.project.deleteVariableTemplate,

  // Configuration
  getGeneralConfig: orpc.project.getGeneralConfig,
  updateGeneralConfig: orpc.project.updateGeneralConfig,
  getEnvironmentConfig: orpc.project.getEnvironmentConfig,
  updateEnvironmentConfig: orpc.project.updateEnvironmentConfig,
  getDeploymentConfig: orpc.project.getDeploymentConfig,
  updateDeploymentConfig: orpc.project.updateDeploymentConfig,
  getSecurityConfig: orpc.project.getSecurityConfig,
  updateSecurityConfig: orpc.project.updateSecurityConfig,
  getResourceConfig: orpc.project.getResourceConfig,
  updateResourceConfig: orpc.project.updateResourceConfig,
  getNotificationConfig: orpc.project.getNotificationConfig,
  updateNotificationConfig: orpc.project.updateNotificationConfig,

  // Variable resolution and environment status
  resolveVariables: orpc.project.resolveVariables,
  getAvailableVariables: orpc.project.getAvailableVariables,
  getEnvironmentStatus: orpc.project.getEnvironmentStatus,
  getAllEnvironmentStatuses: orpc.project.getAllEnvironmentStatuses,
  refreshEnvironmentStatus: orpc.project.refreshEnvironmentStatus,

  // Streaming
  streamQuery: orpc.project.streamQuery,
} as const

export type ProjectEndpoints = typeof projectEndpoints
