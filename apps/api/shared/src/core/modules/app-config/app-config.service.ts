/**
 * AppConfigService
 *
 * Reads runtime application configuration from the `app_config` table.
 * Replaces environment variables for settings that should be
 * configurable at runtime (e.g. GitHub OAuth credentials).
 */
import { eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'
import z from 'zod/v4'

import { appConfig } from '@deployer/nest-schema/global/platform/app-config'

import { storage, type DatabasePort } from '../database/storage'

export type GitHubOAuthConfig = {
    clientId: string
    clientSecret: string
}

export type GitHubWebhookConfig = {
    webhookSecret: string
}

const githubOAuthSchema = z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
})
const githubWebhookSchema = z.object({ webhookSecret: z.string().min(1) })

export type AppConfigServiceShape = {
    /** The stored GitHub OAuth app credentials, or null when unset, malformed or unreadable (logged, never failed). */
    readonly getGitHubOAuthConfig: () => Effect.Effect<GitHubOAuthConfig | null>
    /** The stored GitHub webhook secret, or null when unset, malformed or unreadable (logged, never failed). */
    readonly getGitHubWebhookConfig: () => Effect.Effect<GitHubWebhookConfig | null>
}

export function makeAppConfigService(
    database: Context.Service.Shape<typeof DatabasePort>
): AppConfigServiceShape {
    /** One JSON value of the `app_config` KV table, validated by `schema`. */
    const readJson = <T>(
        key: string,
        label: string,
        schema: z.ZodType<T>
    ): Effect.Effect<T | null> =>
        storage(database, (db) =>
            db.select().from(appConfig).where(eq(appConfig.key, key)).limit(1)
        ).pipe(
            Effect.flatMap((rows) => {
                const value = rows[0]?.value
                if (!value) return Effect.succeed(null)
                return Effect.try({
                    try: () => JSON.parse(value) as unknown,
                    catch: (cause) => cause,
                }).pipe(
                    Effect.map((raw) => {
                        const parsed = schema.safeParse(raw)
                        return parsed.success ? parsed.data : null
                    })
                )
            }),
            Effect.catch((err: unknown) =>
                Effect.logWarning(
                    `Failed to load ${label}: ${err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err)}`
                ).pipe(Effect.as(null))
            )
        )

    return {
        getGitHubOAuthConfig: () =>
            readJson('github_oauth', 'GitHub OAuth config', githubOAuthSchema),
        getGitHubWebhookConfig: () =>
            readJson(
                'github_webhook',
                'GitHub webhook config',
                githubWebhookSchema
            ),
    }
}

export class AppConfigService extends Context.Service<
    AppConfigService,
    AppConfigServiceShape
>()('shared/AppConfigService') {}
