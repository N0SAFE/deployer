"use client";

/**
 * Project Domain - Client Hooks
 *
 * React hooks for project management with automatic cache invalidation.
 */


import { useQuery, useMutation } from '@tanstack/react-query'
import { projectEndpoints } from './endpoints'
import { projectInvalidations } from './invalidations'
import { wrapWithInvalidations } from '../shared/helpers'

const enhancedProject = wrapWithInvalidations(projectEndpoints, projectInvalidations)

// ============================================================================
// QUERY HOOKS
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Only fetch when the id is a real UUID — never a `:id` route-template placeholder. */
function isProjectIdUsable(id: string | undefined | null): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}

export function useProjectList(
  input: Parameters<typeof projectEndpoints.list.call>[0],
) {
  return useQuery(projectEndpoints.list.queryOptions({ input }))
}

export function useProject(projectId: string) {
  return useQuery({
    ...projectEndpoints.findById.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

export function useProjectCollaborators(projectId: string) {
  return useQuery({
    ...projectEndpoints.getCollaborators.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

export function useProjectEnvironments(projectId: string) {
  return useQuery({
    ...projectEndpoints.listEnvironments.queryOptions({ input: { params: { id: projectId }, query: {} } }),
    enabled: isProjectIdUsable(projectId),
  })
}

export function useProjectEnvironment(projectId: string, environmentId: string) {
  return useQuery({
    ...projectEndpoints.getEnvironment.queryOptions({
      input: { params: { id: projectId, environmentId } },
    }),
    enabled: isProjectIdUsable(projectId) && isProjectIdUsable(environmentId),
  })
}

export function useProjectServiceEnvironmentLinks(projectId: string) {
  return useQuery({
    ...projectEndpoints.listServiceEnvironmentLinks.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

/** Provider-backed project network config (DNS provider + zone + records). */
export function useProjectNetwork(projectId: string) {
  return useQuery({
    ...projectEndpoints.getNetwork.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

export function useUpdateProjectNetwork() {
  return useMutation(
    projectEndpoints.updateNetwork.mutationOptions({
      onSuccess: enhancedProject.updateNetwork.withInvalidationOnSuccess(),
    }),
  )
}

export function useProjectVariableTemplates(projectId: string) {
  return useQuery({
    ...projectEndpoints.listVariableTemplates.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

export function useProjectGeneralConfig(projectId: string) {
  return useQuery({
    ...projectEndpoints.getGeneralConfig.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

export function useProjectEnvironmentConfig(projectId: string) {
  return useQuery({
    ...projectEndpoints.getEnvironmentConfig.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

export function useProjectDeploymentConfig(projectId: string) {
  return useQuery({
    ...projectEndpoints.getDeploymentConfig.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

export function useProjectSecurityConfig(projectId: string) {
  return useQuery({
    ...projectEndpoints.getSecurityConfig.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

export function useProjectResourceConfig(projectId: string) {
  return useQuery({
    ...projectEndpoints.getResourceConfig.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

export function useProjectNotificationConfig(projectId: string) {
  return useQuery({
    ...projectEndpoints.getNotificationConfig.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

export function useProjectEnvironmentStatus(projectId: string) {
  return useQuery({
    ...projectEndpoints.getAllEnvironmentStatuses.queryOptions({ input: { params: { id: projectId } } }),
    enabled: isProjectIdUsable(projectId),
  })
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useCreateProject() {
  return useMutation(
    projectEndpoints.create.mutationOptions({
      onSuccess: enhancedProject.create.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateProject() {
  return useMutation(
    projectEndpoints.update.mutationOptions({
      onSuccess: enhancedProject.update.withInvalidationOnSuccess(),
    }),
  )
}

export function useDeleteProject() {
  return useMutation(
    projectEndpoints.delete.mutationOptions({
      onSuccess: enhancedProject.delete.withInvalidationOnSuccess(),
    }),
  )
}

export function useInviteProjectCollaborator() {
  return useMutation(
    projectEndpoints.inviteCollaborator.mutationOptions({
      onSuccess: enhancedProject.inviteCollaborator.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateProjectCollaborator() {
  return useMutation(
    projectEndpoints.updateCollaborator.mutationOptions({
      onSuccess: enhancedProject.updateCollaborator.withInvalidationOnSuccess(),
    }),
  )
}

export function useRemoveProjectCollaborator() {
  return useMutation(
    projectEndpoints.removeCollaborator.mutationOptions({
      onSuccess: enhancedProject.removeCollaborator.withInvalidationOnSuccess(),
    }),
  )
}

export function useCreateProjectEnvironment() {
  return useMutation(
    projectEndpoints.createEnvironment.mutationOptions({
      onSuccess: enhancedProject.createEnvironment.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateProjectEnvironment() {
  return useMutation(
    projectEndpoints.updateEnvironment.mutationOptions({
      onSuccess: enhancedProject.updateEnvironment.withInvalidationOnSuccess(),
    }),
  )
}

export function useDeleteProjectEnvironment() {
  return useMutation(
    projectEndpoints.deleteEnvironment.mutationOptions({
      onSuccess: enhancedProject.deleteEnvironment.withInvalidationOnSuccess(),
    }),
  )
}

export function useCloneProjectEnvironment() {
  return useMutation(
    projectEndpoints.cloneEnvironment.mutationOptions({
      onSuccess: enhancedProject.cloneEnvironment.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpsertServiceEnvironmentLink() {
  return useMutation(
    projectEndpoints.upsertServiceEnvironmentLink.mutationOptions({
      onSuccess: enhancedProject.upsertServiceEnvironmentLink.withInvalidationOnSuccess(),
    }),
  )
}

export function useCreateProjectVariableTemplate() {
  return useMutation(
    projectEndpoints.createVariableTemplate.mutationOptions({
      onSuccess: enhancedProject.createVariableTemplate.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateProjectVariableTemplate() {
  return useMutation(
    projectEndpoints.updateVariableTemplate.mutationOptions({
      onSuccess: enhancedProject.updateVariableTemplate.withInvalidationOnSuccess(),
    }),
  )
}

export function useDeleteProjectVariableTemplate() {
  return useMutation(
    projectEndpoints.deleteVariableTemplate.mutationOptions({
      onSuccess: enhancedProject.deleteVariableTemplate.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateProjectGeneralConfig() {
  return useMutation(
    projectEndpoints.updateGeneralConfig.mutationOptions({
      onSuccess: enhancedProject.updateGeneralConfig.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateProjectEnvironmentConfig() {
  return useMutation(
    projectEndpoints.updateEnvironmentConfig.mutationOptions({
      onSuccess: enhancedProject.updateEnvironmentConfig.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateProjectDeploymentConfig() {
  return useMutation(
    projectEndpoints.updateDeploymentConfig.mutationOptions({
      onSuccess: enhancedProject.updateDeploymentConfig.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateProjectSecurityConfig() {
  return useMutation(
    projectEndpoints.updateSecurityConfig.mutationOptions({
      onSuccess: enhancedProject.updateSecurityConfig.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateProjectResourceConfig() {
  return useMutation(
    projectEndpoints.updateResourceConfig.mutationOptions({
      onSuccess: enhancedProject.updateResourceConfig.withInvalidationOnSuccess(),
    }),
  )
}

export function useUpdateProjectNotificationConfig() {
  return useMutation(
    projectEndpoints.updateNotificationConfig.mutationOptions({
      onSuccess: enhancedProject.updateNotificationConfig.withInvalidationOnSuccess(),
    }),
  )
}

export function useRefreshProjectEnvironmentStatus() {
  return useMutation(
    projectEndpoints.refreshEnvironmentStatus.mutationOptions({
      onSuccess: enhancedProject.refreshEnvironmentStatus.withInvalidationOnSuccess(),
    }),
  )
}
