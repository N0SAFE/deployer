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
export const guardedUrl = (name: string, _fallback: string) =>
    zod
        .string()
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
