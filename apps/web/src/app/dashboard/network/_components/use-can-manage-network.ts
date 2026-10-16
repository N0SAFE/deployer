'use client'

/**
 * Changing how the stack is reached, or who is in the mesh, is a platform-admin
 * act — the API enforces it (`requirePlatformRole`); this only hides controls a
 * viewer could not use anyway.
 *
 * Re-exported rather than reimplemented: this file used to be byte-identical to
 * `use-is-admin.ts`. The rule now lives once, in `@/lib/access/platform-role`.
 */
export { useCanManageNetwork } from '@/lib/access/platform-role'
