import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI } from "better-auth/plugins";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
    masterTokenPlugin,
    loginAsPlugin,
    pushNotificationsPlugin,
    useAdmin,
    useInvite
} from "./plugins";

 
export const betterAuthFactory = <TSchema extends Record<string, unknown> = Record<string, never>>(
    database: NodePgDatabase<TSchema>,
    env: {
        DEV_AUTH_KEY: string | undefined;
        DEFAULT_ADMIN_EMAIL: string | undefined;
        NODE_ENV: string;
        ENABLE_MASTER_TOKEN?: boolean;
        BETTER_AUTH_SECRET?: string;
        BASE_URL?: string;
        APP_URL?: string;
        NEXT_PUBLIC_APP_URL?: string;
        TRUSTED_ORIGINS?: string;
        AUTH_BASE_DOMAIN?: string;
        GITHUB_CLIENT_ID?: string;
        GITHUB_CLIENT_SECRET?: string;
    }
) => {
    const { DEV_AUTH_KEY, DEFAULT_ADMIN_EMAIL, ENABLE_MASTER_TOKEN, BETTER_AUTH_SECRET, BASE_URL, APP_URL, NEXT_PUBLIC_APP_URL, TRUSTED_ORIGINS, AUTH_BASE_DOMAIN, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } = env;

    // Build trusted origins: both public and private web app URLs + additional origins
    const origins: string[] = [];

    // Trust the private Docker network URL (APP_URL)
    if (APP_URL) {
        origins.push(APP_URL);
    }

    // Trust the public web app URL (NEXT_PUBLIC_APP_URL)
    if (NEXT_PUBLIC_APP_URL) {
        origins.push(NEXT_PUBLIC_APP_URL);
    }

    // Add additional trusted origins if provided
    if (TRUSTED_ORIGINS) {
        const additionalOrigins = TRUSTED_ORIGINS.split(",").map((origin) => origin.trim());
        origins.push(...additionalOrigins);
    }

    const isHttps = BASE_URL?.startsWith("https://") ?? false;

    // Use explicit AUTH_BASE_DOMAIN when provided, otherwise no domain sharing.
    // AUTH_BASE_DOMAIN must be the parent domain (e.g. ".deployer.localhost" or
    // ".sebille.net") so the session cookie is shared between the API and web
    // subdomains (api.* + web.*). CRITICAL: enabled over HTTP too — dev runs
    // http://api.deployer.localhost + http://web.deployer.localhost, and the
    // web's server-side auth (middleware) decrypts the session cookie from the
    // web request; a host-only api.* cookie is invisible there and every
    // protected route redirects to sign-in. (useSecureCookies still gates
    // the Secure flag: https-only.)
    const cookieDomain: string | undefined = AUTH_BASE_DOMAIN ? AUTH_BASE_DOMAIN : undefined;

    const config = {
        secret: BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET,
        baseURL: BASE_URL ?? process.env.NEXT_PUBLIC_API_URL,
        trustedOrigins: origins.length > 0 ? origins : undefined,
        advanced: {
            // In production with HTTPS, use secure cookies
            // CRITICAL: Must match the isSecure setting in middleware
            useSecureCookies: isHttps,
            // Set cross-origin cookie options for subdomain sharing
            // The domain should be set here, not in cookieOptions
            crossSubDomainCookies: {
                enabled: !!cookieDomain,
                ...(cookieDomain ? { domain: cookieDomain } : {}),
            },
        },
        database: drizzleAdapter(database, { provider: "pg" }),
        emailAndPassword: {
            enabled: true,
        },
        // User model — `role` is the platform role. The admin plugin already
        // adds `banned` / `banReason` / `banExpires` / `impersonatedBy` to the
        // DB schema (plugin fields override these at runtime — no conflict),
        // but the CLIENT session type only receives fields declared in
        // `user.additionalFields` via `inferAdditionalFields<AuthInstance>()`.
        // Declaring them here therefore: (1) keeps the DB columns consistent
        // with the admin plugin, and (2) types `session.user.banned`,
        // `banReason` and `banExpires` in the web app under BOTH tsgo and tsc
        // (tsc cannot expand the admin plugin's `$InferServerPlugin` schema).
        user: {
            additionalFields: {
                role: {
                    type: "string",
                    required: true,
                    defaultValue: "user",
                    input: true,
                } as const,
                banned: {
                    type: "boolean",
                    required: false,
                    defaultValue: false,
                    input: false,
                } as const,
                banReason: {
                    type: "string",
                    required: false,
                    input: false,
                } as const,
                banExpires: {
                    type: "date",
                    required: false,
                    input: false,
                } as const,
            },
        },
        ...(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET ? {
            socialProviders: {
                github: {
                    clientId: GITHUB_CLIENT_ID,
                    clientSecret: GITHUB_CLIENT_SECRET,
                    scope: ["user:email", "repo"],
                },
            },
        } : {}),
        session: {
            cookieCache: {
                enabled: true,
                maxAge: 5 * 60, // Cache duration in seconds
            },
        },
        plugins: [
            useAdmin(),
            masterTokenPlugin({
                devAuthKey: DEV_AUTH_KEY ?? "",
                enabled: ENABLE_MASTER_TOKEN ?? (!!DEV_AUTH_KEY && !!DEFAULT_ADMIN_EMAIL),
                masterEmail: DEFAULT_ADMIN_EMAIL ?? "",
            }),
            loginAsPlugin({
                enabled: !!DEV_AUTH_KEY,
                devAuthKey: DEV_AUTH_KEY ?? "",
            }),
            openAPI(),
            useInvite({
                inviteDurationDays: 7,
            }),
            pushNotificationsPlugin()
        ],
    };

    const auth = betterAuth(config);

    return { auth: { ...auth, config } };
};
