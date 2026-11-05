import { userSchema } from '@deployer/contracts-entities'

import type { z } from 'zod/v4'

/**
 * The User aggregate. Inferred from the contract's entity schema so the
 * transport and the domain cannot drift.
 */
export type User = z.output<typeof userSchema>

/** What `create` accepts — picked from the entity, never re-declared. */
export type NewUser = Pick<User, 'name' | 'email'> &
    Partial<Pick<User, 'image' | 'role'>> & {
        /** A credential password. Hashed by Better Auth's crypto, stored on the credential account row. */
        readonly password?: string
    }

/** What `update` accepts; audit timestamps are intentionally absent. */
export type UserPatch = Partial<
    Pick<User, 'name' | 'email' | 'emailVerified' | 'role' | 'banned'>
>

/** One session in a self-export. No token: this is a description of the credential, not the credential. */
export type SelfSession = {
    readonly id: string
    readonly createdAt: Date
    readonly expiresAt: Date
    readonly ipAddress: string | null
    readonly userAgent: string | null
    readonly impersonatedBy: string | null
}

/** One API key in a self-export. No key material, no hash. */
export type SelfApiKey = {
    readonly id: string
    readonly name: string | null
    readonly createdAt: Date
    readonly expiresAt: Date | null
    readonly lastUsedAt: Date | null
    readonly enabled: boolean
}

/** One session as an operator sees it. No token, by construction. */
export type UserSessionRow = SelfSession

export type SelfExportData = {
    readonly sessions: SelfSession[]
    readonly apiKeys: SelfApiKey[]
}

export type { Actor } from '@identity/core/utils/actor.utils'
