'use client'

import { useSession } from '@/lib/auth'

/**
 * Platform-admin check for hiding settings areas a viewer could not use anyway.
 * The API enforces the real permission on every call; this only keeps the UI honest.
 */
export function useIsPlatformAdmin(): boolean {
  const { data: session } = useSession()
  return session?.user.role === 'admin' || session?.user.role === 'superAdmin'
}
