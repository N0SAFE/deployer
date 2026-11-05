/**
 * The single list of origins this platform trusts, shared by Better Auth
 * (`trustedOrigins`) and by the API's CORS gateway.
 *
 * Both consumers answer the same question - "is this Origin first-party?" - so
 * they must read the same facts. Keeping the derivation here is what stopped
 * the two from drifting: the API used to build its allowlist from
 * `NEXT_PUBLIC_APP_URL`/`APP_URL`/`TRUSTED_ORIGINS` only, while Better Auth also
 * derived every `AUTH_BASE_DOMAIN` subdomain. A browser on
 * `http://web.deployer.localhost` therefore passed the auth check but failed the
 * preflight: the reflected origin came back WITHOUT
 * `Access-Control-Allow-Credentials`, and the browser reported
 * `PreflightInvalidAllowCredential`.
 */

export interface TrustedOriginsEnv {
    APP_URL?: string
    NEXT_PUBLIC_APP_URL?: string
    TRUSTED_ORIGINS?: string
    AUTH_BASE_DOMAIN?: string
    BASE_URL?: string
}

/** Strip the trailing slash so `https://a/` and `https://a` compare equal. */
const normalizeOrigin = (origin: string): string => origin.replace(/\/$/, '')

/**
 * Every first-party origin, normalized and de-duplicated.
 *
 * @returns `[]` when nothing is configured — callers decide the fallback.
 */
export const buildTrustedOrigins = (env: TrustedOriginsEnv): string[] => {
    const {
        APP_URL,
        NEXT_PUBLIC_APP_URL,
        TRUSTED_ORIGINS,
        AUTH_BASE_DOMAIN,
        BASE_URL,
    } = env

    const origins: string[] = []
    const push = (origin: string): void => {
        const normalized = normalizeOrigin(origin)
        if (normalized && !origins.includes(normalized))
            origins.push(normalized)
    }

    // The public web app URL the browser uses.
    if (NEXT_PUBLIC_APP_URL) push(NEXT_PUBLIC_APP_URL)

    // The private Docker-network URL the web requests come from internally.
    if (APP_URL) push(APP_URL)

    // Explicit extras.
    if (TRUSTED_ORIGINS) {
        for (const origin of TRUSTED_ORIGINS.split(',')) {
            const trimmed = origin.trim()
            if (trimmed) push(trimmed)
        }
    }

    // ── EVERY SUBDOMAIN OF THE PLATFORM IS TRUSTED, NOT JUST api/web ──────
    // `TRUSTED_ORIGINS` defaults to plain `http://localhost:3000` in every dev
    // profile, but the browser's origin is `http://<service>.deployer.localhost`.
    // `AUTH_BASE_DOMAIN` already states the platform's parent domain, and it is
    // the SAME fact that justifies a shared session cookie. Deriving the
    // subdomains from it makes the two agree by construction: if the cookie may
    // cross `a.deployer.localhost` and `b.deployer.localhost`, an Origin on any
    // of them is first-party by definition.
    if (AUTH_BASE_DOMAIN) {
        const parent = AUTH_BASE_DOMAIN.startsWith('.')
            ? AUTH_BASE_DOMAIN
            : `.${AUTH_BASE_DOMAIN}`
        const scheme = BASE_URL?.startsWith('https://') ? 'https' : 'http'
        // The bare parent plus the platform hostnames. Explicit names rather
        // than a wildcard: Better Auth matches strings, and listing them keeps
        // the trusted set auditable.
        for (const host of ['', 'web', 'api', 'setup', 'docs']) {
            push(
                `${scheme}://${host === '' ? parent.slice(1) : `${host}${parent}`}`
            )
        }
    }

    return origins
}
