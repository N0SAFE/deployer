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

export function useProjectList(
  input: Parameters<typeof projectEndpoints.list.call>[0],
) {
  return useQuery(projectEndpoints.list.queryOptions({ input }))
}

export function useProject(projectId: string) {
  return useQuery(
    projectEndpoints.findById.queryOptions({ input: { params: { id: projectId }, id: projectId } }),
  )
}

export function useProjectCollaborators(projectId: string) {
  return useQuery(
    projectEndpoints.getCollaborators.queryOptions({ input: { params: { id: projectId }, id: projectId } }),
  )
}

export function useProjectEnvironments(projectId: string) {
  return useQuery(
    projectEndpoints.listEnvironments.queryOptions({ input: { params: { id: projectId }, id: projectId } }),
  )
}

export function useProjectEnvironment(projectId: string, environmentId: string) {
  return useQuery(
    projectEndpoints.getEnvironment.queryOptions({
      input: { params: { id: projectId, environmentId }, id: projectId, environmentId },
    }),
  )
}

export function useProjectVariableTemplates(projectId: string) {
  return useQuery(
    projectEndpoints.listVariableTemplates.queryOptions({ input: { params: { id: projectId }, id: projectId } }),
  )
}

export function useProjectGeneralConfig(projectId: string) {
  return useQuery(
    projectEndpoints.getGeneralConfig.queryOptions({ input: { params: { id: projectId }, id: projectId } }),
  )
}

export function useProjectEnvironmentConfig(projectId: string) {
  return useQuery(
    projectEndpoints.getEnvironmentConfig.queryOptions({ input: { params: { id: projectId }, id: projectId } }),
  )
}

export function useProjectDeploymentConfig(projectId: string) {
  return useQuery(
    projectEndpoints.getDeploymentConfig.queryOptions({ input: { params: { id: projectId }, id: projectId } }),
  )
}

export function useProjectSecurityConfig(projectId: string) {
  return useQuery(
    projectEndpoints.getSecurityConfig.queryOptions({ input: { params: { id: projectId }, id: projectId } }),
  )
}

export function useProjectResourceConfig(projectId: string) {
  return useQuery(
    projectEndpoints.getResourceConfig.queryOptions({ input: { params: { id: projectId }, id: projectId } }),
  )
}

export function useProjectNotificationConfig(projectId: string) {
  return useQuery(
    projectEndpoints.getNotificationConfig.queryOptions({ input: { params: { id: projectId }, id: projectId } }),
  )
}

export function useProjectEnvironmentStatus(projectId: string) {
  return useQuery(
    projectEndpoints.getAllEnvironmentStatuses.queryOptions({ input: { params: { id: projectId }, id: projectId } }),
  )
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
