import zod from 'zod/v4'

/**
 * Helper to trim trailing slash from URLs
 */
export const trimTrailingSlash = (url: string) => (url.endsWith('/') ? url.slice(0, -1) : url)

/**
 * Helper to create URL validators with production guards.
 *
 * Empty is rejected in every environment. Production additionally reports the
 * var as *required* rather than as a malformed URL, which is the actionable
 * message for a missing deployment value.
 *
 * The `fallback` parameter is inert: an empty value throws before any fallback
 * could be applied (this was already the behaviour of the previous
 * `.url().superRefine(...)` chain, where `.url()` rejected `''` first). It is
 * retained because it is part of the call signature used across the workspace.
 *
 * @param name - Environment variable name for error messages
 * @param _fallback - Unused; see above
 * @returns Zod URL schema with production validation
 */
/**
 * A URL env var that must be valid when supplied, and falls back when it is not.
 *
 * ── WHY THE FALLBACK IS NOW USED ────────────────────────────────────────────
 * This took a `_fallback` parameter and IGNORED it (the underscore was the tell):
 * an unset value was rejected outright. The consequence was that every API service
 * failed to BOOT outside a compose file that happened to set `NEXT_PUBLIC_API_URL`,
 * because the schema demanded a value whose only consumer is Better Auth's base URL —
 * and whose correct value in a container is exactly the fallback this function was
 * already being handed.
 *
 * The default is applied BEFORE validation, so a caller that supplies a value still
 * gets it checked (a malformed URL is a real misconfiguration and must fail), while an
 * absent one resolves to the documented local default instead of killing the process.
 *
 * `name` is kept in the messages so a production failure still says which variable,
 * which is the only way to act on it.
 */
export const guardedUrl = (name: string, fallback: string) =>
    zod
        .string()
        .default(fallback)
        .superRefine((val, ctx) => {
            if (!val) {
                ctx.addIssue({
                    code: 'custom',
                    message:
                        process.env.NODE_ENV === 'production'
                            ? `${name} is required in production but was not provided`
                            : `${name} is required but was not provided`,
                })
                return
            }
            if (!zod.url().safeParse(val).success) {
                ctx.addIssue({ code: 'custom', message: `${name} must be a valid URL` })
                return
            }
            ctx.value = val
        })
        .transform(trimTrailingSlash)

/**
 * Debug scope parser - transforms comma-separated scopes into structured format
 * Supports patterns like:
 * - "middleware/auth" (exact match)
 * - "middleware/*" (match all direct children)
 * - "middleware/**" (match all nested children)
 * - "middleware/{auth,router,cors}/*" (match multiple specific sub-scopes)
 * - "*" (match everything)
 * - "middleware/*,auth/test,api/{users,posts}/**" (multiple patterns)
 */
export const parseDebugScopes = (input: string): { patterns: string[], enableAll: boolean } => {
    if (!input || input.trim() === '') {
        return { patterns: [], enableAll: false }
    }
    
    const scopes = input.split(',').map(s => s.trim()).filter(Boolean)
    const enableAll = scopes.includes('*')
    
    return {
        patterns: scopes,
        enableAll
    }
}
