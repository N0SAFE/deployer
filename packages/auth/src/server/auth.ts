import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { createAuthMiddleware } from 'better-auth/api'
import { multiSession, openAPI } from 'better-auth/plugins'

import { auditEventFromRequest, type AuthAuditSink } from '../audit'

import { buildTrustedOrigins } from './origins'
import {
    deployerUserSchemaPlugin,
    impersonationPlugin,
    masterTokenPlugin,
    loginAsPlugin,
    pushNotificationsPlugin,
    useApiKey,
    useDeviceAuthorization,
    useInvite,
    useLastLoginMethod,
    usePasskey,
    stepUpPlugin,
    useTwoFactor,
} from './plugins'
import { passkeyCoordinates } from './plugins/securityPlugins'

import type { MailSink } from '../mail'
import type { StepUpSink } from './plugins/step-up'
import type { AnyRelations } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'

/** The environment the factory reads. One named shape, shared by every helper. */
export interface AuthFactoryEnv {
    DEV_AUTH_KEY: string | undefined
    DEFAULT_ADMIN_EMAIL: string | undefined
    NODE_ENV: string
    ENABLE_MASTER_TOKEN?: boolean
    /** The platform secret: required, never read from `process.env` here (the app generates it on first boot, SEC-100). */
    BETTER_AUTH_SECRET: string
    /**
     * The earlier generations of the platform secret, current first, once it has been rotated (SEC-101): Better Auth then
     * seals with the first and still opens what the others sealed, so a rotation signs nobody out. Absent before a
     * rotation, so an install that never rotated keeps its plain-secret behaviour.
     */
    BETTER_AUTH_SECRETS?: { version: number; value: string }[]
    BASE_URL?: string
    APP_URL?: string
    NEXT_PUBLIC_APP_URL?: string
    TRUSTED_ORIGINS?: string
    AUTH_BASE_DOMAIN?: string
    GITHUB_CLIENT_ID?: string
    GITHUB_CLIENT_SECRET?: string
    /** Pins the WebAuthn relying-party ID; defaults to `AUTH_BASE_DOMAIN` without its leading dot. */
    /** HTTP relay for outbound mail (`AUTH-015`); absent means no transport. */
    MAIL_WEBHOOK_URL?: string
    PASSKEY_RPID?: string
    /** Pins the WebAuthn origin(s), comma-separated; defaults to `APP_URL`. */
    PASSKEY_ORIGIN?: string
}

/** What a deployment may supply in addition to the database and the environment. */
export interface AuthFactoryOptions {
    /**
     * Where auth audit events go (`AUTH-029`). Absent means audited actions are not recorded — the producer is opt-in so
     * a package that builds an auth instance without a database of its own still works.
     */
    readonly audit?: AuthAuditSink
    /**
     * Where step-up proofs go (`AUTH-062`). Absent means verifications are not recorded, and nothing can satisfy a
     * critical-action guard.
     */
    readonly stepUp?: StepUpSink
    /**
     * Whether a session holds a fresh passkey proof (`AUTH-067`). Impersonation is refused without one.
     */
    readonly hasStepUp?: (sessionId: string) => Promise<boolean>
    /**
     * Outbound mail (`AUTH-015`). Absent means the deployment has no transport: password reset is still callable, but the
     * message goes nowhere, so a caller must not tell the user "check your inbox".
     */
    readonly mail?: MailSink
}

/** Request-derived values the factory computes and the config builder consumes. */
interface AuthConfigContext {
    origins: string[]
    isHttps: boolean
    cookieDomain: string | undefined
}

/**
 * The instance this factory returns - INCLUDING its plugin-derived API.
 *
 * WHY AN EXPLICIT RETURN TYPE (TS7056)
 * Declarations are emitted by `pkg-build --types`. With the return type inferred
 * inline, the compiler cannot serialize it into a `.d.ts`:
 *
 *   TS7056: The inferred type of this node exceeds the maximum length the
 *           compiler will serialize. An explicit type annotation is needed.
 *
 * `pkg-build --types` treats that as fatal, so `server/auth.d.ts` was never
 * emitted - and since every downstream package resolves `@deployer/auth` through
 * `dist/types`, that single missing file broke the whole workspace type-check.
 * The types were always correct; only EMIT was impossible.
 *
 * PLUGIN INFERENCE IS LOAD-BEARING.
 * Better Auth derives `auth.api.*`, `$Infer` and the session shape FROM THE
 * PLUGIN LIST in the config. `ReturnType<typeof buildAuthConfig>` IS that config
 * type - the literal type carrying the plugin tuple - so the plugin-derived API
 * is fully preserved. A wide annotation (`Auth<BetterAuthOptions>`) would erase
 * it, and `../types.ts` derives `Auth` / `Session` from this very return, so
 * that loss would silently reach every consumer.
 */
export interface BetterAuthFactoryResult {
    auth: ReturnType<typeof betterAuth<ReturnType<typeof buildAuthConfig>>> & {
        config: ReturnType<typeof buildAuthConfig>
    }
}

/**
 * Build the options object handed to `betterAuth()`.
 *
 * WHY A NAMED BUILDER
 * The return type is what `BetterAuthFactoryResult` is derived from, so it has
 * to be reachable by name for the compiler to serialize it. Keeping the config
 * literal inside the factory makes the inferred type anonymous and unprintable
 * (TS7056); naming the builder gives the compiler a referenceable type while
 * still carrying the plugin tuple.
 *
 * The client (`../client/auth-client.ts`) feeds this return type into
 * `inferAdditionalFields<AuthInstance>()`, so the plugin tuple MUST stay
 * concrete here - widening it to a homogeneous array erases every plugin method
 * from the browser client's type.
 */
function buildAuthConfig<TSchema extends AnyRelations>(
    database: NodePgDatabase<TSchema>,
    env: AuthFactoryEnv,
    { origins, isHttps, cookieDomain }: AuthConfigContext,
    options: AuthFactoryOptions = {}
) {
    const {
        DEV_AUTH_KEY,
        DEFAULT_ADMIN_EMAIL,
        ENABLE_MASTER_TOKEN,
        NODE_ENV,
        BETTER_AUTH_SECRET,
        BETTER_AUTH_SECRETS,
        BASE_URL,
        GITHUB_CLIENT_ID,
        GITHUB_CLIENT_SECRET,
        APP_URL,
        NEXT_PUBLIC_APP_URL,
        PASSKEY_RPID,
        PASSKEY_ORIGIN,
    } = env

    // ── DEV-ONLY AUTH DOORS ARE NOT EVEN REGISTERED IN PRODUCTION ───────────
    // `masterTokenPlugin` authenticates ANY request as the master account from a
    // static header value, and `loginAsPlugin` mints a session for any user id.
    // Both used to switch on from `DEV_AUTH_KEY` alone (the master token also
    // from `DEFAULT_ADMIN_EMAIL`), so a leaked or compose-defaulted key was a
    // platform-wide auth bypass in production. Registration now requires an
    // explicitly non-production `NODE_ENV` AND the key, plus (for the master
    // token) an explicit `ENABLE_MASTER_TOKEN=true`.
    //
    // Absence, not `enabled: false`, is deliberate: a plugin that is not in the
    // list has no endpoint and no middleware to misfire. `ENABLE_MASTER_TOKEN`
    // is a strict boolean parsed in `@deployer/env` — `"false"` is false there,
    // not truthy.
    const devAuthKey = DEV_AUTH_KEY ?? ''
    const devAuthEnabled = NODE_ENV !== 'production' && devAuthKey.length > 0
    const masterTokenEnabled =
        devAuthEnabled && ENABLE_MASTER_TOKEN === true && !!DEFAULT_ADMIN_EMAIL
    const devPlugins = [
        ...(masterTokenEnabled
            ? [
                  masterTokenPlugin({
                      devAuthKey,
                      masterEmail: DEFAULT_ADMIN_EMAIL,
                  }),
              ]
            : []),
        ...(devAuthEnabled ? [loginAsPlugin({ devAuthKey })] : []),
    ]

    return {
        secret: BETTER_AUTH_SECRET,
        ...(BETTER_AUTH_SECRETS === undefined
            ? {}
            : { secrets: BETTER_AUTH_SECRETS }),
        baseURL: BASE_URL ?? process.env.NEXT_PUBLIC_API_URL,
        trustedOrigins: origins.length > 0 ? origins : undefined,
        advanced: {
            // Traefik terminates TLS and forwards the client address; without this the rate limiter and the session's
            // `ipAddress` would record the proxy and every client would share one bucket.
            ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
            // In production with HTTPS, use secure cookies
            // CRITICAL: Must match the isSecure setting in middleware
            useSecureCookies: isHttps,
            // Set cross-origin cookie options for subdomain sharing.
            // The domain belongs here, not in cookieOptions.
            crossSubDomainCookies: {
                enabled: !!cookieDomain,
                ...(cookieDomain ? { domain: cookieDomain } : {}),
            },
        },
        database: drizzleAdapter(database, { provider: 'pg' }),
        emailAndPassword: {
            // Sign-IN stays on; public sign-UP is closed. This platform has no
            // self-service registration: an account exists only because the
            // operator created one (setup wizard, admin bootstrap) or an admin
            // invited it (the invite plugin provisions through the internal
            // adapter, and invitation is what `disableSignUp` does not touch).
            // Without this, `POST /sign-up/email` was an unauthenticated way to
            // mint a user, and `role` below was writable by anyone.
            enabled: true,
            disableSignUp: true,
            ...(options.mail === undefined
                ? {}
                : {
                      /**
                       * The link is Better Auth's own, so the token, expiry and redirect handling stay theirs. We only
                       * decide the wording and the transport.
                       */
                      sendResetPassword: async ({
                          user,
                          url,
                      }: {
                          user: { email: string }
                          url: string
                      }) => {
                          await options.mail?.send({
                              to: user.email,
                              subject: 'Reset your Deployer password',
                              text: `Someone asked to reset the password for this account.\n\n${url}\n\nIf it was not you, ignore this message; the link expires on its own.`,
                              kind: 'password-reset',
                          })
                      },
                  }),
        },
        // Changing an email address (`AUTH-015`). Only offered when a transport exists: without one the flow would send
        // the person to an inbox that never receives the link, so the feature is absent rather than broken.
        ...(options.mail === undefined
            ? {}
            : {
                  changeEmail: {
                      enabled: true,
                      /**
                       * Confirmations go to BOTH addresses: the new one proves control of it, the old one is the alarm if
                       * somebody else started the change.
                       */
                      sendChangeEmailConfirmation: async ({
                          user,
                          newEmail,
                          url,
                      }: {
                          user: { email: string }
                          newEmail: string
                          url: string
                      }) => {
                          await options.mail?.send({
                              to: newEmail,
                              subject: 'Confirm your new Deployer email',
                              text: `Confirm this address for your account:\n\n${url}\n\nIf you did not ask for this, ignore the message.`,
                              kind: 'email-change',
                          })
                          await options.mail?.send({
                              to: user.email,
                              subject: 'Your Deployer email is changing',
                              text: `A change to ${newEmail} was requested. If it was not you, contact an administrator immediately.`,
                              kind: 'email-change',
                          })
                      },
                  },
              }),
        // User columns live in `deployerUserSchemaPlugin` (a server plugin, linked to the client by
        // `deployerUserSchemaClient`): the DB schema file is GENERATED, so the plugin is what keeps the columns across a
        // regen, and `$InferServerPlugin` is what puts them on the client's session type.
        ...(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET
            ? {
                  socialProviders: {
                      github: {
                          clientId: GITHUB_CLIENT_ID,
                          clientSecret: GITHUB_CLIENT_SECRET,
                          scope: ['user:email', 'repo'],
                      },
                  },
              }
            : {}),
        session: {
            // ── SESSION POLICY (AUTH-012) ───────────────────────────────────
            // Absolute 30 days, refreshed at most once a day of use: long enough that an operator is not asked to
            // re-authenticate mid-incident, short enough that an abandoned session dies. `freshAge` is what BA's own
            // sensitive endpoints (set-password, change-email, two-factor) demand before acting, which is the
            // step-up the platform relies on instead of a second password prompt.
            expiresIn: 60 * 60 * 24 * 30,
            updateAge: 60 * 60 * 24,
            freshAge: 60 * 60 * 24,
            cookieCache: {
                enabled: true,
                // One minute, not five: the cache is a role/ban snapshot, so its lifetime is how long a demotion or a
                // ban stays invisible to a request that trusts a cached session. Anything that must be exact (the
                // admin hierarchy, the requirement gate) reads the session authoritatively instead.
                maxAge: 60,
            },
        },
        // ── RATE LIMITS (AUTH-012) ──────────────────────────────────────────
        // Per-process memory storage: a multi-replica deployment needs the shared store from SEC-024, which is why the
        // window is generous and the rules are per endpoint rather than global.
        rateLimit: {
            enabled: true,
            window: 60,
            max: 120,
            customRules: {
                '/sign-in/email': { window: 60, max: 10 },
                '/sign-up/email': { window: 60, max: 5 },
                '/forget-password': { window: 300, max: 5 },
                '/invite/create': { window: 60, max: 20 },
                '/invite/validate': { window: 60, max: 10 },
                '/device/approve': { window: 60, max: 20 },
            },
        },
        plugins: [
            // The platform's own `user` columns. Declared as a plugin, not `user.additionalFields`, because
            // `packages/nest/schema/src/global/identity/auth.ts` is GENERATED: a plugin's `schema` is an input to that
            // generation, so a regen keeps `role`/`banned`/`banReason`/`banExpires`/`impersonatedBy`. The client's
            // `deployerUserSchemaClient()` points at this plugin through `$InferServerPlugin`, which is what types them
            // on `session.user`.
            deployerUserSchemaPlugin(),
            // Records every completed factor verification as a step-up for the session that performed it (`AUTH-062`).
            // Absent sink = absent plugin: nothing can satisfy a step-up guard, which is the safe direction.
            ...(options.stepUp === undefined
                ? []
                : [stepUpPlugin(options.stepUp)]),
            // Impersonation (`AUTH-067`): the only writer of `session.impersonated_by`; the admin plugin that used to
            // own a raw endpoint is gone. Registered only with a step-up port, so a deployment that cannot prove a
            // passkey cannot impersonate at all.
            ...(options.hasStepUp === undefined
                ? []
                : [
                      impersonationPlugin({
                          hasStepUp: options.hasStepUp,
                          ...(options.audit === undefined
                              ? {}
                              : { audit: options.audit }),
                      }),
                  ]),
            // API keys replace the hand-rolled ApiKeyService (which issued keys
            // nothing could verify) AND the browser-exposed DEV_AUTH_KEY path:
            // `enableSessionForAPIKeys` turns a key into a real session, so the
            // CLI, scripts, CI and the devtools "act as user" flow all get
            // scoped, expiring, revocable credentials instead of one static
            // platform-wide secret.
            useApiKey(),
            // One browser, several identities. Better Auth keeps a signed
            // `{prefix}.session_token_multi-<token>` cookie per signed-in account, and
            // `set-active` only swaps which of them is the primary session cookie -
            // signing in again is never required to switch. Capped at 5 accounts
            // (Better Auth's `maximumSessions` default): a 6th sign-in still
            // authenticates, it is just not retained in the device list.
            multiSession(),
            // Present only outside production, and only with an explicit key.
            ...devPlugins,
            openAPI(),
            useInvite({
                inviteDurationDays: 7,
            }),
            pushNotificationsPlugin(),
            // WebAuthn/passkeys. Doubles as the proof-of-physical-presence
            // factor that Agent Auth requires for mutating capabilities, so an
            // AI agent cannot deploy without a real user gesture.
            //
            // The RP ID must be the PARENT domain, not the API's hostname: the browser runs the ceremony on the web
            // origin (`web.<domain>`) while this API answers it on `api.<domain>`, and a credential registered against
            // the wrong RP is rejected by the browser with no way to recover it. `PASSKEY_RPID`/`PASSKEY_ORIGIN` pin
            // them for a deployment whose public hostnames do not follow `AUTH_BASE_DOMAIN`.
            usePasskey({
                rpName: 'Deployer',
                ...passkeyCoordinates({
                    // `cookieDomain` IS `AUTH_BASE_DOMAIN` (with its leading dot), computed by the factory.
                    authBaseDomain: cookieDomain,
                    appUrl: APP_URL ?? NEXT_PUBLIC_APP_URL,
                    rpIdOverride: PASSKEY_RPID,
                    originOverride: PASSKEY_ORIGIN,
                }),
            }),
            // TOTP + backup codes. `issuer` is required: it is what an
            // authenticator app displays to distinguish this platform's codes
            // from any other.
            useTwoFactor({ issuer: 'Deployer' }),
            // RFC 8628. Lets the CLI authenticate through a browser approval
            // instead of holding a privileged static credential, and provides
            // the approval page Agent Auth reuses for capability grants.
            useDeviceAuthorization(),
            // Records the method used to sign in, so the sign-in page can hint
            // which one the user used last.
            useLastLoginMethod(),
        ],
        // ── AUDIT (AUTH-029) ────────────────────────────────────────────────
        // One `after` hook for every endpoint: the mapping decides which requests are audited, so a new provider or a
        // renamed admin route is one row in `audit/request.ts`, not a hook per path here. A sink that is absent leaves
        // the auth config byte-identical to what it was.
        ...(options.audit === undefined
            ? {}
            : { hooks: { after: authAuditHook(options.audit) } }),
    }
}

/**
 * Translate a finished auth request into an audit event.
 *
 * The hook is deliberately silent about failures: an audit write must never fail the sign-in it describes (the sink
 * owns reporting its own errors). `returned` is where Better Auth puts the endpoint's result — for a sign-in, the only
 * place the authenticated user id exists.
 */
function authAuditHook(sink: AuthAuditSink) {
    return createAuthMiddleware((ctx) => {
        const event = auditEventFromRequest({
            path: ctx.path,
            sessionUserId: ctx.context.session?.user.id,
            body: ctx.body,
            returned: (ctx.context as { returned?: unknown }).returned,
            ip: ctx.headers?.get('x-forwarded-for') ?? undefined,
            userAgent: ctx.headers?.get('user-agent') ?? undefined,
        })
        if (event !== null) sink.record(event)
        // `createAuthMiddleware` wants a Promise; the mapping itself is synchronous.
        return Promise.resolve()
    })
}

export const betterAuthFactory = <
    TSchema extends AnyRelations = AnyRelations,
>(
    database: NodePgDatabase<TSchema>,
    env: AuthFactoryEnv,
    options: AuthFactoryOptions = {}
): BetterAuthFactoryResult => {
    const { BASE_URL, AUTH_BASE_DOMAIN } = env

    // The same list the API's CORS gateway trusts — see `./origins`.
    const origins = buildTrustedOrigins(env)

    // Computed BEFORE the cookie block below, which picks the scheme from it.
    const isHttps = BASE_URL?.startsWith('https://') ?? false

    // Use explicit AUTH_BASE_DOMAIN when provided, otherwise no domain sharing.
    // AUTH_BASE_DOMAIN must be the parent domain (e.g. ".deployer.localhost" or
    // ".sebille.net") so the session cookie is shared between the API and web
    // subdomains (api.* + web.*). CRITICAL: enabled over HTTP too - dev runs
    // http://api.deployer.localhost + http://web.deployer.localhost, and the
    // web's server-side auth (middleware) decrypts the session cookie from the
    // web request; a host-only api.* cookie is invisible there and every
    // protected route redirects to sign-in. (useSecureCookies still gates
    // the Secure flag: https-only.)
    const cookieDomain: string | undefined = AUTH_BASE_DOMAIN

    const config = buildAuthConfig(
        database,
        env,
        { origins, isHttps, cookieDomain },
        options
    )
    const auth = betterAuth(config)

    return { auth: { ...auth, config } }
}
