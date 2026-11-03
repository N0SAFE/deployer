import { Logger } from "@nestjs/common";
import { betterAuthFactory } from "@deployer/auth/server";

import type { AuthAuditEvent, AuthAuditSink } from "@deployer/auth/audit";
import type { EnvService } from "../env/env.module";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { authAuditEvents } from "@deployer/nest-schema/global/identity/audit";
import { getErrorMessage } from "@deployer/errors";

import { drizzleStepUpSink, makeHasStepUp } from "./step-up-sink";

/** A string env value, or nothing: the schema's optional keys widen to a union through `EnvService`. */
const optionalString = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;

const logger = new Logger("AuthAudit");

/**
 * Append auth audit events to `auth_audit_events`.
 *
 * Fire-and-forget by contract: the auth request has already succeeded by the time the hook runs, so failing it because
 * the audit insert failed would turn an observability problem into an outage. The failure is logged instead, with the
 * action so an operator can see what is missing.
 */
function drizzleAuditSink<TSchema extends Record<string, unknown>>(database: NodePgDatabase<TSchema>): AuthAuditSink {
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
                logger.warn(`audit write failed for "${event.action}": ${getErrorMessage(error)}`);
            });
    };
    return { record: insert };
}

export const createBetterAuth = <TSchema extends Record<string, unknown>>(
    database: NodePgDatabase<TSchema>,
    envService: EnvService | Parameters<typeof betterAuthFactory>[1]
) => {
    return betterAuthFactory(database, 'get' in envService ? {
        DEV_AUTH_KEY: envService.get('DEV_AUTH_KEY'),
        DEFAULT_ADMIN_EMAIL: envService.get('DEFAULT_ADMIN_EMAIL'),
        NODE_ENV: envService.get('NODE_ENV'),        ENABLE_MASTER_TOKEN: envService.get('ENABLE_MASTER_TOKEN'),        BETTER_AUTH_SECRET: envService.get('BETTER_AUTH_SECRET'),
        BASE_URL: envService.get('NEXT_PUBLIC_API_URL'),
        TRUSTED_ORIGINS: envService.get('TRUSTED_ORIGINS'),
        NEXT_PUBLIC_APP_URL: envService.get('NEXT_PUBLIC_APP_URL'),
        APP_URL: envService.get('APP_URL'),
        AUTH_BASE_DOMAIN: envService.get('AUTH_BASE_DOMAIN'),
        // Without these the factory cannot pin the WebAuthn relying party (it would use the API hostname, which the
        // browser rejects) and the GitHub provider would never activate.
        PASSKEY_RPID: optionalString(envService.get('PASSKEY_RPID')),
        PASSKEY_ORIGIN: optionalString(envService.get('PASSKEY_ORIGIN')),
        GITHUB_CLIENT_ID: optionalString(envService.get('GITHUB_CLIENT_ID')),
        GITHUB_CLIENT_SECRET: optionalString(envService.get('GITHUB_CLIENT_SECRET')),
    }: envService, { audit: drizzleAuditSink(database), stepUp: drizzleStepUpSink(database), hasStepUp: makeHasStepUp(database) });
};
