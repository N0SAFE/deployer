import { createContext } from 'react'
import type { MasterTokenManager as MTManager, MasterTokenSubscriber } from '@repo/auth/client/plugins/masterToken/state'

export interface MasterTokenContextValue {
    enabled: boolean
    setEnabled: (v: boolean) => void
}

export const MasterTokenContext = createContext<MasterTokenContextValue | null>(null)

// Re-export types for convenience
export type { MTManager as MasterTokenManager, MasterTokenSubscriber }
