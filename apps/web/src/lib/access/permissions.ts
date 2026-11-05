'use client'

import { can, capabilitiesOfRole, type Permission } from '@deployer/auth/authz'

import { usePlatformRoleValue } from './platform-role'

/**
 * Capability checks for the UI, from the SAME catalog the API enforces.
 *
 * The web must never restate a permission: `role === 'admin'` in a component is the drift the audit found five times
 * (`useCanManageNetwork` and `useIsPlatformAdmin` were byte-identical), and a capability defined in two places disagrees
 * the moment one changes. `PERMISSIONS`/`SYSTEM_ROLES` live in `@deployer/auth/authz`; this module only turns the session
 * into a capability set and asks `can()`.
 *
 * It is explicitly NOT the boundary: hiding a control is UX. The API refuses on its own (`authzGate`), and a hidden
 * button is not a security control.
 */
export function useCapabilities(): readonly Permission[] {
    const role = usePlatformRoleValue()
    return role === null ? [] : capabilitiesOfRole(role)
}

/** Whether the signed-in user holds a permission. Unknown roles hold nothing. */
export function useCan(permission: Permission): boolean {
    return can(useCapabilities(), permission)
}
