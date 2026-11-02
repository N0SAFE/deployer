import { type Auth as BetterAuthInstance } from 'better-auth';

import type { createAuthClientFactory } from './client/auth-client';
import { betterAuthFactory } from './server/auth';
/**
 * Interface for environment service to be implemented by the API
 * This allows the auth package to remain decoupled from the API implementation
 */
export interface IEnvService {
  get(key: string): string | undefined
  get<T = string>(key: string, defaultValue: T): T
}

export type Auth = Awaited<ReturnType<typeof betterAuthFactory>>['auth'];


/**
 * Infer the Session type from any Better Auth instance
 * Uses Better Auth's native $Infer pattern: auth.$Infer.Session
 * 
 * The session contains both `session` and `user` properties.
 * 
 * @template TAuth - The Better Auth instance type
 * 
 * @example
 * ```typescript
 * type MySession = InferSessionFromAuth<typeof auth>;
 * // MySession = { session: {...}, user: {...} }
 * ```
 */
export type InferSessionFromAuth<TAuth extends { $Infer: BetterAuthInstance['$Infer'] }> = TAuth extends { $Infer: { Session: infer S } } ? S : never;

/**
 * The session shape every consumer sees.
 *
 * Derived from the CLIENT (`createAuthClientFactory`), not from the server instance: Better Auth's server `$Infer`
 * merges `user.additionalFields` but NOT a plugin's `schema`, while the client merges both. The platform's `role`,
 * `banned`, `banReason`, `banExpires` and `impersonatedBy` columns live in `deployerUserSchemaPlugin`, linked to the
 * client through `$InferServerPlugin`, so the client is the type that actually carries them.
 */
export type Session = ReturnType<typeof createAuthClientFactory>['$Infer']['Session'];

export type User = Session['user']