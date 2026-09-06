'use client'

import { type ReactNode } from 'react'
import {
  createPermissionHooks,
  type PlatformPermission,
  type CreatePermissionHooksOptions,
} from './usePermissions'

// ============================================================================
// TYPES
// ============================================================================

export interface RequirePlatformPermissionProps {
  permission: PlatformPermission | PlatformPermission[]
  requireAll?: boolean
  children: ReactNode
  fallback?: ReactNode
  loading?: ReactNode
}

export interface RequirePermissionProps {
  permission: PlatformPermission | PlatformPermission[]
  requireAll?: boolean
  children: ReactNode
  fallback?: ReactNode
  loading?: ReactNode
}

// ============================================================================
// FACTORY FOR CREATING PERMISSION COMPONENTS
// ============================================================================

/**
 * Creates RequirePermission components with provided dependencies.
 * This allows the package to be framework-agnostic while still providing
 * permission-based rendering components.
 *
 * The mesh is the single tenant — there is no organization layer, so the
 * only permission target is the platform.
 *
 * @example
 * ```tsx
 * // In your app, create the components with your auth hooks:
 * import { createRequirePermissionComponents } from '@repo/auth/react'
 * import { useSession } from '@/lib/auth'
 *
 * export const {
 *   RequirePlatformPermission,
 *   RequirePermission,
 *   useRequirePlatformPermission,
 * } = createRequirePermissionComponents({
 *   useSession,
 * })
 * ```
 */
export function createRequirePermissionComponents(options: CreatePermissionHooksOptions) {
  const { usePermissions } = createPermissionHooks(options)

  /**
   * Platform permission component
   */
  function RequirePlatformPermission({
    permission,
    requireAll = false,
    children,
    fallback = null,
    loading = null,
  }: RequirePlatformPermissionProps) {
    const { canAnyPlatform, canAllPlatform, isLoading, isAuthenticated } = usePermissions()

    if (isLoading && loading !== null) {
      return <>{loading}</>
    }

    if (!isAuthenticated) {
      return <>{fallback}</>
    }

    const permissions = Array.isArray(permission) ? permission : [permission]
    const hasPermission = requireAll
      ? canAllPlatform(permissions)
      : canAnyPlatform(permissions)

    if (!hasPermission) {
      return <>{fallback}</>
    }

    return <>{children}</>
  }

  /**
   * RequirePermission — alias of RequirePlatformPermission (single-tenant mesh).
   */
  function RequirePermission(props: RequirePermissionProps) {
    return <RequirePlatformPermission {...props} />
  }

  /**
   * Platform permission hook — true/false access check for imperatives.
   */
  function useRequirePlatformPermission(permission: PlatformPermission | PlatformPermission[], requireAll = false) {
    const { canAnyPlatform, canAllPlatform, isLoading, isAuthenticated } = usePermissions()

    const permissions = Array.isArray(permission) ? permission : [permission]
    const hasPermission = requireAll
      ? canAllPlatform(permissions)
      : canAnyPlatform(permissions)

    return {
      allowed: !!isAuthenticated && hasPermission,
      isLoading,
    }
  }

  return {
    RequirePlatformPermission,
    RequirePermission,
    useRequirePlatformPermission,
  }
}
