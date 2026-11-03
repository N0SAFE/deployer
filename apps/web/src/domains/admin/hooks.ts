"use client";


/**
 * Admin Domain - Client Hooks
 *
 * React hooks for administrative operations using Better Auth's Admin plugin.
 * Uses the custom contract system with automatic cache invalidation.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE, getErrorMessage } from "@/lib/orpc/typed-errors";

import { wrapWithInvalidations } from "../shared/helpers";

import { adminEndpoints } from "./endpoints";
import { adminInvalidations } from "./invalidations";



// ============================================================================
// ENHANCED ENDPOINTS WITH INVALIDATIONS
// ============================================================================

/**
 * Admin endpoints enhanced with automatic cache invalidation
 */
const enhancedAdmin = wrapWithInvalidations(adminEndpoints, adminInvalidations);

// ============================================================================
// QUERY HOOKS (Read Operations)
// ============================================================================

/**
 * List users with pagination
 */
export function useAdminListUsers(options?: {
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDirection?: "asc" | "desc";
  enabled?: boolean;
}) {
  return useQuery(
    enhancedAdmin.listUsers.queryOptions({
      input: {
        query: {
          limit: options?.limit,
          offset: options?.offset,
          sortBy: options?.sortBy,
          sortDirection: options?.sortDirection,
        },
      },
      enabled: options?.enabled ?? true,
      staleTime: 1000 * 60 * 2, // 2 minutes
      gcTime: 1000 * 60 * 10, // 10 minutes
    }),
  );
}

// ============================================================================
// MUTATION HOOKS (Write Operations)
// ============================================================================

/**
 * Ban a user
 */
export function useAdminBanUser() {
  return useMutation(
    enhancedAdmin.banUser.mutationOptions({
      onSuccess: enhancedAdmin.banUser.withInvalidationOnSuccess(() => {
        toast.success("User banned successfully");
      }),
      onError: (error) => {
        toast.error(isDefinedORPCError(error) ? getErrorMessage(error, 'Failed to ban user') : UNKNOWN_ORPC_ERROR_MESSAGE);
      },
    }),
  );
}

/**
 * Unban a user
 */
export function useAdminUnbanUser() {
  return useMutation(
    enhancedAdmin.unbanUser.mutationOptions({
      onSuccess: enhancedAdmin.unbanUser.withInvalidationOnSuccess(() => {
        toast.success("User unbanned successfully");
      }),
      onError: (error) => {
        toast.error(isDefinedORPCError(error) ? getErrorMessage(error, 'Failed to unban user') : UNKNOWN_ORPC_ERROR_MESSAGE);
      },
    }),
  );
}

/**
 * Set user role
 */
export function useAdminSetRole() {
  return useMutation(
    enhancedAdmin.setRole.mutationOptions({
      onSuccess: enhancedAdmin.setRole.withInvalidationOnSuccess(
        (_, variables) => {
          const roleStr = Array.isArray(variables.role)
            ? variables.role.join(", ")
            : variables.role;
          toast.success(`User role updated to ${roleStr}`);
        },
      ),
      onError: (error) => {
        toast.error(isDefinedORPCError(error) ? getErrorMessage(error, 'Failed to update role') : UNKNOWN_ORPC_ERROR_MESSAGE);
      },
    }),
  );
}

/**
 * Create user
 */
export function useAdminCreateUser() {
  return useMutation(
    enhancedAdmin.createUser.mutationOptions({
      onSuccess: enhancedAdmin.createUser.withInvalidationOnSuccess(() => {
        toast.success("User created successfully");
      }),
      onError: (error) => {
        toast.error(isDefinedORPCError(error) ? getErrorMessage(error, 'Failed to create user') : UNKNOWN_ORPC_ERROR_MESSAGE);
      },
    }),
  );
}

/**
 * Update user
 */
export function useAdminUpdateUser() {
  return useMutation(
    enhancedAdmin.updateUser.mutationOptions({
      onSuccess: enhancedAdmin.updateUser.withInvalidationOnSuccess(() => {
        toast.success("User updated successfully");
      }),
      onError: (error) => {
        toast.error(isDefinedORPCError(error) ? getErrorMessage(error, 'Failed to update user') : UNKNOWN_ORPC_ERROR_MESSAGE);
      },
    }),
  );
}

/**
 * Remove user
 */
export function useAdminRemoveUser() {
  return useMutation(
    enhancedAdmin.removeUser.mutationOptions({
      onSuccess: enhancedAdmin.removeUser.withInvalidationOnSuccess(() => {
        toast.success("User removed successfully");
      }),
      onError: (error) => {
        toast.error(isDefinedORPCError(error) ? getErrorMessage(error, 'Failed to remove user') : UNKNOWN_ORPC_ERROR_MESSAGE);
      },
    }),
  );
}

/**
 * Impersonate a user (`AUTH-067`).
 *
 * On success the session cookie belongs to the target, so the page reloads rather than patching user-scoped state.
 * A 403 means the caller lacks the capability, the target is not strictly weaker, or no passkey step-up is fresh.
 */
export function useAdminImpersonate() {
  return useMutation(
    enhancedAdmin.impersonate.mutationOptions({
      onSuccess: () => {
        toast.success('Now acting as that user (read-only).')
        window.location.assign('/dashboard')
      },
      onError: (error) => {
        toast.error(
          'Impersonation refused. Check that you are a super admin and verified with a passkey in the last five minutes.',
          { description: isDefinedORPCError(error) ? getErrorMessage(error) : undefined },
        )
      },
    }),
  )
}

// ============================================================================
// COMPOSITE HOOKS
// ============================================================================

/**
 * All admin actions in one hook
 */
export function useAdminActions() {
  const banUser = useAdminBanUser();
  const unbanUser = useAdminUnbanUser();
  const setRole = useAdminSetRole();
  const createUser = useAdminCreateUser();
  const updateUser = useAdminUpdateUser();
  const removeUser = useAdminRemoveUser();
  const impersonate = useAdminImpersonate();

  return {
    banUser: banUser.mutate,
    banUserAsync: banUser.mutateAsync,
    unbanUser: unbanUser.mutate,
    unbanUserAsync: unbanUser.mutateAsync,
    setRole: setRole.mutate,
    setRoleAsync: setRole.mutateAsync,
    createUser: createUser.mutate,
    createUserAsync: createUser.mutateAsync,
    updateUser: updateUser.mutate,
    updateUserAsync: updateUser.mutateAsync,
    removeUser: removeUser.mutate,
    removeUserAsync: removeUser.mutateAsync,
    impersonate: impersonate.mutate,
    impersonateAsync: impersonate.mutateAsync,

    isLoading: {
      ban: banUser.isPending,
      unban: unbanUser.isPending,
      setRole: setRole.isPending,
      create: createUser.isPending,
      update: updateUser.isPending,
      remove: removeUser.isPending,
      impersonate: impersonate.isPending,
    },

    errors: {
      ban: banUser.error,
      unban: unbanUser.error,
      setRole: setRole.error,
      create: createUser.error,
      update: updateUser.error,
      remove: removeUser.error,
      impersonate: impersonate.error,
    },
  };
}
