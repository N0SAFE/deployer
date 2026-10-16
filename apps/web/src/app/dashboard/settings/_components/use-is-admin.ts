'use client'

/**
 * Platform-admin check for hiding settings areas a viewer could not use anyway.
 *
 * Re-exported rather than reimplemented: this file used to repeat
 * `role === 'admin' || role === 'superAdmin'` verbatim, as did
 * `use-can-manage-network.ts`. The rule now lives once, in `@/lib/access/platform-role`.
 * The module is kept so existing imports keep working without churn.
 */
export { useIsPlatformAdmin } from '@/lib/access/platform-role'
