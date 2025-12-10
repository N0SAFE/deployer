/**
 * Hooks Index - Barrel export for all custom hooks
 *
 * This file provides a centralized export point for all hooks in the application.
 * Following the ORPC Client Hooks Pattern from the project's core concepts.
 *
 * @see .docs/core-concepts/11-ORPC-CLIENT-HOOKS-PATTERN.md
 */

// ============================================================================
// Authentication Hooks
// ============================================================================
export * from './useAuth'

// ============================================================================
// Organization Hooks (Better Auth Organization Plugin)
// ============================================================================
export {
  // Query hooks
  useOrganizations,
  useActiveOrganization,
  useOrganization,
  useOrganizationMembers,
  useOrganizationInvitations,
  // Async functions
  getFullOrganization,
  getOrganizationMembers,
  getOrganizationInvitations,
  // Mutation hooks
  useCreateOrganization,
  useUpdateOrganization,
  useDeleteOrganization,
  useSetActiveOrganization,
  useInviteMember,
  useRemoveMember,
  useUpdateMemberRole,
  useAcceptInvitation,
  useRejectInvitation,
  useCancelInvitation,
  useLeaveOrganization,
  // Query keys
  organizationKeys,
  // Types (re-exported from better-auth)
  type Organization,
  type Member,
} from './useOrganizations'

// ============================================================================
// Team Hooks (Better Auth Teams - Organization Plugin)
// ============================================================================
export {
  // Query hooks
  useTeams,
  useUserTeams,
  useTeamMembers,
  // Async functions
  getOrganizationTeams,
  getUserTeams,
  getTeamMembers,
  // Mutation hooks
  useCreateTeam,
  useUpdateTeam,
  useDeleteTeam,
  useSetActiveTeam,
  useAddTeamMember,
  useRemoveTeamMember,
  // Composite utility hooks
  useTeamActions,
  useTeamAdministration,
  // Query keys
  teamKeys,
} from './useTeams'

// ============================================================================
// Project Hooks
// ============================================================================
export * from './useProjects'
export * from './useProjectDetail'

// ============================================================================
// Deployment Hooks
// ============================================================================
export * from './useDeployments'
export * from './useDeploymentDetail'

// ============================================================================
// Service Hooks
// ============================================================================
export {
  // Query hooks
  useServices,
  useService,
  useServiceDeployments,
  useServiceDependencies,
  useServiceLogs,
  useServiceMetrics,
  useServiceHealth,
  useProjectDependencyGraph,
  // Async functions
  getServices,
  getService,
  getProjectDependencyGraph,
  // Mutation hooks
  useCreateService,
  useUpdateService,
  useDeleteService,
  useToggleServiceActive,
  useAddServiceDependency,
  useRemoveServiceDependency,
  // Composite utility hooks
  useServiceActions,
  useServiceAdministration,
  // Query keys
  serviceKeys,
  // Types
  type Service,
  type ServiceWithStats,
  type CreateServiceInput,
  type UpdateServiceInput,
  type DependencyGraph,
} from './useServices'

// ============================================================================
// Health Monitoring Hooks
// ============================================================================
export * from './useHealth'

// ============================================================================
// User Hooks
// ============================================================================
export * from './useUsers'

// ============================================================================
// Real-time Hooks
// ============================================================================
export * from './useWebSocket'
export * from './usePushNotifications'
