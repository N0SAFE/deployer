'use client'

/**
 * @fileoverview Permission Hooks - Role-Based Access Control (RBAC)
 *
 * This file provides React hooks for checking platform-level permissions
 * and roles. The mesh is the single tenant — there is no organization
 * layer, so all access control is platform-scoped.
 *
 * Key Features:
 * - Platform permission checking (usePermissions)
 * - Session-aware permission resolution
 * - Type-safe permission string definitions
 *
 * Permission Model:
 * - Platform permissions: Apply globally across the application
 * - Permissions defined as resource:action format (e.g., 'user:delete')
 *
 * Unlike ORPC hooks which use generated contracts, these hooks work
 * directly with session data and Better Auth's permission model for
 * real-time access control checks.
 */

import { useMemo } from 'react'
import type {
  PlatformRole,
  PlatformResource,
} from '../permissions'
import {
  platformRolesConfig,
  PLATFORM_ROLES,
} from '../permissions'

// ============================================================================
// TYPES
// ============================================================================

export interface PlatformPermission {
  resource: PlatformResource
  action: string
}

/**
 * Session data interface - compatible with Better Auth session
 */
export interface SessionData {
  user?: {
    id: string
    email?: string
    name?: string
    role?: PlatformRole | null
  }
}

/**
 * Use session hook result
 */
export interface UseSessionResult {
  data: SessionData | null | undefined
  isLoading?: boolean
}

export interface UsePermissionsResult {
  // User state
  isAuthenticated: boolean
  isLoading: boolean
  user: {
    id?: string
    email?: string
    name?: string
    role?: PlatformRole | null
  } | null

  // Platform role checks
  hasPlatformRole: (role: PlatformRole) => boolean
  hasAnyPlatformRole: (roles: PlatformRole[]) => boolean
  isPlatformAdmin: () => boolean
  isPlatformSuperAdmin: () => boolean
  platformRoleLevel: number

  // Platform permission checks
  canPlatform: (resource: PlatformResource, action: string) => boolean
  canAnyPlatform: (permissions: PlatformPermission[]) => boolean
  canAllPlatform: (permissions: PlatformPermission[]) => boolean
}

// ============================================================================
// PERMISSION HOOKS FACTORY
// ============================================================================

export interface CreatePermissionHooksOptions {
  useSession: () => UseSessionResult
}

/**
 * Creates permission hooks with provided dependencies
 */
export function createPermissionHooks({
  useSession,
}: CreatePermissionHooksOptions) {
  // ============================================================================
  // PLATFORM PERMISSIONS HOOK
  // ============================================================================

  /**
   * Hook for checking platform-level permissions and roles
   *
   * @example
   * ```tsx
   * const { isPlatformAdmin, canPlatform } = usePermissions()
   *
   * if (isPlatformAdmin()) {
   *   // Show admin UI
   * }
   *
   * if (canPlatform('user', 'list')) {
   *   // Show user list
   * }
   * ```
   */
  function usePermissions(): UsePermissionsResult {
    const session = useSession()
    const isLoading = session.isLoading ?? false

    const user = useMemo(() => {
      if (!session.data?.user) return null
      return {
        id: session.data.user.id,
        email: session.data.user.email,
        name: session.data.user.name,
        role: session.data.user.role,
      }
    }, [session.data])

    const platformRoleLevel = useMemo(() => {
      if (!user?.role) return 0
      // Level derived from position in PLATFORM_ROLES array (higher index = higher privilege)
      const idx = (PLATFORM_ROLES as readonly string[]).indexOf(user.role)
      return idx === -1 ? 0 : idx + 1
    }, [user])

    // Platform role checks
    const hasPlatformRole = useMemo(() => {
      return (role: PlatformRole): boolean => {
        if (!user?.role) return false
        return user.role === role
      }
    }, [user])

    const hasAnyPlatformRole = useMemo(() => {
      return (roles: PlatformRole[]): boolean => {
        if (!user?.role) return false
        return roles.includes(user.role)
      }
    }, [user])

    const isPlatformAdmin = useMemo(() => {
      return (): boolean => {
        if (!user?.role) return false
        const userIdx = (PLATFORM_ROLES as readonly string[]).indexOf(user.role)
        const adminIdx = (PLATFORM_ROLES as readonly string[]).indexOf('admin')
        return userIdx >= adminIdx && adminIdx !== -1
      }
    }, [user])

    const isPlatformSuperAdmin = useMemo(() => {
      return (): boolean => {
        if (!user?.role) return false
        return user.role === 'superAdmin'
      }
    }, [user])

    // Platform permission checks
    const canPlatform = useMemo(() => {
      return (resource: PlatformResource, action: string): boolean => {
        if (!user?.role) return false
        if (user.role === 'superAdmin') return true
        return platformRolesConfig.hasPermission(user.role, resource, action)
      }
    }, [user])

    const canAnyPlatform = useMemo(() => {
      return (permissions: PlatformPermission[]): boolean => {
        const role = user?.role
        if (!role) return false
        return permissions.some(({ resource, action }) =>
          (role === 'superAdmin') || platformRolesConfig.hasPermission(role, resource, action)
        )
      }
    }, [user])

    const canAllPlatform = useMemo(() => {
      return (permissions: PlatformPermission[]): boolean => {
        const role = user?.role
        if (!role) return false
        return permissions.every(({ resource, action }) =>
          (role === 'superAdmin') || platformRolesConfig.hasPermission(role, resource, action)
        )
      }
    }, [user])

    return {
      isAuthenticated: !!session.data?.user,
      isLoading,
      user,
      hasPlatformRole,
      hasAnyPlatformRole,
      isPlatformAdmin,
      isPlatformSuperAdmin,
      platformRoleLevel,
      canPlatform,
      canAnyPlatform,
      canAllPlatform,
    }
  }

  return {
    usePermissions,
  }
}
