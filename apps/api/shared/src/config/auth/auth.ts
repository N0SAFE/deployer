import { randomBytes } from 'node:crypto'

import { Logger } from '@nestjs/common'

import type { AuthAuditEvent, AuthAuditSink } from '@deployer/auth/audit'
import { betterAuthFactory } from '@deployer/auth/server'
import { getErrorMessage } from '@deployer/errors'
import { authAuditEvents } from '@deployer/nest-schema/global/identity/audit'

import { makeMailSink } from './mail-sink'
import { drizzleStepUpSink, makeHasStepUp } from './step-up-sink'

import type { EnvService } from '../env/env.module'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { AnyRelations } from 'drizzle-orm'

/** A string env value, or nothing: the schema's optional keys widen to a union through `EnvService`. */
const optionalString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined

const logger = new Logger('AuthAudit')

/**
 * Append auth audit events to `auth_audit_events`.
 *
 * Fire-and-forget by contract: the auth request has already succeeded by the time the hook runs, so failing it because
 * the audit insert failed would turn an observability problem into an outage. The failure is logged instead, with the
 * action so an operator can see what is missing.
 */
function drizzleAuditSink<TSchema extends AnyRelations>(
    database: NodePgDatabase<TSchema>
): AuthAuditSink {
    const insert = (event: AuthAuditEvent): void => {
        void database
            .insert(authAuditEvents)
            .values({
                action: event.action,
                actorId: event.actorId ?? null,
                targetId: event.targetId ?? null,
                ip: event.ip ?? null,
                userAgent: event.userAgent ?? null,
                detail: event.detail ?? {},
            })
            .catch((error: unknown) => {
                logger.warn(
                    `audit write failed for "${event.action}": ${getErrorMessage(error)}`
                )
            })
    }
    return { record: insert }
}

/** What the factory reads from the environment: everything but the secrets, which are passed on their own. */
type AuthEnvValues = Omit<
    Parameters<typeof betterAuthFactory>[1],
    'BETTER_AUTH_SECRET' | 'BETTER_AUTH_SECRETS'
>

/** The platform secret as a ring: the current generation and the earlier ones still accepted, newest first (SEC-101). */
export type AuthSecretRing = {
    readonly generation: number
    readonly value: string
    readonly previous: readonly { readonly generation: number; readonly value: string }[]
}

/**
 * A secret for an instance that only PROVISIONS an account (the setup wizard, the admin bootstrap): it uses Better Auth's
 * internal adapter to hash a password and write a user, and signs nothing that leaves the process, so it needs no shared
 * secret, only one that is unguessable.
 */
export const provisioningSecret = (): AuthSecretRing => ({
    generation: 1,
    value: randomBytes(32).toString('hex'),
    previous: [],
})

/**
 * What Better Auth is given for a ring. Before any rotation it is the plain secret, as it always was. After one it is the
 * versioned list (newest first), so sessions and encrypted values sealed under an earlier generation still open; the plain
 * `secret` is then the OLDEST accepted value, which Better Auth uses only to open payloads that predate its versioned format.
 */
function secretsFor(ring: AuthSecretRing) {
    if (ring.previous.length === 0) return { BETTER_AUTH_SECRET: ring.value }
    const oldest = ring.previous[ring.previous.length - 1]
    return {
        BETTER_AUTH_SECRET: oldest?.value ?? ring.value,
        BETTER_AUTH_SECRETS: [
            { version: ring.generation, value: ring.value },
            ...ring.previous.map((entry) => ({
                version: entry.generation,
                value: entry.value,
            })),
        ],
    }
}

/**
 * @param platformSecret - the node's platform secret ring (generated on first boot, rotated by an operator). It is never read
 *   from the environment: the same value must sign sessions on every node, so it comes from the node's own stored config.
 */
export const createBetterAuth = <TSchema extends AnyRelations>(
    database: NodePgDatabase<TSchema>,
    envService: EnvService | AuthEnvValues,
    platformSecret: AuthSecretRing
) => {
    return betterAuthFactory(
        database,
        'get' in envService
            ? {
                  DEV_AUTH_KEY: envService.get('DEV_AUTH_KEY'),
                  DEFAULT_ADMIN_EMAIL: envService.get('DEFAULT_ADMIN_EMAIL'),
                  NODE_ENV: envService.get('NODE_ENV'),
                  ENABLE_MASTER_TOKEN: envService.get('ENABLE_MASTER_TOKEN'),
                  ...secretsFor(platformSecret),
                  BASE_URL: envService.get('NEXT_PUBLIC_API_URL'),
                  TRUSTED_ORIGINS: envService.get('TRUSTED_ORIGINS'),
                  NEXT_PUBLIC_APP_URL: envService.get('NEXT_PUBLIC_APP_URL'),
                  APP_URL: envService.get('APP_URL'),
                  AUTH_BASE_DOMAIN: envService.get('AUTH_BASE_DOMAIN'),
                  // Without these the factory cannot pin the WebAuthn relying party (it would use the API hostname, which the
                  // browser rejects) and the GitHub provider would never activate.
                  PASSKEY_RPID: optionalString(envService.get('PASSKEY_RPID')),
                  PASSKEY_ORIGIN: optionalString(
                      envService.get('PASSKEY_ORIGIN')
                  ),
                  GITHUB_CLIENT_ID: optionalString(
                      envService.get('GITHUB_CLIENT_ID')
                  ),
                  GITHUB_CLIENT_SECRET: optionalString(
                      envService.get('GITHUB_CLIENT_SECRET')
                  ),
              }
            : { ...envService, ...secretsFor(platformSecret) },
        {
            audit: drizzleAuditSink(database),
            stepUp: drizzleStepUpSink(database),
            hasStepUp: makeHasStepUp(database),
            // `AUTH-015`: a relay when configured, a dev log otherwise, nothing in production without one.
            mail: makeMailSink({
                url:
                    'get' in envService
                        ? envService.get('MAIL_WEBHOOK_URL')
                        : envService.MAIL_WEBHOOK_URL,
                nodeEnv:
                    'get' in envService
                        ? envService.get('NODE_ENV')
                        : envService.NODE_ENV,
            }),
        }
    )
}
