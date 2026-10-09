'use client'

import { useSession } from '@/lib/auth'

/**
 * Changing how the stack is reached, or who is in the mesh, is a platform-admin
 * act — the API enforces it (`requirePlatformRole`); this only hides controls a
 * viewer could not use anyway.
 */
export function useCanManageNetwork(): boolean {
  const { data: session } = useSession()
  return session?.user.role === 'admin' || session?.user.role === 'superAdmin'
}
