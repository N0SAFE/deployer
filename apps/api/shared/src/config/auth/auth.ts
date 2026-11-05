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
function drizzleAuditSink<TSchema extends Record<string, unknown>>(
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

/** What the factory reads from the environment: everything but the secret, which is passed on its own. */
type AuthEnvValues = Omit<
    Parameters<typeof betterAuthFactory>[1],
    'BETTER_AUTH_SECRET'
>

/**
 * @param platformSecret - the node's platform secret (`PlatformSecret`, generated on first boot). It is never read from the
 *   environment: the same value must sign sessions on every node, so it comes from the node's own stored config.
 */
/**
 * A secret for an instance that only PROVISIONS an account (the setup wizard, the admin bootstrap): it uses Better Auth's
 * internal adapter to hash a password and write a user, and signs nothing that leaves the process, so it needs no shared
 * secret, only one that is unguessable.
 */
export const provisioningSecret = (): string => randomBytes(32).toString('hex')

export const createBetterAuth = <TSchema extends Record<string, unknown>>(
    database: NodePgDatabase<TSchema>,
    envService: EnvService | AuthEnvValues,
    platformSecret: string
) => {
    return betterAuthFactory(
        database,
        'get' in envService
            ? {
                  DEV_AUTH_KEY: envService.get('DEV_AUTH_KEY'),
                  DEFAULT_ADMIN_EMAIL: envService.get('DEFAULT_ADMIN_EMAIL'),
                  NODE_ENV: envService.get('NODE_ENV'),
                  ENABLE_MASTER_TOKEN: envService.get('ENABLE_MASTER_TOKEN'),
                  BETTER_AUTH_SECRET: platformSecret,
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
            : { ...envService, BETTER_AUTH_SECRET: platformSecret },
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
