import { betterAuthFactory } from "@deployer/auth/server";

/** A string env value, or nothing: the schema's optional keys widen to a union through `EnvService`. */
const optionalString = (value: unknown): string | undefined =>
    typeof value === "string" && value.length > 0 ? value : undefined;
import type { EnvService } from "../env/env.module";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

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
    }: envService);
};
